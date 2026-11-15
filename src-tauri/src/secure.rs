//! Token'i diskte Windows DPAPI ile sifreli saklar (sadece bu Windows kullanicisi cozebilir).

use base64::Engine;

const PREFIX: &str = "dpapi:";

#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn run(data: &[u8], protect: bool) -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        // SAFETY: girdi/cikti blob'lari gecerli; cikti LocalFree ile serbest birakilir.
        unsafe {
            let ok = if protect {
                CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            } else {
                CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out)
            };
            if ok == 0 || out.pbData.is_null() {
                return None;
            }
            let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            LocalFree(out.pbData as HLOCAL);
            Some(v)
        }
    }
    pub fn protect(d: &[u8]) -> Option<Vec<u8>> {
        run(d, true)
    }
    pub fn unprotect(d: &[u8]) -> Option<Vec<u8>> {
        run(d, false)
    }
}

#[cfg(not(windows))]
mod dpapi {
    pub fn protect(_: &[u8]) -> Option<Vec<u8>> {
        None
    }
    pub fn unprotect(_: &[u8]) -> Option<Vec<u8>> {
        None
    }
}

/// Diske yazilacak metin. DPAPI yoksa duz metin.
pub fn seal(token: &str) -> String {
    match dpapi::protect(token.as_bytes()) {
        Some(b) => format!("{PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(b)),
        None => token.to_string(),
    }
}

/// (token, eski duz metin miydi)
pub fn open(stored: &str) -> Option<(String, bool)> {
    let s = stored.trim();
    if s.is_empty() {
        return None;
    }
    match s.strip_prefix(PREFIX) {
        Some(b64) => {
            let raw = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
            let plain = dpapi::unprotect(&raw)?;
            String::from_utf8(plain).ok().map(|t| (t, false))
        }
        None => Some((s.to_string(), true)),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn roundtrip_and_legacy() {
        let sealed = super::seal("abc.def.ghi");
        #[cfg(windows)]
        assert!(sealed.starts_with("dpapi:") && !sealed.contains("abc"));
        assert_eq!(super::open(&sealed).unwrap().0, "abc.def.ghi");
        assert_eq!(super::open("eski-token\n").unwrap(), ("eski-token".to_string(), true));
        assert!(super::open("dpapi:bozuk!!").is_none());
    }
}
