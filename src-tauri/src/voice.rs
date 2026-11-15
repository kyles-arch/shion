//! Discord ses baglantisi: ses gateway'i (v8), UDP/RTP, xchacha20 tasima sifrelemesi,
//! DAVE uctan uca sifreleme (davey) ve Opus kodlama/cozme.

use crate::audio::{self, Mixer, Resampler, Track, VoiceCtl, RATE};
use crate::video::{self, Depacketizer, Registration, VOut, VideoHub};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use davey::{Codec, CommitWelcome, DaveSession, MediaType, ProposalsOperationType, DAVE_PROTOCOL_VERSION};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::num::NonZeroU16;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::net::UdpSocket;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio_tungstenite::{connect_async, tungstenite::Message};

const FRAME: usize = 960; // 20 ms @ 48 kHz
const MODE: &str = "aead_xchacha20_poly1305_rtpsize";

/// Ses kanali baglantisi ya da Go Live (ekran paylasimi) yayini.
#[derive(Clone, PartialEq)]
pub enum ConnKind {
    Voice,
    Stream { key: String, sending: bool },
}

#[allow(dead_code)]
pub struct VoiceInfo {
    pub kind: ConnKind,
    pub server_id: String,
    pub guild_id: Option<String>,
    pub channel_id: String,
    pub user_id: String,
    pub session_id: String,
    pub token: String,
    pub endpoint: String,
}

/// Aktif / kurulmakta olan ses baglantisi.
#[derive(Default)]
pub struct VoiceMgr {
    pub guild_id: Option<String>,
    pub channel_id: Option<String>,
    pub session_id: Option<String>,
    pub server: Option<(String, String)>, // (token, endpoint)
    pub task: Option<tauri::async_runtime::JoinHandle<()>>,
    /// yayin anahtari -> Go Live baglantisi
    pub streams: HashMap<String, StreamConn>,
}

#[derive(Default)]
pub struct StreamConn {
    pub sending: bool,
    pub rtc_server_id: Option<String>,
    pub server: Option<(String, String)>,
    pub task: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl VoiceMgr {
    pub fn stop(&mut self) {
        if let Some(t) = self.task.take() {
            t.abort();
        }
        self.session_id = None;
        self.server = None;
        for (_, s) in self.streams.drain() {
            if let Some(t) = s.task {
                t.abort();
            }
        }
    }

    pub fn stop_stream(&mut self, key: &str) {
        if let Some(s) = self.streams.remove(key) {
            if let Some(t) = s.task {
                t.abort();
            }
        }
    }

    /// Yayin sunucusu bilgisi tamamsa Go Live baglantisini baslat.
    pub fn maybe_start_stream(&mut self, key: &str, app: &AppHandle, user_id: &str, ctl: &Arc<VoiceCtl>, hub: &Arc<VideoHub>) {
        let Some(sid) = self.session_id.clone() else { return };
        let ch = self.channel_id.clone().unwrap_or_default();
        let guild = self.guild_id.clone();
        let Some(sc) = self.streams.get_mut(key) else { return };
        if sc.task.is_some() {
            return;
        }
        let (Some(rtc), Some((token, endpoint))) = (&sc.rtc_server_id, &sc.server) else { return };
        let info = VoiceInfo {
            kind: ConnKind::Stream { key: key.to_string(), sending: sc.sending },
            server_id: rtc.clone(),
            guild_id: guild,
            channel_id: ch,
            user_id: user_id.to_string(),
            session_id: sid,
            token: token.clone(),
            endpoint: endpoint.clone(),
        };
        sc.task = Some(tauri::async_runtime::spawn(run(app.clone(), info, ctl.clone(), hub.clone())));
    }

    /// Oturum + sunucu bilgisi tamamsa baglantiyi baslat.
    pub fn maybe_start(&mut self, app: &AppHandle, user_id: &str, ctl: &Arc<VoiceCtl>, hub: &Arc<VideoHub>) {
        if self.task.is_some() {
            return;
        }
        let (Some(ch), Some(sid), Some((token, endpoint))) = (&self.channel_id, &self.session_id, &self.server) else { return };
        let info = VoiceInfo {
            kind: ConnKind::Voice,
            server_id: self.guild_id.clone().unwrap_or_else(|| ch.clone()),
            guild_id: self.guild_id.clone(),
            channel_id: ch.clone(),
            user_id: user_id.to_string(),
            session_id: sid.clone(),
            token: token.clone(),
            endpoint: endpoint.clone(),
        };
        self.task = Some(tauri::async_runtime::spawn(run(app.clone(), info, ctl.clone(), hub.clone())));
    }
}

/// Kodlayici is parcacigindan ses gorevine giden mesajlar.
enum Out {
    Opus(Vec<u8>),
    Speaking(bool),
}

fn status(app: &AppHandle, kind: &ConnKind, state: &str, detail: Value) {
    match kind {
        ConnKind::Voice => {
            let _ = app.emit("voice-status", json!({"state": state, "detail": detail}));
        }
        ConnKind::Stream { key, sending } => {
            let _ = app.emit("stream-status", json!({"key": key, "sending": sending, "state": state, "detail": detail}));
        }
    }
}

pub async fn run(app: AppHandle, info: VoiceInfo, ctl: Arc<VoiceCtl>, hub: Arc<VideoHub>) {
    status(&app, &info.kind, "connecting", Value::Null);
    match session(&app, &info, ctl, &hub).await {
        Ok(()) => status(&app, &info.kind, "disconnected", Value::Null),
        Err(e) => {
            eprintln!("ses hatasi: {e}");
            status(&app, &info.kind, "error", json!(e));
        }
    }
}

struct Dave {
    session: Option<DaveSession>,
    version: u16,
    user_id: u64,
    channel_id: u64,
}

impl Dave {
    /// Yeni epoch (1): oturumu (yeniden) kur ve anahtar paketini dondur.
    fn reinit(&mut self) -> Option<Vec<u8>> {
        let v = NonZeroU16::new(self.version)?;
        let res = match &mut self.session {
            Some(s) => s.reinit(v, self.user_id, self.channel_id, None).map_err(|e| e.to_string()),
            None => DaveSession::new(v, self.user_id, self.channel_id, None)
                .map(|s| self.session = Some(s))
                .map_err(|e| e.to_string()),
        };
        if let Err(e) = res {
            eprintln!("DAVE init: {e}");
            return None;
        }
        self.session.as_mut()?.create_key_package().map_err(|e| eprintln!("DAVE keypkg: {e}")).ok()
    }
}

async fn session(app: &AppHandle, info: &VoiceInfo, ctl: Arc<VoiceCtl>, hub: &VideoHub) -> Result<(), String> {
    let host = info.endpoint.trim_start_matches("wss://").trim_end_matches('/');
    let (ws, _) = connect_async(format!("wss://{host}/?v=8")).await.map_err(|e| format!("Ses sunucusu: {e}"))?;
    let (mut tx, mut rx) = ws.split();
    let is_stream = info.kind != ConnKind::Voice;
    // yayin (ekran) mi kamera mi: arayuze giden karenin turu ve kayit anahtari
    let (vkind, vkey, sending) = match &info.kind {
        ConnKind::Voice => (0u8, "camera".to_string(), true),
        ConnKind::Stream { key, sending } => (1u8, key.clone(), *sending),
    };
    let stream_owner = if is_stream { video::stream_owner(&vkey) } else { 0 };
    let identify = json!({"op": 0, "d": {
        "server_id": info.server_id, "user_id": info.user_id, "session_id": info.session_id,
        "token": info.token, "max_dave_protocol_version": DAVE_PROTOCOL_VERSION, "video": true,
        "streams": [{"type": if is_stream {"screen"} else {"video"}, "rid": "100", "quality": 100}]
    }});
    tx.send(Message::Text(identify.to_string())).await.map_err(|e| e.to_string())?;

    let my_id: u64 = info.user_id.parse().unwrap_or(0);
    let mut dave = Dave { session: None, version: 0, user_id: my_id, channel_id: info.channel_id.parse().unwrap_or(0) };
    let mut connected_users: HashSet<u64> = HashSet::new();
    let mut ssrc_user: HashMap<u32, u64> = HashMap::new();
    let mut seq_ack: i64 = -1;

    let mut hb = tokio::time::interval(Duration::from_secs(3600));
    let mut keepalive = tokio::time::interval(Duration::from_secs(5));
    let mut speak_tick = tokio::time::interval(Duration::from_millis(200));

    let mut udp: Option<Arc<UdpSocket>> = None;
    let mut ssrc: u32 = 0;
    let mut cipher: Option<XChaCha20Poly1305> = None;
    let (out_tx, mut out_rx) = unbounded_channel::<Out>();
    let mut _audio: Option<audio::AudioHandle> = None;
    let mixer: Mixer = Arc::new(Mutex::new(HashMap::new()));
    let mut out_info = audio::OutInfo { rate: RATE, channels: 2 };
    let mut decoders: HashMap<u32, (opus::Decoder, Resampler, Resampler)> = HashMap::new();
    let mut last_heard: HashMap<u64, Instant> = HashMap::new();
    let mut speaking_now: Vec<u64> = vec![];
    let (mut rtp_seq, mut rtp_ts, mut nonce): (u16, u32, u32) = (0, 0, 0);
    let mut buf = vec![0u8; 4096];
    // Goruntu
    let (mut vssrc, mut rtx_ssrc): (u32, u32) = (0, 0);
    let (vtx, mut vrx) = unbounded_channel::<VOut>();
    let mut _reg: Option<Registration> = None;
    let mut video_on = false;
    let mut vseq: u16 = 0;
    let started = Instant::now();
    let mut video_users: HashMap<u32, u64> = HashMap::new(); // goruntu ssrc -> kullanici
    let mut rtx_set: HashSet<u32> = HashSet::new();
    let mut depack: HashMap<u32, Depacketizer> = HashMap::new();
    let mut last_pli: HashMap<u32, Instant> = HashMap::new();
    let mut rtcp_nonce: u32 = 0x8000_0000;

    macro_rules! send_json {
        ($v:expr) => {
            tx.send(Message::Text($v.to_string())).await.map_err(|e| e.to_string())?
        };
    }
    macro_rules! send_bin {
        ($op:expr, $data:expr) => {{
            let mut b = vec![$op as u8];
            b.extend_from_slice(&$data);
            tx.send(Message::Binary(b)).await.map_err(|e| e.to_string())?
        }};
    }

    loop {
        // UDP okumayi select icinde kullanabilmek icin ayri referans
        let udp_r = udp.clone();
        tokio::select! {
            _ = hb.tick() => {
                send_json!(json!({"op": 3, "d": {"t": crate::store::now_ms(), "seq_ack": seq_ack}}));
            }
            _ = keepalive.tick(), if udp.is_some() => {
                if let Some(u) = &udp { let _ = u.send(&[0u8; 8]).await; }
            }
            _ = speak_tick.tick(), if cipher.is_some() => {
                let now = Instant::now();
                let mut list: Vec<u64> = last_heard.iter().filter(|(_, t)| now.duration_since(**t) < Duration::from_millis(350)).map(|(u, _)| *u).collect();
                if ctl.self_speaking.load(Ordering::Relaxed) { list.push(my_id); }
                list.sort_unstable();
                if list != speaking_now {
                    speaking_now = list;
                    let ids: Vec<String> = speaking_now.iter().map(|u| u.to_string()).collect();
                    let _ = app.emit("voice-speaking", ids);
                }
            }
            Some(out) = out_rx.recv() => {
                match out {
                    Out::Speaking(on) => {
                        send_json!(json!({"op": 5, "d": {"speaking": if on {1} else {0}, "delay": 0, "ssrc": ssrc}}));
                    }
                    Out::Opus(pkt) => {
                        let (Some(u), Some(c)) = (&udp, &cipher) else { continue };
                        // Uctan uca sifreleme (DAVE)
                        let payload: Vec<u8> = if dave.version > 0 {
                            let Some(s) = dave.session.as_mut() else { continue };
                            if !s.can_encrypt() { continue; }
                            match s.encrypt_opus(&pkt) { Ok(p) => p.into_owned(), Err(_) => continue }
                        } else { pkt };
                        if let Some(p) = seal_rtp(c, rtp_seq, rtp_ts, ssrc, nonce, &payload) {
                            let _ = u.send(&p).await;
                        }
                        rtp_seq = rtp_seq.wrapping_add(1);
                        rtp_ts = rtp_ts.wrapping_add(FRAME as u32);
                        nonce = nonce.wrapping_add(1);
                    }
                }
            }
            Some(v) = vrx.recv() => {
                match v {
                    VOut::Active(on, w, h, fps) => {
                        video_on = on && vssrc != 0;
                        let bitrate = if is_stream { 6_000_000 } else { 2_500_000 };
                        send_json!(json!({"op": 12, "d": {
                            "audio_ssrc": ssrc, "video_ssrc": if video_on { vssrc } else { 0 }, "rtx_ssrc": if video_on { rtx_ssrc } else { 0 },
                            "streams": [{"type": if is_stream {"screen"} else {"video"}, "rid": "100", "ssrc": vssrc, "active": video_on, "quality": 100,
                                "rtx_ssrc": rtx_ssrc, "max_bitrate": bitrate, "max_framerate": fps,
                                "max_resolution": {"type": "fixed", "width": w, "height": h}}]
                        }}));
                        if is_stream {
                            // yayin baglantisinda ses ssrc'si "konusuyor" olmali ki izleyiciler alsin
                            send_json!(json!({"op": 5, "d": {"speaking": if video_on {2} else {0}, "delay": 0, "ssrc": ssrc}}));
                        }
                    }
                    VOut::Frame { data, .. } => {
                        if !video_on { continue; }
                        let (Some(u), Some(c)) = (&udp, &cipher) else { continue };
                        let frame: Vec<u8> = if dave.version > 0 {
                            let Some(s) = dave.session.as_mut() else { continue };
                            if !s.can_encrypt() { continue; }
                            match s.encrypt(MediaType::VIDEO, Codec::H264, &data) { Ok(p) => p.into_owned(), Err(_) => continue }
                        } else { data };
                        let ts = (started.elapsed().as_micros() as u64 * 9 / 100) as u32; // 90 kHz
                        let pkts = video::packetize_h264(&frame);
                        let n = pkts.len();
                        for (i, p) in pkts.into_iter().enumerate() {
                            if let Some(pkt) = video::seal_video(c, vseq, ts, vssrc, nonce, i + 1 == n, &p) {
                                let _ = u.send(&pkt).await;
                            }
                            vseq = vseq.wrapping_add(1);
                            nonce = nonce.wrapping_add(1);
                        }
                    }
                }
            }
            r = async { udp_r.as_ref().unwrap().recv(&mut buf).await }, if udp_r.is_some() && cipher.is_some() => {
                let Ok(len) = r else { continue };
                let Some(c) = &cipher else { continue };
                let pkt = &buf[..len];
                // RTCP: bize anahtar kare istegi geldi mi?
                if len > 8 && (200..=206).contains(&pkt[1]) {
                    if video_on && video::rtcp_keyframe_requests(c, pkt).contains(&vssrc) {
                        let _ = app.emit("video-keyframe", json!({"key": vkey}));
                    }
                    continue;
                }
                let Some(rtp) = video::open_rtp_full(c, pkt) else { continue };
                let pssrc = rtp.ssrc;
                if rtx_set.contains(&pssrc) || rtp.pt == video::PT_RTX { continue; }
                if video_users.contains_key(&pssrc) || rtp.pt == video::PT_H264 {
                    let uid = video_users.get(&pssrc).copied().unwrap_or(if is_stream { stream_owner } else { 0 });
                    if uid == 0 { continue; }
                    let dp = depack.entry(pssrc).or_default();
                    let done = dp.push(rtp.seq, rtp.ts, rtp.marker, &rtp.payload);
                    if dp.need_key && last_pli.get(&pssrc).map_or(true, |t| t.elapsed() > Duration::from_millis(1000)) {
                        last_pli.insert(pssrc, Instant::now());
                        if let (Some(u), Some(p)) = (&udp, video::seal_rtcp(c, rtcp_nonce, &video::pli(ssrc, pssrc))) {
                            rtcp_nonce = rtcp_nonce.wrapping_add(1);
                            let _ = u.send(&p).await;
                        }
                    }
                    let Some(mut frame) = done else { continue };
                    if dave.version > 0 {
                        let Some(s) = dave.session.as_mut() else { continue };
                        match s.decrypt(uid, MediaType::VIDEO, &frame) { Ok(d) => frame = d, Err(_) => continue }
                    }
                    hub.emit(vkind, uid, pssrc, &frame);
                    continue;
                }
                if is_stream || ctl.deafened.load(Ordering::Relaxed) { continue; }
                let mut opus_pkt = rtp.payload;
                let Some(&uid) = ssrc_user.get(&pssrc) else { continue };
                if dave.version > 0 {
                    let Some(s) = dave.session.as_mut() else { continue };
                    match s.decrypt(uid, MediaType::AUDIO, &opus_pkt) { Ok(d) => opus_pkt = d, Err(_) => continue }
                }
                if opus_pkt == davey::OPUS_SILENCE_PACKET { continue; }
                last_heard.insert(uid, Instant::now());
                let dec = match decoders.entry(pssrc) {
                    std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
                    std::collections::hash_map::Entry::Vacant(v) => match opus::Decoder::new(RATE, opus::Channels::Stereo) {
                        Ok(d) => v.insert((d, Resampler::new(RATE, out_info.rate), Resampler::new(RATE, out_info.rate))),
                        Err(_) => continue,
                    },
                };
                let mut pcm = [0f32; FRAME * 2 * 6];
                let Ok(samples) = dec.0.decode_float(&opus_pkt, &mut pcm, false) else { continue };
                let (l, r): (Vec<f32>, Vec<f32>) = pcm[..samples * 2].chunks(2).map(|c| (c[0], c[1])).unzip();
                let (mut lo, mut ro) = (Vec::new(), Vec::new());
                dec.1.process(&l, &mut lo);
                dec.2.process(&r, &mut ro);
                let ch = out_info.channels as usize;
                let mut m = mixer.lock().unwrap();
                let tr = m.entry(pssrc).or_insert_with(|| Track { buf: Default::default(), primed: false });
                for i in 0..lo.len().min(ro.len()) {
                    if ch == 1 { tr.buf.push_back((lo[i] + ro[i]) * 0.5); }
                    else { tr.buf.push_back(lo[i]); tr.buf.push_back(ro[i]); for _ in 2..ch { tr.buf.push_back(0.0); } }
                }
                let per_ms = out_info.rate as usize * ch / 1000;
                if tr.buf.len() > per_ms * 300 { let extra = tr.buf.len() - per_ms * 100; tr.buf.drain(..extra); }
                if tr.buf.len() >= per_ms * 60 { tr.primed = true; }
            }
            msg = rx.next() => {
                let msg = match msg {
                    None => return Ok(()),
                    Some(Err(e)) => return Err(e.to_string()),
                    Some(Ok(m)) => m,
                };
                match msg {
                    Message::Close(f) => {
                        let code = f.map(|f| u16::from(f.code)).unwrap_or(1000);
                        return match code {
                            1000 | 4014 => Ok(()),
                            4017 => Err("Bu kanal uctan uca sifreleme (DAVE) istiyor ve kurulamadi".into()),
                            c => Err(format!("Ses baglantisi kapandi ({c})")),
                        };
                    }
                    Message::Binary(b) => {
                        if b.len() < 3 { continue; }
                        seq_ack = u16::from_be_bytes([b[0], b[1]]) as i64;
                        let op = b[2];
                        let data = &b[3..];
                        let recognized: Vec<u64> = connected_users.iter().copied().chain(std::iter::once(my_id)).collect();
                        match op {
                            25 => { // external sender
                                if let Some(s) = dave.session.as_mut() {
                                    if let Err(e) = s.set_external_sender(data) { eprintln!("DAVE ext sender: {e}"); }
                                }
                            }
                            27 => { // proposals
                                if data.is_empty() { continue; }
                                let optype = if data[0] == 1 { ProposalsOperationType::REVOKE } else { ProposalsOperationType::APPEND };
                                if let Some(s) = dave.session.as_mut() {
                                    match s.process_proposals(optype, &data[1..], Some(recognized.as_slice())) {
                                        Ok(Some(CommitWelcome { commit, welcome })) => {
                                            let mut out = commit;
                                            if let Some(w) = welcome { out.extend_from_slice(&w); }
                                            send_bin!(28, out);
                                        }
                                        Ok(None) => {}
                                        Err(e) => eprintln!("DAVE proposals: {e}"),
                                    }
                                }
                            }
                            29 | 30 => { // announce commit / welcome
                                if data.len() < 2 { continue; }
                                let tid = u16::from_be_bytes([data[0], data[1]]);
                                let body = &data[2..];
                                let version = dave.version;
                                let ok = match dave.session.as_mut() {
                                    Some(s) => {
                                        let r = if op == 29 {
                                            s.process_commit(body).map_err(|e| e.to_string())
                                        } else {
                                            s.process_welcome(body, Some(recognized.as_slice())).map(|_| true).map_err(|e| e.to_string())
                                        };
                                        match r {
                                            Ok(true) => s.prepare_transition(tid, version).is_ok(),
                                            Ok(false) => true,
                                            Err(e) => { eprintln!("DAVE {op}: {e}"); false }
                                        }
                                    }
                                    None => false,
                                };
                                if ok {
                                    if tid != 0 { send_json!(json!({"op": 23, "d": {"transition_id": tid}})); }
                                    else { emit_privacy(app, &dave); }
                                } else {
                                    send_json!(json!({"op": 31, "d": {"transition_id": tid}}));
                                    if let Some(kp) = dave.reinit() { send_bin!(26, kp); }
                                }
                            }
                            _ => {}
                        }
                    }
                    Message::Text(t) => {
                        let v: Value = match serde_json::from_str(&t) { Ok(v) => v, Err(_) => continue };
                        if let Some(s) = v["seq"].as_i64() { seq_ack = s; }
                        let d = &v["d"];
                        match v["op"].as_u64().unwrap_or(99) {
                            8 => { // hello
                                let ms = d["heartbeat_interval"].as_f64().unwrap_or(13750.0) as u64;
                                hb = tokio::time::interval(Duration::from_millis(ms.max(1000)));
                                hb.tick().await;
                            }
                            2 => { // ready
                                ssrc = d["ssrc"].as_u64().unwrap_or(0) as u32;
                                if let Some(st) = d["streams"].as_array().and_then(|a| a.first()) {
                                    vssrc = st["ssrc"].as_u64().unwrap_or(0) as u32;
                                    rtx_ssrc = st["rtx_ssrc"].as_u64().unwrap_or(0) as u32;
                                }
                                let ip = d["ip"].as_str().unwrap_or("").to_string();
                                let port = d["port"].as_u64().unwrap_or(0) as u16;
                                let sock = UdpSocket::bind("0.0.0.0:0").await.map_err(|e| e.to_string())?;
                                sock.connect((ip.as_str(), port)).await.map_err(|e| e.to_string())?;
                                let (addr, p) = ip_discovery(&sock, ssrc).await?;
                                udp = Some(Arc::new(sock));
                                send_json!(json!({"op": 1, "d": {"protocol": "udp", "data": {"address": addr, "port": p, "mode": MODE},
                                    "codecs": [
                                        {"name": "opus", "type": "audio", "priority": 1000, "payload_type": video::PT_OPUS},
                                        {"name": "H264", "type": "video", "priority": 1000, "payload_type": video::PT_H264, "rtx_payload_type": video::PT_RTX, "encode": true, "decode": true}
                                    ]}}));
                            }
                            4 => { // session description
                                let key: Vec<u8> = d["secret_key"].as_array().map(|a| a.iter().filter_map(|x| x.as_u64().map(|n| n as u8)).collect()).unwrap_or_default();
                                if key.len() != 32 { return Err("Gecersiz ses anahtari".into()); }
                                cipher = Some(XChaCha20Poly1305::new_from_slice(&key).map_err(|e| e.to_string())?);
                                dave.version = d["dave_protocol_version"].as_u64().unwrap_or(0) as u16;
                                if dave.version > 0 {
                                    if let Some(kp) = dave.reinit() { send_bin!(26, kp); }
                                }
                                // Goruntu kopruleri: arayuzden gelecek kareler
                                if sending {
                                    hub.senders.lock().unwrap().insert(vkey.clone(), vtx.clone());
                                    _reg = Some(Registration { hub, key: vkey.clone() });
                                }
                                // Goruntuleri almak istedigimizi bildir
                                send_json!(json!({"op": 15, "d": {"any": 100}}));
                                if is_stream {
                                    status(app, &info.kind, "connected", json!({"e2ee": dave.version > 0}));
                                    continue;
                                }
                                // Ses donanimini baslat
                                let (mic_tx, mic_rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(64);
                                let ctl2 = ctl.clone();
                                let mix2 = mixer.clone();
                                let started = tauri::async_runtime::spawn_blocking(move || audio::start(ctl2, mix2, mic_tx)).await.map_err(|e| e.to_string())?;
                                let (h, oi, has_mic) = started?;
                                out_info = oi;
                                _audio = Some(h);
                                spawn_encoder(ctl.clone(), mic_rx, out_tx.clone());
                                status(app, &info.kind, "connected", json!({"e2ee": dave.version > 0, "mic": has_mic}));
                            }
                            5 => { // speaking (ssrc -> kullanici)
                                if let (Some(u), Some(s)) = (d["user_id"].as_str().and_then(|x| x.parse::<u64>().ok()), d["ssrc"].as_u64()) {
                                    ssrc_user.insert(s as u32, u);
                                }
                            }
                            12 => { // goruntu: kullanici ssrc'leri
                                let Some(uid) = d["user_id"].as_str().and_then(|x| x.parse::<u64>().ok()) else { continue };
                                let mut active = false;
                                video_users.retain(|_, u| *u != uid);
                                let vs = d["video_ssrc"].as_u64().unwrap_or(0) as u32;
                                if vs != 0 { video_users.insert(vs, uid); active = true; }
                                for st in d["streams"].as_array().into_iter().flatten() {
                                    let s = st["ssrc"].as_u64().unwrap_or(0) as u32;
                                    let on = st["active"].as_bool().unwrap_or(true);
                                    if s != 0 && on { video_users.insert(s, uid); active = true; }
                                    if let Some(r) = st["rtx_ssrc"].as_u64() { if r != 0 { rtx_set.insert(r as u32); } }
                                }
                                if let Some(a) = d["audio_ssrc"].as_u64() { if a != 0 { ssrc_user.insert(a as u32, uid); } }
                                if !active {
                                    let _ = app.emit("video-end", json!({"kind": vkind, "user_id": uid.to_string()}));
                                }
                            }
                            11 => { // clients connect
                                for u in d["user_ids"].as_array().into_iter().flatten() {
                                    if let Some(id) = u.as_str().and_then(|x| x.parse().ok()) { connected_users.insert(id); }
                                }
                            }
                            13 => { // client disconnect
                                if let Some(id) = d["user_id"].as_str().and_then(|x| x.parse::<u64>().ok()) {
                                    connected_users.remove(&id);
                                    last_heard.remove(&id);
                                    let gone: Vec<u32> = ssrc_user.iter().filter(|(_, u)| **u == id).map(|(s, _)| *s).collect();
                                    for s in gone { ssrc_user.remove(&s); decoders.remove(&s); mixer.lock().unwrap().remove(&s); }
                                    video_users.retain(|_, u| *u != id);
                                    let _ = app.emit("video-end", json!({"kind": vkind, "user_id": id.to_string()}));
                                }
                            }
                            21 => { // prepare transition
                                let tid = d["transition_id"].as_u64().unwrap_or(0) as u16;
                                let pv = d["protocol_version"].as_u64().unwrap_or(0) as u16;
                                if let Some(s) = dave.session.as_mut() {
                                    if pv == 0 { s.set_passthrough_mode(true, Some(10)); }
                                    let _ = s.prepare_transition(tid, pv);
                                }
                                if tid == 0 { dave.version = pv; }
                                else { send_json!(json!({"op": 23, "d": {"transition_id": tid}})); }
                            }
                            22 => { // execute transition
                                let tid = d["transition_id"].as_u64().unwrap_or(0) as u16;
                                if let Some(s) = dave.session.as_mut() {
                                    let _ = s.execute_transition(tid);
                                }
                                emit_privacy(app, &dave);
                            }
                            24 => { // prepare epoch
                                if d["epoch"].as_u64() == Some(1) {
                                    dave.version = d["protocol_version"].as_u64().unwrap_or(0) as u16;
                                    if let Some(kp) = dave.reinit() { send_bin!(26, kp); }
                                }
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

fn emit_privacy(app: &AppHandle, dave: &Dave) {
    let code = dave.session.as_ref().and_then(|s| s.voice_privacy_code()).map(String::from);
    let _ = app.emit("voice-privacy", code);
}

/// RTP paketi olustur + xchacha20 (rtpsize) ile sifrele: header | sifreli veri+etiket | 4 bayt nonce
pub fn seal_rtp(c: &XChaCha20Poly1305, seq: u16, ts: u32, ssrc: u32, nonce: u32, payload: &[u8]) -> Option<Vec<u8>> {
    let mut header = [0u8; 12];
    header[0] = 0x80;
    header[1] = 0x78;
    header[2..4].copy_from_slice(&seq.to_be_bytes());
    header[4..8].copy_from_slice(&ts.to_be_bytes());
    header[8..12].copy_from_slice(&ssrc.to_be_bytes());
    let mut n = [0u8; 24];
    n[..4].copy_from_slice(&nonce.to_be_bytes());
    let ct = c.encrypt(XNonce::from_slice(&n), Payload { msg: payload, aad: &header }).ok()?;
    let mut p = Vec::with_capacity(12 + ct.len() + 4);
    p.extend_from_slice(&header);
    p.extend_from_slice(&ct);
    p.extend_from_slice(&nonce.to_be_bytes());
    Some(p)
}

/// Gelen RTP paketini coz: (ssrc, opus verisi). RTCP / bozuk / sahte paketler icin None.
#[allow(dead_code)] // testlerde kullaniliyor; canli yol video::open_rtp_full
pub fn open_rtp(c: &XChaCha20Poly1305, p: &[u8]) -> Option<(u32, Vec<u8>)> {
    let len = p.len();
    if len < 12 + 16 + 4 || (p[0] >> 6) != 2 {
        return None;
    }
    if (72..=76).contains(&(p[1] & 0x7f)) {
        return None; // RTCP
    }
    let ssrc = u32::from_be_bytes([p[8], p[9], p[10], p[11]]);
    let cc = (p[0] & 0x0f) as usize;
    let has_ext = p[0] & 0x10 != 0;
    let aad_len = 12 + cc * 4 + if has_ext { 4 } else { 0 };
    if len < aad_len + 16 + 4 {
        return None;
    }
    let ext_words = if has_ext { u16::from_be_bytes([p[aad_len - 2], p[aad_len - 1]]) as usize } else { 0 };
    let mut n = [0u8; 24];
    n[..4].copy_from_slice(&p[len - 4..]);
    let plain = c.decrypt(XNonce::from_slice(&n), Payload { msg: &p[aad_len..len - 4], aad: &p[..aad_len] }).ok()?;
    if plain.len() < ext_words * 4 {
        return None;
    }
    Some((ssrc, plain[ext_words * 4..].to_vec()))
}

pub fn discovery_request(ssrc: u32) -> [u8; 74] {
    let mut req = [0u8; 74];
    req[0..2].copy_from_slice(&1u16.to_be_bytes());
    req[2..4].copy_from_slice(&70u16.to_be_bytes());
    req[4..8].copy_from_slice(&ssrc.to_be_bytes());
    req
}

pub fn parse_discovery(resp: &[u8]) -> Option<(String, u16)> {
    if resp.len() < 74 || resp[1] != 2 {
        return None;
    }
    let end = resp[8..72].iter().position(|&b| b == 0).unwrap_or(64);
    let ip = String::from_utf8_lossy(&resp[8..8 + end]).to_string();
    Some((ip, u16::from_be_bytes([resp[72], resp[73]])))
}

/// Discord IP kesfi: dis IP ve portumuzu ogren.
async fn ip_discovery(sock: &UdpSocket, ssrc: u32) -> Result<(String, u16), String> {
    let req = discovery_request(ssrc);
    let mut resp = [0u8; 74];
    for _ in 0..4 {
        sock.send(&req).await.map_err(|e| e.to_string())?;
        if let Ok(Ok(n)) = tokio::time::timeout(Duration::from_secs(2), sock.recv(&mut resp)).await {
            if let Some(r) = parse_discovery(&resp[..n]) {
                return Ok(r);
            }
        }
    }
    Err("UDP IP kesfi basarisiz (guvenlik duvari?)".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cipher() -> XChaCha20Poly1305 {
        XChaCha20Poly1305::new_from_slice(&[7u8; 32]).unwrap()
    }

    #[test]
    fn rtp_roundtrip() {
        let c = cipher();
        let p = seal_rtp(&c, 5, 960, 1234, 42, b"opus-data").unwrap();
        assert_eq!(&p[..2], &[0x80, 0x78]);
        assert_eq!(&p[p.len() - 4..], &42u32.to_be_bytes());
        assert_eq!(open_rtp(&c, &p), Some((1234, b"opus-data".to_vec())));
    }

    #[test]
    fn rtp_rejects_tampered_and_wrong_key() {
        let c = cipher();
        let mut p = seal_rtp(&c, 1, 0, 9, 1, b"abc").unwrap();
        let other = XChaCha20Poly1305::new_from_slice(&[8u8; 32]).unwrap();
        assert!(open_rtp(&other, &p).is_none());
        p[14] ^= 0xff;
        assert!(open_rtp(&c, &p).is_none());
    }

    #[test]
    fn rtp_with_header_extension() {
        // Discord'un gonderdigi gibi: uzanti basligi AAD'de, uzanti govdesi sifreli verinin basinda
        let c = cipher();
        let mut header = vec![0x90, 0x78, 0, 1, 0, 0, 0, 0, 0, 0, 0, 77, 0xBE, 0xDE, 0, 1];
        let mut plain = vec![0x10, 0xAA, 0, 0]; // 1 kelimelik uzanti govdesi
        plain.extend_from_slice(b"voice");
        let mut n = [0u8; 24];
        n[..4].copy_from_slice(&3u32.to_be_bytes());
        let ct = c.encrypt(XNonce::from_slice(&n), Payload { msg: &plain, aad: &header }).unwrap();
        header.extend_from_slice(&ct);
        header.extend_from_slice(&3u32.to_be_bytes());
        assert_eq!(open_rtp(&c, &header), Some((77, b"voice".to_vec())));
    }

    #[test]
    fn rtp_ignores_rtcp_and_short() {
        let c = cipher();
        let mut p = seal_rtp(&c, 1, 0, 9, 1, b"abcdef").unwrap();
        p[1] = 0xC9; // RTCP RR (201)
        assert!(open_rtp(&c, &p).is_none());
        assert!(open_rtp(&c, &[0x80; 10]).is_none());
    }

    #[test]
    fn ip_discovery_packets() {
        let req = discovery_request(0x01020304);
        assert_eq!(&req[..8], &[0, 1, 0, 70, 1, 2, 3, 4]);
        let mut resp = [0u8; 74];
        resp[1] = 2;
        resp[8..19].copy_from_slice(b"203.0.113.5");
        resp[72..74].copy_from_slice(&50000u16.to_be_bytes());
        assert_eq!(parse_discovery(&resp), Some(("203.0.113.5".into(), 50000)));
        assert!(parse_discovery(&resp[..40]).is_none());
    }

    #[test]
    fn dave_session_creates_key_package() {
        let mut d = Dave { session: None, version: DAVE_PROTOCOL_VERSION, user_id: 100, channel_id: 200 };
        let kp = d.reinit().expect("anahtar paketi");
        assert!(!kp.is_empty());
        // Ikinci epoch-1 (yeniden kurulum) da calismali
        assert!(d.reinit().is_some());
        // Surum 0 = DAVE yok
        let mut z = Dave { session: None, version: 0, user_id: 1, channel_id: 2 };
        assert!(z.reinit().is_none());
    }

    #[test]
    fn opus_encode_decode() {
        let mut enc = opus::Encoder::new(RATE, opus::Channels::Stereo, opus::Application::Voip).unwrap();
        let mut dec = opus::Decoder::new(RATE, opus::Channels::Stereo).unwrap();
        let pcm: Vec<f32> = (0..FRAME * 2).map(|i| ((i / 2) as f32 * 0.05).sin() * 0.3).collect();
        let mut pkt = vec![0u8; 4000];
        let n = enc.encode_float(&pcm, &mut pkt).unwrap();
        let mut out = vec![0f32; FRAME * 2];
        assert_eq!(dec.decode_float(&pkt[..n], &mut out, false).unwrap(), FRAME);
    }
}

/// Mikrofon -> VAD -> Opus kodlayici is parcacigi.
fn spawn_encoder(ctl: Arc<VoiceCtl>, mic_rx: std::sync::mpsc::Receiver<Vec<f32>>, out: UnboundedSender<Out>) {
    std::thread::Builder::new()
        .name("shion-opus".into())
        .spawn(move || {
            let Ok(mut enc) = opus::Encoder::new(RATE, opus::Channels::Stereo, opus::Application::Voip) else { return };
            let _ = enc.set_bitrate(opus::Bitrate::Bits(64_000));
            let mut acc: Vec<f32> = Vec::with_capacity(FRAME * 2);
            let mut stereo = vec![0f32; FRAME * 2];
            let mut pkt = vec![0u8; 4000];
            let mut speaking = false;
            let mut hang = 0u32;
            loop {
                let chunk = match mic_rx.recv_timeout(Duration::from_millis(500)) {
                    Ok(c) => c,
                    Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                        if out.is_closed() { return; }
                        continue;
                    }
                    Err(_) => return,
                };
                acc.extend_from_slice(&chunk);
                while acc.len() >= FRAME {
                    let frame: Vec<f32> = acc.drain(..FRAME).collect();
                    let muted = ctl.muted.load(Ordering::Relaxed) || ctl.deafened.load(Ordering::Relaxed);
                    let rms = (frame.iter().map(|s| s * s).sum::<f32>() / FRAME as f32).sqrt();
                    let loud = !muted && if ctl.ptt_mode.load(Ordering::Relaxed) { ctl.ptt_pressed.load(Ordering::Relaxed) } else { rms > ctl.threshold() };
                    if loud { hang = 15; } else if hang > 0 { hang -= 1; }
                    let active = !muted && (loud || hang > 0);
                    if active && !speaking {
                        speaking = true;
                        ctl.self_speaking.store(true, Ordering::Relaxed);
                        if out.send(Out::Speaking(true)).is_err() { return; }
                    }
                    if !active && speaking {
                        speaking = false;
                        ctl.self_speaking.store(false, Ordering::Relaxed);
                        for _ in 0..5 { let _ = out.send(Out::Opus(davey::OPUS_SILENCE_PACKET.to_vec())); }
                        let _ = out.send(Out::Speaking(false));
                    }
                    if !active { continue; }
                    for (i, s) in frame.iter().enumerate() { stereo[i * 2] = *s; stereo[i * 2 + 1] = *s; }
                    if let Ok(n) = enc.encode_float(&stereo, &mut pkt) {
                        if out.send(Out::Opus(pkt[..n].to_vec())).is_err() { return; }
                    }
                }
            }
        })
        .ok();
}
