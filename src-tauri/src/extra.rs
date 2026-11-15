//! Oyun algilama (Discord'un tespit edilebilir uygulama listesi + calisan surecler) ve kanal disa aktarma.

use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

/// exe adi (kucuk harf) -> (uygulama id, oyun adi)
pub type GameMap = HashMap<String, (String, String)>;

/// Birden fazla uygulamada gecen ortak exe adlari (javaw.exe gibi) belirsiz oldugu icin atilir.
pub fn build_game_map(list: &Value) -> GameMap {
    let mut map: GameMap = HashMap::new();
    let mut ambiguous: HashSet<String> = HashSet::new();
    for app in list.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let (Some(id), Some(name)) = (app["id"].as_str(), app["name"].as_str()) else { continue };
        for ex in app["executables"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
            if ex["os"].as_str() != Some("win32") || ex["is_launcher"] == true {
                continue;
            }
            let Some(n) = ex["name"].as_str() else { continue };
            let base = n.rsplit(['/', '\\']).next().unwrap_or(n).to_lowercase();
            if base.is_empty() || base.starts_with('>') || !base.ends_with(".exe") {
                continue;
            }
            match map.get(&base) {
                Some((other, _)) if other != id => {
                    ambiguous.insert(base);
                }
                Some(_) => {}
                None => {
                    map.insert(base, (id.to_string(), name.to_string()));
                }
            }
        }
    }
    for a in ambiguous {
        map.remove(&a);
    }
    map
}

/// Calisan sureclerin exe adlari (kucuk harf).
#[cfg(windows)]
pub fn running_exes() -> HashSet<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};
    let mut out = HashSet::new();
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut ok = Process32FirstW(snap, &mut e);
        while ok != 0 {
            let len = e.szExeFile.iter().position(|&c| c == 0).unwrap_or(e.szExeFile.len());
            out.insert(String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase());
            ok = Process32NextW(snap, &mut e);
        }
        CloseHandle(snap);
    }
    out
}
#[cfg(not(windows))]
pub fn running_exes() -> HashSet<String> {
    HashSet::new()
}

pub fn detect(map: &GameMap, running: &HashSet<String>) -> Option<(String, String)> {
    let mut hits: Vec<&(String, String)> = running.iter().filter_map(|e| map.get(e)).collect();
    hits.sort(); // kararli secim
    hits.first().map(|x| (*x).clone())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn author_name(a: &Value) -> &str {
    a["global_name"].as_str().or(a["username"].as_str()).unwrap_or("?")
}

/// Kronolojik mesaj listesinden okunabilir, tek dosyalik HTML.
pub fn export_html(title: &str, msgs: &[Value]) -> String {
    let mut b = String::with_capacity(msgs.len() * 300 + 2000);
    b.push_str(&format!(
        "<!doctype html><meta charset=utf-8><title>{t}</title><style>body{{background:#1e1f22;color:#dbdee1;font:15px/1.45 'Segoe UI',sans-serif;margin:0;padding:24px}}h1{{font-size:20px}}.m{{display:flex;gap:12px;padding:6px 0}}.m img.av{{width:40px;height:40px;border-radius:50%}}.n{{font-weight:600;color:#fff}}.t{{color:#949ba4;font-size:12px;margin-left:6px}}.c{{white-space:pre-wrap;word-break:break-word}}.a a{{color:#00a8fc}}.a img{{max-width:420px;max-height:300px;border-radius:6px;display:block;margin-top:4px}}.r{{color:#949ba4;font-size:13px;border-left:2px solid #4e5058;padding-left:6px;margin-bottom:2px}}.e{{border-left:4px solid #5865f2;background:#2b2d31;padding:6px 10px;border-radius:4px;margin-top:4px;max-width:520px}}</style><h1>{t}</h1><p style=color:#949ba4>{n} mesaj · Shion ile dışa aktarıldı</p>",
        t = esc(title),
        n = msgs.len()
    ));
    for m in msgs {
        let a = &m["author"];
        let av = match (a["id"].as_str(), a["avatar"].as_str()) {
            (Some(id), Some(h)) => format!("https://cdn.discordapp.com/avatars/{id}/{h}.webp?size=80"),
            _ => "https://cdn.discordapp.com/embed/avatars/0.png".into(),
        };
        let ts = m["timestamp"].as_str().unwrap_or("").replace('T', " ");
        let ts = ts.get(..16).unwrap_or(&ts);
        b.push_str(&format!("<div class=m><img class=av src=\"{}\"><div>", esc(&av)));
        if let Some(r) = m["referenced_message"].as_object() {
            let rc: String = r.get("content").and_then(|c| c.as_str()).unwrap_or("").chars().take(80).collect();
            b.push_str(&format!("<div class=r>↪ {}: {}</div>", esc(author_name(r.get("author").unwrap_or(&Value::Null))), esc(&rc)));
        }
        b.push_str(&format!("<span class=n>{}</span><span class=t>{}</span>", esc(author_name(a)), esc(ts)));
        let c = m["content"].as_str().unwrap_or("");
        if !c.is_empty() {
            b.push_str(&format!("<div class=c>{}</div>", esc(c)));
        }
        for at in m["attachments"].as_array().map(|x| x.as_slice()).unwrap_or(&[]) {
            let url = esc(at["url"].as_str().unwrap_or(""));
            let name = esc(at["filename"].as_str().unwrap_or("dosya"));
            if at["content_type"].as_str().map_or(false, |t| t.starts_with("image/")) {
                b.push_str(&format!("<div class=a><a href=\"{url}\"><img src=\"{url}\" alt=\"{name}\"></a></div>"));
            } else {
                b.push_str(&format!("<div class=a>📎 <a href=\"{url}\">{name}</a></div>"));
            }
        }
        for e in m["embeds"].as_array().map(|x| x.as_slice()).unwrap_or(&[]) {
            let t = e["title"].as_str().unwrap_or("");
            let d = e["description"].as_str().unwrap_or("");
            if !t.is_empty() || !d.is_empty() {
                b.push_str(&format!("<div class=e><b>{}</b><div class=c>{}</div></div>", esc(t), esc(d)));
            }
        }
        for s in m["sticker_items"].as_array().map(|x| x.as_slice()).unwrap_or(&[]) {
            b.push_str(&format!("<div class=t>[çıkartma: {}]</div>", esc(s["name"].as_str().unwrap_or(""))));
        }
        b.push_str("</div></div>\n");
    }
    b
}

/// Dosya adinda guvenli karakterler.
pub fn safe_name(s: &str) -> String {
    let n: String = s
        .chars()
        .map(|c| if c.is_alphanumeric() || "-_. ".contains(c) { c } else { '_' })
        .collect::<String>()
        .trim_matches(['.', ' '])
        .chars()
        .take(80)
        .collect();
    if n.is_empty() { "dosya".into() } else { n }
}

/// Sadece Discord CDN'den indirmeye izin ver.
pub fn allowed_media(url: &str) -> bool {
    ["https://cdn.discordapp.com/", "https://media.discordapp.net/"].iter().any(|p| url.starts_with(p))
}

pub fn game_activity(id: &str, name: &str, start: u64) -> Value {
    json!({"name": name, "type": 0, "application_id": id, "timestamps": {"start": start}})
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_map_filters_and_detects() {
        let list = json!([
            {"id": "1", "name": "Valorant", "executables": [{"os": "win32", "name": "valorant-win64-shipping.exe", "is_launcher": false}, {"os": "darwin", "name": "valorant.app"}]},
            {"id": "2", "name": "Minecraft", "executables": [{"os": "win32", "name": "javaw.exe"}, {"os": "win32", "name": ">minecraft"}]},
            {"id": "3", "name": "Başka Java", "executables": [{"os": "win32", "name": "bin/javaw.exe"}]},
            {"id": "4", "name": "Launcher", "executables": [{"os": "win32", "name": "riotclient.exe", "is_launcher": true}]},
            {"id": "5", "name": "CS2", "executables": [{"os": "win32", "name": "Counter-Strike Global Offensive/game/bin/win64/CS2.EXE"}]}
        ]);
        let m = build_game_map(&list);
        assert_eq!(m.get("valorant-win64-shipping.exe").map(|x| x.1.as_str()), Some("Valorant"));
        assert!(!m.contains_key("javaw.exe"), "belirsiz exe atilmali");
        assert!(!m.contains_key("riotclient.exe"));
        assert_eq!(m.get("cs2.exe").map(|x| x.0.as_str()), Some("5"));
        let running: HashSet<String> = ["explorer.exe", "cs2.exe"].iter().map(|s| s.to_string()).collect();
        assert_eq!(detect(&m, &running).map(|x| x.1), Some("CS2".into()));
        assert_eq!(detect(&m, &HashSet::new()), None);
    }

    #[test]
    fn export_html_escapes() {
        let msgs = vec![json!({"author": {"id": "1", "username": "ali", "avatar": null}, "timestamp": "2026-01-02T10:20:30.000Z", "content": "<script>x</script> merhaba", "attachments": [{"url": "https://cdn.discordapp.com/a.png", "filename": "a.png", "content_type": "image/png"}], "embeds": []})];
        let h = export_html("genel <test>", &msgs);
        assert!(h.contains("&lt;script&gt;x&lt;/script&gt; merhaba"));
        assert!(!h.contains("<script>"));
        assert!(h.contains("2026-01-02 10:20"));
        assert!(h.contains("genel &lt;test&gt;"));
        assert!(h.contains("<img src=\"https://cdn.discordapp.com/a.png\""));
    }

    #[test]
    fn names_and_urls() {
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name("sohbet: genel?"), "sohbet_ genel_");
        assert_eq!(safe_name("..."), "dosya");
        assert!(allowed_media("https://cdn.discordapp.com/avatars/1/x.png"));
        assert!(!allowed_media("https://evil.com/https://cdn.discordapp.com/"));
    }
}
