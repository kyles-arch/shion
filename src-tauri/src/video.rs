//! Goruntu (kamera / ekran paylasimi): H264 RTP paketleme, paket birlestirme, RTCP PLI
//! ve arayuz <-> ses baglantisi arasindaki kare kopruleri.
//!
//! Kodlama/cozme arayuzde (WebView2 WebCodecs, donanim hizlandirmali) yapilir;
//! Rust tarafi sadece sifreleme + RTP + Discord sinyallesmesini ustlenir.

use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::mpsc::UnboundedSender;

pub const PT_H264: u8 = 101;
pub const PT_RTX: u8 = 102;
pub const PT_OPUS: u8 = 120;
const MAX_PAYLOAD: usize = 1100;

/// Arayuzden ses baglantisina giden mesajlar.
pub enum VOut {
    Frame { data: Vec<u8>, key: bool },
    /// Goruntuyu ac/kapat (op 12) — genislik, yukseklik, fps
    Active(bool, u32, u32, u32),
    /// Yayin sesi: 48 kHz stereo, aralikli f32
    Pcm(Vec<f32>),
}

/// Rust -> arayuz kare kanali ve baglantilara giden gondericiler.
#[derive(Default)]
pub struct VideoHub {
    /// "camera" ya da yayin anahtari -> baglanti
    pub senders: Mutex<HashMap<String, UnboundedSender<VOut>>>,
    pub sink: Mutex<Option<Channel<InvokeResponseBody>>>,
}

impl VideoHub {
    /// Cozulmus (ama hala H264) kareyi arayuze gonder.
    /// Baslik: [tur u8][kullanici u64][ssrc u32][anahtar kare u8] + Annex-B kare
    pub fn emit(&self, kind: u8, user: u64, ssrc: u32, frame: &[u8]) {
        let Some(ch) = self.sink.lock().unwrap().clone() else { return };
        let mut b = Vec::with_capacity(14 + frame.len());
        b.push(kind);
        b.extend_from_slice(&user.to_be_bytes());
        b.extend_from_slice(&ssrc.to_be_bytes());
        b.push(is_keyframe(frame) as u8);
        b.extend_from_slice(frame);
        let _ = ch.send(InvokeResponseBody::Raw(b));
    }
}

/// Kayit kaldirilinca gondericiyi silen bekci.
pub struct Registration<'a> {
    pub hub: &'a VideoHub,
    pub key: String,
}
impl Drop for Registration<'_> {
    fn drop(&mut self) {
        self.hub.senders.lock().unwrap().remove(&self.key);
    }
}

/// Annex-B karesini NAL birimlerine ayir (baslangic kodlari haric).
pub fn split_nals(frame: &[u8]) -> Vec<&[u8]> {
    let mut starts = vec![]; // (baslangic kodu konumu, veri konumu)
    let mut i = 0;
    while i + 3 <= frame.len() {
        if frame[i] == 0 && frame[i + 1] == 0 && frame[i + 2] == 1 {
            let sc = if i > 0 && frame[i - 1] == 0 { i - 1 } else { i };
            starts.push((sc, i + 3));
            i += 3;
        } else {
            i += 1;
        }
    }
    if starts.is_empty() {
        return if frame.is_empty() { vec![] } else { vec![frame] };
    }
    let mut out = vec![];
    for (k, &(_, data)) in starts.iter().enumerate() {
        let end = starts.get(k + 1).map(|s| s.0).unwrap_or(frame.len());
        if end > data {
            out.push(&frame[data..end]);
        }
    }
    out
}

pub fn is_keyframe(frame: &[u8]) -> bool {
    split_nals(frame).iter().any(|n| matches!(n[0] & 0x1f, 5 | 7))
}

/// Bir H264 karesini RTP yuklerine bol (tek NAL ya da FU-A parcalari).
pub fn packetize_h264(frame: &[u8]) -> Vec<Vec<u8>> {
    let mut out = vec![];
    for nal in split_nals(frame) {
        if nal.len() <= MAX_PAYLOAD {
            out.push(nal.to_vec());
            continue;
        }
        let hdr = nal[0];
        let ind = (hdr & 0xe0) | 28;
        let typ = hdr & 0x1f;
        let body = &nal[1..];
        let chunks: Vec<&[u8]> = body.chunks(MAX_PAYLOAD - 2).collect();
        let n = chunks.len();
        for (i, c) in chunks.into_iter().enumerate() {
            let mut fu = Vec::with_capacity(c.len() + 2);
            fu.push(ind);
            fu.push(typ | if i == 0 { 0x80 } else { 0 } | if i + 1 == n { 0x40 } else { 0 });
            fu.extend_from_slice(c);
            out.push(fu);
        }
    }
    out
}

/// Yarim kare: genisletilmis sira no -> (yuk, marker)
#[derive(Default)]
struct Asm {
    ts: u32,
    pkts: BTreeMap<i64, (Vec<u8>, bool)>,
}

/// Gelen RTP yuklerinden kareleri yeniden olusturur. Sirasi karisan paketleri bekler
/// (internette olagan); gercek kayipta kareyi atar ve anahtar kare ister.
pub struct Depacketizer {
    /// en yuksek genisletilmis sira no (16 bit tasmasina karsi)
    high: Option<i64>,
    /// son tamamlanan/atilan karenin son paketi
    done_end: Option<i64>,
    frames: Vec<Asm>,
    /// anahtar kare gerekli mi (PLI gonderilir). Baslangicta true: yayina ortadan katilinca
    /// ilk kareler delta olur ve anahtar kare istenmezse goruntu hic gelmez.
    pub need_key: bool,
}

impl Default for Depacketizer {
    fn default() -> Self {
        Self { high: None, done_end: None, frames: Vec::new(), need_key: true }
    }
}

const MAX_PENDING_FRAMES: usize = 5;

fn is_start(p: &[u8]) -> bool {
    match p.first().map(|b| b & 0x1f) {
        Some(1..=24) => true,
        Some(28) => p.len() >= 2 && p[1] & 0x80 != 0,
        _ => false,
    }
}

/// Paket yuklerinden Annex-B kare. Bozuk yapi -> None.
fn assemble(pkts: &BTreeMap<i64, (Vec<u8>, bool)>) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    let mut in_fu = false;
    for (payload, _) in pkts.values() {
        if payload.is_empty() {
            continue; // dolgu paketi
        }
        match payload[0] & 0x1f {
            1..=23 => {
                buf.extend_from_slice(&[0, 0, 0, 1]);
                buf.extend_from_slice(payload);
            }
            24 => {
                let mut i = 1;
                while i + 2 <= payload.len() {
                    let n = u16::from_be_bytes([payload[i], payload[i + 1]]) as usize;
                    i += 2;
                    if i + n > payload.len() {
                        return None;
                    }
                    buf.extend_from_slice(&[0, 0, 0, 1]);
                    buf.extend_from_slice(&payload[i..i + n]);
                    i += n;
                }
            }
            28 if payload.len() >= 2 => {
                let (start, end) = (payload[1] & 0x80 != 0, payload[1] & 0x40 != 0);
                if start {
                    buf.extend_from_slice(&[0, 0, 0, 1, (payload[0] & 0xe0) | (payload[1] & 0x1f)]);
                    in_fu = true;
                } else if !in_fu {
                    return None;
                }
                buf.extend_from_slice(&payload[2..]);
                if end {
                    in_fu = false;
                }
            }
            _ => return None,
        }
    }
    if buf.is_empty() { None } else { Some(buf) }
}

impl Depacketizer {
    fn ext(&mut self, seq: u16) -> i64 {
        let e = match self.high {
            None => seq as i64,
            Some(h) => h + (seq.wrapping_sub(h as u16) as i16) as i64,
        };
        if self.high.map_or(true, |h| e > h) {
            self.high = Some(e);
        }
        e
    }

    /// Kare tamam mi: marker var, araliksiz, basi dogru.
    fn complete(&self, a: &Asm) -> Option<i64> {
        let (&last, (_, marker)) = a.pkts.iter().next_back()?;
        if !marker {
            return None;
        }
        let (&first, (fp, _)) = a.pkts.iter().next()?;
        if (last - first + 1) as usize != a.pkts.len() {
            return None;
        }
        let starts_right = self.done_end == Some(first - 1) || is_start(fp);
        if starts_right { Some(last) } else { None }
    }

    /// Paketi ekle; bir kare tamamlandiysa Annex-B kareyi dondur.
    pub fn push(&mut self, seq: u16, ts: u32, marker: bool, payload: &[u8]) -> Option<Vec<u8>> {
        let e = self.ext(seq);
        if self.done_end.map_or(false, |d| e <= d) {
            return None; // gec kalan / tekrar paket
        }
        let idx = match self.frames.iter().position(|f| f.ts == ts) {
            Some(i) => i,
            None => {
                self.frames.push(Asm { ts, pkts: BTreeMap::new() });
                self.frames.len() - 1
            }
        };
        self.frames[idx].pkts.insert(e, (payload.to_vec(), marker));
        // Cok fazla yarim kare: en eskiyi kayip say
        if self.frames.len() > MAX_PENDING_FRAMES {
            let old = self.frames.remove(0);
            if let Some((&last, _)) = old.pkts.iter().next_back() {
                self.done_end = Some(self.done_end.map_or(last, |d| d.max(last)));
            }
            self.need_key = true;
        }
        // Tamamlanan kareyi bul (siraya gore once en eskiler)
        let mut order: Vec<usize> = (0..self.frames.len()).collect();
        order.sort_by_key(|&i| self.frames[i].pkts.keys().next().copied().unwrap_or(i64::MAX));
        let hit = order.into_iter().find_map(|i| self.complete(&self.frames[i]).map(|end| (i, end)))?;
        let (i, end) = hit;
        let asm = self.frames.remove(i);
        let first = *asm.pkts.keys().next().unwrap();
        // Bu kareden once baslayan yarim kareler artik tamamlanamaz -> kayip
        let before = self.frames.len();
        self.frames.retain(|f| f.pkts.keys().next().map_or(false, |&k| k > end));
        if self.frames.len() != before || self.done_end.map_or(false, |d| d + 1 < first) {
            self.need_key = true;
        }
        self.done_end = Some(end);
        let Some(frame) = assemble(&asm.pkts) else {
            self.need_key = true;
            return None;
        };
        if is_keyframe(&frame) {
            self.need_key = false;
        } else if self.need_key {
            return None; // anahtar kare gelene kadar cozulemez
        }
        Some(frame)
    }
}

/// Gelen RTP basligi + cozulmus yuk.
#[derive(Debug, PartialEq)]
pub struct Rtp {
    pub ssrc: u32,
    pub seq: u16,
    pub ts: u32,
    pub pt: u8,
    pub marker: bool,
    pub payload: Vec<u8>,
}

/// Goruntu RTP paketi (playout-delay uzantili) olustur + rtpsize sifrele.
pub fn seal_video(c: &XChaCha20Poly1305, seq: u16, ts: u32, ssrc: u32, nonce: u32, marker: bool, payload: &[u8]) -> Option<Vec<u8>> {
    let mut header = [0u8; 16];
    header[0] = 0x90; // V=2, X=1
    header[1] = PT_H264 | if marker { 0x80 } else { 0 };
    header[2..4].copy_from_slice(&seq.to_be_bytes());
    header[4..8].copy_from_slice(&ts.to_be_bytes());
    header[8..12].copy_from_slice(&ssrc.to_be_bytes());
    header[12..16].copy_from_slice(&[0xBE, 0xDE, 0, 1]);
    // uzanti govdesi: id 5 (playout-delay), 3 bayt = 0 gecikme
    let mut plain = Vec::with_capacity(4 + payload.len());
    plain.extend_from_slice(&[0x52, 0, 0, 0]);
    plain.extend_from_slice(payload);
    let mut n = [0u8; 24];
    n[..4].copy_from_slice(&nonce.to_be_bytes());
    let ct = c.encrypt(XNonce::from_slice(&n), Payload { msg: &plain, aad: &header }).ok()?;
    let mut p = Vec::with_capacity(16 + ct.len() + 4);
    p.extend_from_slice(&header);
    p.extend_from_slice(&ct);
    p.extend_from_slice(&nonce.to_be_bytes());
    Some(p)
}

/// Sifreli RTCP paketi: ilk 8 bayt acik (AAD), gerisi sifreli, sonda nonce.
pub fn seal_rtcp(c: &XChaCha20Poly1305, nonce: u32, pkt: &[u8]) -> Option<Vec<u8>> {
    if pkt.len() < 8 {
        return None;
    }
    let mut n = [0u8; 24];
    n[..4].copy_from_slice(&nonce.to_be_bytes());
    let ct = c.encrypt(XNonce::from_slice(&n), Payload { msg: &pkt[8..], aad: &pkt[..8] }).ok()?;
    let mut p = pkt[..8].to_vec();
    p.extend_from_slice(&ct);
    p.extend_from_slice(&nonce.to_be_bytes());
    Some(p)
}

/// Anahtar kare istegi (PLI).
pub fn pli(sender: u32, media: u32) -> [u8; 12] {
    let mut p = [0u8; 12];
    p[0] = 0x81; // V=2, FMT=1
    p[1] = 206; // PSFB
    p[2..4].copy_from_slice(&2u16.to_be_bytes());
    p[4..8].copy_from_slice(&sender.to_be_bytes());
    p[8..12].copy_from_slice(&media.to_be_bytes());
    p
}

/// Gelen sifreli RTCP icinde bize yonelik PLI/FIR var mi? (medya ssrc listesi)
pub fn rtcp_keyframe_requests(c: &XChaCha20Poly1305, p: &[u8]) -> Vec<u32> {
    let len = p.len();
    if len < 8 + 16 + 4 || (p[0] >> 6) != 2 || !(200..=206).contains(&p[1]) {
        return vec![];
    }
    let mut n = [0u8; 24];
    n[..4].copy_from_slice(&p[len - 4..]);
    let Ok(rest) = c.decrypt(XNonce::from_slice(&n), Payload { msg: &p[8..len - 4], aad: &p[..8] }) else { return vec![] };
    let mut whole = p[..8].to_vec();
    whole.extend_from_slice(&rest);
    let mut out = vec![];
    let mut i = 0;
    while i + 4 <= whole.len() {
        let fmt = whole[i] & 0x1f;
        let pt = whole[i + 1];
        let words = u16::from_be_bytes([whole[i + 2], whole[i + 3]]) as usize;
        let end = (i + (words + 1) * 4).min(whole.len());
        if pt == 206 && (fmt == 1 || fmt == 4) && end >= i + 12 {
            let media = if fmt == 1 { &whole[i + 8..i + 12] } else if end >= i + 16 { &whole[i + 12..i + 16] } else { &whole[i + 8..i + 12] };
            out.push(u32::from_be_bytes([media[0], media[1], media[2], media[3]]));
        }
        i = end.max(i + 4);
    }
    out
}

/// Gelen RTP paketini coz (tum baslik bilgileriyle). RTCP ise None.
pub fn open_rtp_full(c: &XChaCha20Poly1305, p: &[u8]) -> Option<Rtp> {
    let len = p.len();
    if len < 12 + 16 + 4 || (p[0] >> 6) != 2 || (72..=78).contains(&(p[1] & 0x7f)) {
        return None;
    }
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
    let mut payload = plain[ext_words * 4..].to_vec();
    // RTP dolgu (padding) biti
    if p[0] & 0x20 != 0 {
        let pad = *payload.last()? as usize;
        if pad == 0 || pad > payload.len() {
            return None;
        }
        payload.truncate(payload.len() - pad);
    }
    Some(Rtp {
        ssrc: u32::from_be_bytes([p[8], p[9], p[10], p[11]]),
        seq: u16::from_be_bytes([p[2], p[3]]),
        ts: u32::from_be_bytes([p[4], p[5], p[6], p[7]]),
        pt: p[1] & 0x7f,
        marker: p[1] & 0x80 != 0,
        payload,
    })
}

/// Yayin anahtari: guild:<sunucu>:<kanal>:<kullanici> | call:<kanal>:<kullanici>
pub fn stream_key(guild_id: Option<&str>, channel_id: &str, user_id: &str) -> String {
    match guild_id {
        Some(g) => format!("guild:{g}:{channel_id}:{user_id}"),
        None => format!("call:{channel_id}:{user_id}"),
    }
}

pub fn stream_owner(key: &str) -> u64 {
    key.rsplit(':').next().and_then(|s| s.parse().ok()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chacha20poly1305::KeyInit;

    fn frame(nals: &[Vec<u8>]) -> Vec<u8> {
        let mut f = vec![];
        for (i, n) in nals.iter().enumerate() {
            f.extend_from_slice(if i == 0 { &[0, 0, 0, 1][..] } else { &[0, 0, 1][..] });
            f.extend_from_slice(n);
        }
        f
    }

    fn big_nal(typ: u8, len: usize) -> Vec<u8> {
        let mut n = vec![0x60 | typ];
        n.extend((0..len).map(|i| (i % 251) as u8 | 1)); // sifir dizisi icermesin
        n
    }

    #[test]
    fn split_handles_3_and_4_byte_start_codes() {
        let f = frame(&[vec![0x67, 1, 2], vec![0x68, 3], vec![0x65, 4, 5, 6]]);
        let n = split_nals(&f);
        assert_eq!(n, vec![&[0x67, 1, 2][..], &[0x68, 3][..], &[0x65, 4, 5, 6][..]]);
        assert!(is_keyframe(&f));
        assert!(!is_keyframe(&frame(&[vec![0x41, 9]])));
    }

    #[test]
    fn packetize_and_depacketize_roundtrip() {
        let original = frame(&[vec![0x67, 0x42, 0xe0, 0x1f], vec![0x68, 0xce, 0x3c], big_nal(5, 5000)]);
        let pkts = packetize_h264(&original);
        assert!(pkts.len() > 3, "buyuk NAL FU-A ile bolunmeli");
        assert!(pkts.iter().all(|p| p.len() <= MAX_PAYLOAD));
        let mut d = Depacketizer::default();
        let mut got = None;
        for (i, p) in pkts.iter().enumerate() {
            got = d.push(100 + i as u16, 9000, i + 1 == pkts.len(), p);
        }
        let got = got.expect("kare tamamlanmali");
        // Tum NAL'lar 4 baytlik baslangic koduyla geri gelir
        assert_eq!(split_nals(&got), split_nals(&original));
    }

    #[test]
    fn depacketizer_drops_frames_with_loss_until_keyframe() {
        let key = frame(&[vec![0x67, 1], big_nal(5, 3000)]);
        let delta = frame(&[big_nal(1, 2500)]);
        let mut d = Depacketizer::default();
        let mut seq = 0u16;
        let mut send = |d: &mut Depacketizer, f: &[u8], ts: u32, skip: Option<usize>| {
            let pk = packetize_h264(f);
            let mut out = None;
            for (i, p) in pk.iter().enumerate() {
                if Some(i) != skip {
                    out = d.push(seq, ts, i + 1 == pk.len(), p);
                }
                seq = seq.wrapping_add(1);
            }
            out
        };
        assert!(d.need_key, "baslangicta anahtar kare istenmeli");
        assert!(send(&mut d, &delta, 0, None).is_none(), "anahtar kareden once delta atilmali");
        assert!(send(&mut d, &key, 1, None).is_some());
        assert!(!d.need_key);
        assert!(send(&mut d, &delta, 2, None).is_some());
        assert!(send(&mut d, &delta, 3, Some(1)).is_none(), "kayipli kare atilmali");
        assert!(send(&mut d, &delta, 4, None).is_none(), "anahtar kare beklenmeli");
        assert!(d.need_key);
        assert!(send(&mut d, &key, 5, None).is_some());
        assert!(!d.need_key);
    }

    #[test]
    fn depacketizer_tolerates_reordering_and_wraparound() {
        let key = frame(&[vec![0x67, 1], big_nal(5, 4000)]);
        let delta = frame(&[big_nal(1, 3000)]);
        let mut d = Depacketizer::default();
        let mut seq = 65_530u16; // 16 bit tasmasi kare ortasinda
        let mut got = 0;
        for (n, (f, ts)) in [(&key, 10u32), (&delta, 20), (&delta, 30), (&key, 40)].into_iter().enumerate() {
            let pk = packetize_h264(f);
            let mut order: Vec<usize> = (0..pk.len()).collect();
            // sirayi karistir: komsulari takas et, sonuncuyu (marker) en basa al
            for i in (0..order.len().saturating_sub(1)).step_by(2) { order.swap(i, i + 1); }
            if n % 2 == 1 { order.rotate_right(1); }
            for i in order {
                if let Some(fr) = d.push(seq.wrapping_add(i as u16), ts, i + 1 == pk.len(), &pk[i]) {
                    assert_eq!(split_nals(&fr), split_nals(f));
                    got += 1;
                }
            }
            seq = seq.wrapping_add(pk.len() as u16);
        }
        assert_eq!(got, 4, "sirasi karisan paketlerle tum kareler tamamlanmali");
        assert!(!d.need_key);
        // tekrar gelen eski paket yok sayilir
        assert!(d.push(seq.wrapping_sub(1), 40, true, &[0x41, 1]).is_none());
    }

    #[test]
    fn stap_a_is_unpacked() {
        let mut stap = vec![24u8];
        for n in [&[0x67u8, 1, 2][..], &[0x68, 3][..]] {
            stap.extend_from_slice(&(n.len() as u16).to_be_bytes());
            stap.extend_from_slice(n);
        }
        let mut d = Depacketizer::default();
        assert!(d.push(1, 1, false, &stap).is_none());
        let f = d.push(2, 1, true, &big_nal(5, 10)).unwrap();
        assert_eq!(split_nals(&f).len(), 3);
    }

    #[test]
    fn video_rtp_roundtrip_and_rtcp_pli() {
        let c = XChaCha20Poly1305::new_from_slice(&[3u8; 32]).unwrap();
        let p = seal_video(&c, 7, 90000, 555, 9, true, b"nal").unwrap();
        let r = open_rtp_full(&c, &p).unwrap();
        assert_eq!((r.ssrc, r.seq, r.ts, r.pt, r.marker), (555, 7, 90000, PT_H264, true));
        assert_eq!(r.payload, b"nal");
        // PLI: bizim goruntu ssrc'mize anahtar kare istegi
        let rtcp = seal_rtcp(&c, 1, &pli(42, 555)).unwrap();
        assert!(open_rtp_full(&c, &rtcp).is_none(), "RTCP, RTP sanilmamali");
        assert_eq!(rtcp_keyframe_requests(&c, &rtcp), vec![555]);
    }

    #[test]
    fn stream_keys() {
        assert_eq!(stream_key(Some("1"), "2", "3"), "guild:1:2:3");
        assert_eq!(stream_key(None, "2", "3"), "call:2:3");
        assert_eq!(stream_owner("guild:1:2:345"), 345);
    }
}
