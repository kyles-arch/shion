//! Sesli mesaj: 48 kHz mono PCM -> Opus -> Ogg kapsayici + Discord dalga formu.

use base64::Engine;

const RATE: u32 = 48_000;
const FRAME: usize = 960; // 20 ms
const PRE_SKIP: u16 = 312;

/// Ogg CRC32 (polinom 0x04c11db7, yansitmasiz, baslangic 0)
fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0u32;
    for &b in data {
        crc ^= (b as u32) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 { (crc << 1) ^ 0x04c1_1db7 } else { crc << 1 };
        }
    }
    crc
}

struct OggWriter {
    out: Vec<u8>,
    serial: u32,
    seq: u32,
}

impl OggWriter {
    fn page(&mut self, packets: &[&[u8]], granule: u64, flags: u8) {
        let mut seg = vec![];
        for p in packets {
            let mut n = p.len();
            while n >= 255 {
                seg.push(255u8);
                n -= 255;
            }
            seg.push(n as u8);
        }
        let start = self.out.len();
        self.out.extend_from_slice(b"OggS");
        self.out.push(0);
        self.out.push(flags);
        self.out.extend_from_slice(&granule.to_le_bytes());
        self.out.extend_from_slice(&self.serial.to_le_bytes());
        self.out.extend_from_slice(&self.seq.to_le_bytes());
        self.out.extend_from_slice(&[0, 0, 0, 0]); // crc
        self.out.push(seg.len() as u8);
        self.out.extend_from_slice(&seg);
        for p in packets {
            self.out.extend_from_slice(p);
        }
        let crc = crc32(&self.out[start..]);
        self.out[start + 22..start + 26].copy_from_slice(&crc.to_le_bytes());
        self.seq += 1;
    }
}

pub struct VoiceMessage {
    pub ogg: Vec<u8>,
    pub duration_secs: f64,
    pub waveform: String,
}

/// Discord dalga formu: en fazla 256 ornek, her biri 0-255 tepe genlik, base64.
pub fn waveform(pcm: &[f32]) -> String {
    let n = 256.min((pcm.len() / FRAME).max(1));
    let per = (pcm.len() / n).max(1);
    let bytes: Vec<u8> = (0..n)
        .map(|i| {
            let chunk = &pcm[i * per..((i + 1) * per).min(pcm.len())];
            let rms = (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len().max(1) as f32).sqrt();
            (rms * 3.0 * 255.0).clamp(0.0, 255.0) as u8
        })
        .collect();
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

pub fn encode_voice_message(pcm: &[f32]) -> Result<VoiceMessage, String> {
    if pcm.len() < RATE as usize / 4 {
        return Err("Kayıt çok kısa".into());
    }
    let mut enc = opus::Encoder::new(RATE, opus::Channels::Mono, opus::Application::Voip).map_err(|e| e.to_string())?;
    let _ = enc.set_bitrate(opus::Bitrate::Bits(48_000));
    let mut w = OggWriter { out: Vec::with_capacity(pcm.len() / 8), serial: (crate::store::now_ms() as u32) | 1, seq: 0 };

    let mut head = b"OpusHead".to_vec();
    head.push(1);
    head.push(1);
    head.extend_from_slice(&PRE_SKIP.to_le_bytes());
    head.extend_from_slice(&RATE.to_le_bytes());
    head.extend_from_slice(&0i16.to_le_bytes());
    head.push(0);
    w.page(&[&head], 0, 0x02);
    let mut tags = b"OpusTags".to_vec();
    tags.extend_from_slice(&5u32.to_le_bytes());
    tags.extend_from_slice(b"shion");
    tags.extend_from_slice(&0u32.to_le_bytes());
    w.page(&[&tags], 0, 0);

    let mut packets: Vec<Vec<u8>> = vec![];
    let mut buf = vec![0u8; 1500];
    let mut frame = vec![0f32; FRAME];
    let total_frames = pcm.len().div_ceil(FRAME);
    for i in 0..total_frames {
        let src = &pcm[i * FRAME..((i + 1) * FRAME).min(pcm.len())];
        frame[..src.len()].copy_from_slice(src);
        frame[src.len()..].iter_mut().for_each(|s| *s = 0.0);
        let n = enc.encode_float(&frame, &mut buf).map_err(|e| e.to_string())?;
        packets.push(buf[..n].to_vec());
    }
    // Sayfa basina 50 paket (1 saniye)
    let chunks: Vec<&[Vec<u8>]> = packets.chunks(50).collect();
    let last = chunks.len() - 1;
    for (ci, ch) in chunks.iter().enumerate() {
        let done_frames = (ci * 50 + ch.len()) as u64;
        let granule = if ci == last { pcm.len() as u64 + PRE_SKIP as u64 } else { done_frames * FRAME as u64 + PRE_SKIP as u64 };
        let refs: Vec<&[u8]> = ch.iter().map(|p| p.as_slice()).collect();
        w.page(&refs, granule, if ci == last { 0x04 } else { 0 });
    }
    Ok(VoiceMessage { ogg: w.out, duration_secs: pcm.len() as f64 / RATE as f64, waveform: waveform(pcm) })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ogg'u geri ayristir: (sayfalar, paketler) — CRC dogrulamasiyla
    fn parse(ogg: &[u8]) -> (usize, Vec<Vec<u8>>, u64) {
        let (mut i, mut pages, mut packets, mut cur, mut granule) = (0, 0, vec![], vec![], 0);
        while i < ogg.len() {
            assert_eq!(&ogg[i..i + 4], b"OggS");
            let nseg = ogg[i + 26] as usize;
            let segs = &ogg[i + 27..i + 27 + nseg];
            let body_len: usize = segs.iter().map(|&s| s as usize).sum();
            let end = i + 27 + nseg + body_len;
            let mut page = ogg[i..end].to_vec();
            let crc = u32::from_le_bytes(page[22..26].try_into().unwrap());
            page[22..26].copy_from_slice(&[0; 4]);
            assert_eq!(crc32(&page), crc, "CRC");
            granule = u64::from_le_bytes(ogg[i + 6..i + 14].try_into().unwrap());
            let mut off = i + 27 + nseg;
            for &s in segs {
                cur.extend_from_slice(&ogg[off..off + s as usize]);
                off += s as usize;
                if s < 255 {
                    packets.push(std::mem::take(&mut cur));
                }
            }
            pages += 1;
            i = end;
        }
        (pages, packets, granule)
    }

    #[test]
    fn crc_known_value() {
        // Ogg CRC'si "123456789" icin 0x89A1897F
        assert_eq!(crc32(b"123456789"), 0x89A1_897F);
    }

    #[test]
    fn voice_message_is_valid_ogg_opus() {
        let secs = 2.5;
        let pcm: Vec<f32> = (0..(RATE as f64 * secs) as usize).map(|i| (i as f32 * 0.03).sin() * 0.4).collect();
        let vm = encode_voice_message(&pcm).unwrap();
        assert!((vm.duration_secs - secs).abs() < 0.01);
        let (pages, packets, granule) = parse(&vm.ogg);
        assert_eq!(pages, 2 + 3, "baslik + etiket + 3 ses sayfasi");
        assert!(packets[0].starts_with(b"OpusHead") && packets[1].starts_with(b"OpusTags"));
        assert_eq!(granule, pcm.len() as u64 + PRE_SKIP as u64);
        let mut dec = opus::Decoder::new(RATE, opus::Channels::Mono).unwrap();
        let mut out = vec![0f32; FRAME];
        for p in &packets[2..] {
            assert_eq!(dec.decode_float(p, &mut out, false).unwrap(), FRAME);
        }
        let wf = base64::engine::general_purpose::STANDARD.decode(&vm.waveform).unwrap();
        assert!(wf.len() <= 256 && wf.iter().any(|&b| b > 50));
        assert!(encode_voice_message(&[0.0; 100]).is_err());
    }
}
