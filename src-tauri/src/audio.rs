//! Ses donanimi: mikrofon yakalama, hoparlor cikisi, yeniden ornekleme ve karistirma (cpal).

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::SyncSender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const RATE: u32 = 48_000;

/// Uygulama genelindeki ses ayarlari / durumu.
pub struct VoiceCtl {
    pub muted: AtomicBool,
    pub deafened: AtomicBool,
    pub self_speaking: AtomicBool,
    /// VAD esigi (f32 bitleri)
    pub threshold: AtomicU32,
    /// Cikis ses seviyesi (f32 bitleri, 1.0 = %100)
    pub volume: AtomicU32,
    pub input_device: Mutex<Option<String>>,
    pub output_device: Mutex<Option<String>>,
    /// Bas-konus modu ve tusun basili olup olmadigi
    pub ptt_mode: AtomicBool,
    pub ptt_pressed: AtomicBool,
    /// RNNoise gurultu engelleme
    pub noise: AtomicBool,
    /// Kisi basi ses seviyesi (kullanici id -> carpan)
    pub user_volume: Mutex<HashMap<u64, f32>>,
}

impl Default for VoiceCtl {
    fn default() -> Self {
        Self {
            muted: AtomicBool::new(false),
            deafened: AtomicBool::new(false),
            self_speaking: AtomicBool::new(false),
            threshold: AtomicU32::new(0.012f32.to_bits()),
            volume: AtomicU32::new(1.0f32.to_bits()),
            input_device: Mutex::new(None),
            output_device: Mutex::new(None),
            ptt_mode: AtomicBool::new(false),
            ptt_pressed: AtomicBool::new(false),
            noise: AtomicBool::new(true),
            user_volume: Mutex::new(HashMap::new()),
        }
    }
}

impl VoiceCtl {
    pub fn threshold(&self) -> f32 {
        f32::from_bits(self.threshold.load(Ordering::Relaxed))
    }
    pub fn volume(&self) -> f32 {
        f32::from_bits(self.volume.load(Ordering::Relaxed))
    }
    pub fn user_volume(&self, uid: u64) -> f32 {
        self.user_volume.lock().unwrap().get(&uid).copied().unwrap_or(1.0)
    }
}

/// Sistem sesi yakalama (yayin sesi): Shion ve alt surecleri HARIC tum sesler, 48 kHz stereo.
/// Windows 10 2004+ "process loopback" ile — boylece sesli sohbet yayina yanki olarak gitmez.
#[cfg(windows)]
pub fn start_system_capture(mut sink: impl FnMut(Vec<f32>) + Send + 'static) -> Result<AudioHandle, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop2 = stop.clone();
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::Builder::new()
        .name("shion-sysaudio".into())
        .spawn(move || {
            let _ = wasapi::initialize_mta();
            let setup = (|| -> Result<_, String> {
                let fmt = wasapi::WaveFormat::new(32, 32, &wasapi::SampleType::Float, RATE as usize, 2, None);
                // include_tree=false -> bu surec agacini HARIC tut
                let mut client = wasapi::AudioClient::new_application_loopback_client(std::process::id(), false).map_err(|e| e.to_string())?;
                let mode = wasapi::StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 0 };
                client.initialize_client(&fmt, &wasapi::Direction::Capture, &mode).map_err(|e| e.to_string())?;
                let ev = client.set_get_eventhandle().map_err(|e| e.to_string())?;
                let cap = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
                client.start_stream().map_err(|e| e.to_string())?;
                Ok((client, ev, cap))
            })();
            let (client, ev, cap) = match setup {
                Ok(x) => {
                    let _ = ready_tx.send(Ok(()));
                    x
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                    return;
                }
            };
            let mut q: VecDeque<u8> = VecDeque::new();
            while !stop2.load(Ordering::Relaxed) {
                let _ = ev.wait_for_event(100); // ses yokken olay gelmez: zaman asimi normal
                loop {
                    match cap.get_next_packet_size() {
                        Ok(Some(n)) if n > 0 => {
                            if cap.read_from_device_to_deque(&mut q).is_err() {
                                break;
                            }
                        }
                        _ => break,
                    }
                }
                if q.len() >= 8 {
                    let n = q.len() / 4 * 4;
                    let bytes: Vec<u8> = q.drain(..n).collect();
                    sink(bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect());
                }
            }
            let _ = client.stop_stream();
        })
        .map_err(|e| e.to_string())?;
    ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "Ses yakalama zaman asimi".to_string())??;
    Ok(AudioHandle { stop })
}
#[cfg(not(windows))]
pub fn start_system_capture(_sink: impl FnMut(Vec<f32>) + Send + 'static) -> Result<AudioHandle, String> {
    Err("Desteklenmiyor".into())
}

/// Tek kanalli lineer yeniden ornekleyici (bloklar arasi durumu korur).
pub struct Resampler {
    step: f64,
    pos: f64,
    last: f32,
}

impl Resampler {
    pub fn new(from: u32, to: u32) -> Self {
        // pos = 0: ilk cikis ornegi ilk giris ornegidir (onceden sahte 0 ile basliyordu -> tik sesi)
        Self { step: from as f64 / to as f64, pos: 0.0, last: 0.0 }
    }
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        let n = input.len();
        if n == 0 {
            return;
        }
        if (self.step - 1.0).abs() < 1e-9 {
            out.extend_from_slice(input);
            return;
        }
        let mut t = self.pos;
        while t < (n - 1) as f64 {
            let i = t.floor();
            let frac = (t - i) as f32;
            let i = i as isize;
            let a = if i < 0 { self.last } else { input[i as usize] };
            let b = input[(i + 1) as usize];
            out.push(a + (b - a) * frac);
            t += self.step;
        }
        self.pos = t - n as f64;
        self.last = input[n - 1];
    }
}

/// RNNoise (nnnoiseless) ile 48 kHz mono gurultu engelleme. 480 orneklik (10 ms) bloklarla calisir.
pub struct Denoiser {
    st: Box<nnnoiseless::DenoiseState<'static>>,
    pending: Vec<f32>,
    frame_out: [f32; nnnoiseless::DenoiseState::FRAME_SIZE],
}

impl Denoiser {
    pub const FRAME: usize = nnnoiseless::DenoiseState::FRAME_SIZE;
    pub fn new() -> Self {
        Self { st: nnnoiseless::DenoiseState::new(), pending: Vec::with_capacity(Self::FRAME * 4), frame_out: [0.0; Self::FRAME] }
    }
    /// Girdi -1..1 araliginda; tam bloklar islenip `out`a eklenir (kalan bir sonraki cagriya kalir).
    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        self.pending.extend(input.iter().map(|v| v * 32767.0));
        let mut done = 0;
        while self.pending.len() - done >= Self::FRAME {
            self.st.process_frame(&mut self.frame_out, &self.pending[done..done + Self::FRAME]);
            out.extend(self.frame_out.iter().map(|v| (v / 32767.0).clamp(-1.0, 1.0)));
            done += Self::FRAME;
        }
        self.pending.drain(..done);
    }
}

/// Kullanici (SSRC) basina cikis kuyrugu.
pub struct Track {
    pub buf: VecDeque<f32>,
    pub primed: bool,
}
pub type Mixer = Arc<Mutex<HashMap<u32, Track>>>;

pub struct OutInfo {
    pub rate: u32,
    pub channels: u16,
}

/// Ses aygitlarini acan is parcacigi. `stop` true olunca akislar kapanir.
pub struct AudioHandle {
    pub stop: Arc<AtomicBool>,
}
impl Drop for AudioHandle {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

pub fn list_devices() -> (Vec<String>, Vec<String>) {
    let host = cpal::default_host();
    let ins = host
        .input_devices()
        .map(|d| d.filter_map(|x| x.name().ok()).collect())
        .unwrap_or_default();
    let outs = host
        .output_devices()
        .map(|d| d.filter_map(|x| x.name().ok()).collect())
        .unwrap_or_default();
    (ins, outs)
}

fn find_device(input: bool, name: &Option<String>) -> Option<cpal::Device> {
    let host = cpal::default_host();
    if let Some(n) = name {
        let found = if input { host.input_devices().ok() } else { host.output_devices().ok() }
            .and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(n.as_str())));
        if found.is_some() {
            return found;
        }
    }
    if input {
        host.default_input_device()
    } else {
        host.default_output_device()
    }
}

/// Mikrofon + hoparloru baslatir. Mikrofon ornekleri 48 kHz mono olarak `mic_tx`'e gider.
/// Donus: (handle, cikis bilgisi, mikrofon var mi)
pub fn start(ctl: Arc<VoiceCtl>, mixer: Mixer, mic_tx: Option<SyncSender<Vec<f32>>>) -> Result<(AudioHandle, OutInfo, bool), String> {
    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(OutInfo, bool), String>>();
    let stop2 = stop.clone();
    std::thread::Builder::new()
        .name("shion-audio".into())
        .spawn(move || {
            let built = (|| -> Result<(Stream, Option<Stream>, OutInfo), String> {
                let out = build_output(&ctl, mixer)?;
                let inp = match mic_tx.map(|tx| build_input(&ctl, tx)) {
                    Some(Ok(s)) => Some(s),
                    Some(Err(e)) => {
                        eprintln!("mikrofon acilamadi: {e}");
                        None
                    }
                    None => None,
                };
                Ok((out.0, inp, out.1))
            })();
            match built {
                Ok((out, inp, info)) => {
                    let has_mic = inp.is_some();
                    let _ = ready_tx.send(Ok((info, has_mic)));
                    while !stop2.load(Ordering::Relaxed) {
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    drop(inp);
                    drop(out);
                }
                Err(e) => {
                    let _ = ready_tx.send(Err(e));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    let (info, has_mic) = ready_rx
        .recv_timeout(Duration::from_secs(8))
        .map_err(|_| "Ses aygiti zaman asimi".to_string())??;
    Ok((AudioHandle { stop }, info, has_mic))
}

fn build_output(ctl: &Arc<VoiceCtl>, mixer: Mixer) -> Result<(Stream, OutInfo), String> {
    let name = ctl.output_device.lock().unwrap().clone();
    let dev = find_device(false, &name).ok_or("Hoparlor bulunamadi")?;
    let sup = dev.default_output_config().map_err(|e| e.to_string())?;
    let fmt = sup.sample_format();
    let cfg: cpal::StreamConfig = sup.into();
    let info = OutInfo { rate: cfg.sample_rate.0, channels: cfg.channels };
    let ctl = ctl.clone();
    let err = |e| eprintln!("cikis hatasi: {e}");

    // Tum kuyruklari toplayarak f32 tampon doldur
    let fill = move |out: &mut [f32]| {
        let deaf = ctl.deafened.load(Ordering::Relaxed);
        let vol = ctl.volume();
        for s in out.iter_mut() {
            *s = 0.0;
        }
        let mut m = mixer.lock().unwrap();
        for tr in m.values_mut() {
            if !tr.primed {
                continue;
            }
            for s in out.iter_mut() {
                match tr.buf.pop_front() {
                    Some(v) => *s += v,
                    None => {
                        tr.primed = false;
                        break;
                    }
                }
            }
        }
        drop(m);
        if deaf {
            out.iter_mut().for_each(|s| *s = 0.0);
        } else {
            out.iter_mut().for_each(|s| *s = (*s * vol).clamp(-1.0, 1.0));
        }
    };

    let stream = match fmt {
        SampleFormat::F32 => dev.build_output_stream(&cfg, move |d: &mut [f32], _| fill(d), err, None),
        SampleFormat::I16 => {
            let mut tmp = Vec::new();
            dev.build_output_stream(
                &cfg,
                move |d: &mut [i16], _| {
                    tmp.resize(d.len(), 0.0);
                    fill(&mut tmp);
                    for (o, v) in d.iter_mut().zip(&tmp) {
                        *o = (v * i16::MAX as f32) as i16;
                    }
                },
                err,
                None,
            )
        }
        SampleFormat::U16 => {
            let mut tmp = Vec::new();
            dev.build_output_stream(
                &cfg,
                move |d: &mut [u16], _| {
                    tmp.resize(d.len(), 0.0);
                    fill(&mut tmp);
                    for (o, v) in d.iter_mut().zip(&tmp) {
                        *o = ((v * 0.5 + 0.5) * u16::MAX as f32) as u16;
                    }
                },
                err,
                None,
            )
        }
        f => return Err(format!("Desteklenmeyen cikis formati: {f:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok((stream, info))
}

fn build_input(ctl: &Arc<VoiceCtl>, mic_tx: SyncSender<Vec<f32>>) -> Result<Stream, String> {
    let name = ctl.input_device.lock().unwrap().clone();
    let dev = find_device(true, &name).ok_or("Mikrofon bulunamadi")?;
    let sup = dev.default_input_config().map_err(|e| e.to_string())?;
    let fmt = sup.sample_format();
    let cfg: cpal::StreamConfig = sup.into();
    let ch = cfg.channels.max(1) as usize;
    let mut rs = Resampler::new(cfg.sample_rate.0, RATE);
    let err = |e| eprintln!("giris hatasi: {e}");
    let ctl = ctl.clone();
    let mut dn = Denoiser::new();
    let mut tmp = Vec::new();

    // Cok kanalli -> mono -> 48 kHz (-> gurultu engelleme)
    let mut push = move |mono: &[f32]| {
        let mut out = Vec::with_capacity(mono.len() * 2);
        if ctl.noise.load(Ordering::Relaxed) {
            tmp.clear();
            rs.process(mono, &mut tmp);
            dn.process(&tmp, &mut out);
            if out.is_empty() {
                return;
            }
        } else {
            rs.process(mono, &mut out);
        }
        let _ = mic_tx.try_send(out);
    };
    let mut mono = Vec::new();
    let stream = match fmt {
        SampleFormat::F32 => dev.build_input_stream(
            &cfg,
            move |d: &[f32], _| {
                mono.clear();
                mono.extend(d.chunks(ch).map(|f| f.iter().sum::<f32>() / ch as f32));
                push(&mono);
            },
            err,
            None,
        ),
        SampleFormat::I16 => dev.build_input_stream(
            &cfg,
            move |d: &[i16], _| {
                mono.clear();
                mono.extend(d.chunks(ch).map(|f| f.iter().map(|&v| v as f32 / 32768.0).sum::<f32>() / ch as f32));
                push(&mono);
            },
            err,
            None,
        ),
        SampleFormat::U16 => dev.build_input_stream(
            &cfg,
            move |d: &[u16], _| {
                mono.clear();
                mono.extend(d.chunks(ch).map(|f| f.iter().map(|&v| v as f32 / 32768.0 - 1.0).sum::<f32>() / ch as f32));
                push(&mono);
            },
            err,
            None,
        ),
        f => return Err(format!("Desteklenmeyen giris formati: {f:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resampler_length_ratio() {
        let mut r = Resampler::new(44_100, 48_000);
        let mut out = Vec::new();
        for _ in 0..100 {
            r.process(&[0.5f32; 441], &mut out);
        }
        // 1 saniye 44.1k -> ~48k ornek
        assert!((out.len() as i64 - 48_000).abs() < 10, "{}", out.len());
        assert!(out.iter().all(|v| (*v - 0.5).abs() < 1e-4 || out.len() < 2));
    }

    #[test]
    fn denoiser_blocks_and_suppresses_noise() {
        let mut d = Denoiser::new();
        let mut out = Vec::new();
        // 1 sn beyaz gurultu (basit LCG), duzensiz blok boyutlariyla
        let mut x: u32 = 12345;
        let noise: Vec<f32> = (0..48_000)
            .map(|_| {
                x = x.wrapping_mul(1_103_515_245).wrapping_add(12345);
                ((x >> 16) as f32 / 32768.0 - 1.0) * 0.05
            })
            .collect();
        for c in noise.chunks(333) {
            d.process(c, &mut out);
        }
        assert_eq!(out.len() % Denoiser::FRAME, 0);
        assert!(out.len() >= 48_000 - Denoiser::FRAME);
        let e_in: f32 = noise[24_000..].iter().map(|v| v * v).sum();
        let e_out: f32 = out[24_000..].iter().map(|v| v * v).sum();
        assert!(e_out < e_in * 0.5, "gurultu bastirilmadi: {e_out} / {e_in}");
    }

    #[test]
    fn resampler_identity_and_empty() {
        let mut r = Resampler::new(48_000, 48_000);
        let mut out = Vec::new();
        r.process(&[1.0, 2.0, 3.0], &mut out);
        r.process(&[], &mut out);
        assert_eq!(out, vec![1.0, 2.0, 3.0]);
    }

    #[test]
    fn resampler_downsample_continuous() {
        // Bloklar arasinda sicrama olmamali (ramp sinyali)
        let mut r = Resampler::new(96_000, 48_000);
        let mut out = Vec::new();
        let input: Vec<f32> = (0..960).map(|i| i as f32).collect();
        for c in input.chunks(97) {
            r.process(c, &mut out);
        }
        for w in out.windows(2) {
            assert!((w[1] - w[0] - 2.0).abs() < 1e-3, "{:?}", w);
        }
    }
}

#[cfg(all(test, windows))]
mod sys_tests {
    /// Gercek ses aygiti gerektirir: cargo test -- --ignored system_capture
    #[test]
    #[ignore]
    fn system_capture_starts_and_stops() {
        let got = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let g2 = got.clone();
        let h = super::start_system_capture(move |p| { g2.fetch_add(p.len(), std::sync::atomic::Ordering::Relaxed); }).expect("baslamali");
        std::thread::sleep(std::time::Duration::from_millis(800));
        drop(h);
        println!("yakalanan ornek: {}", got.load(std::sync::atomic::Ordering::Relaxed));
    }
}
