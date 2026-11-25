#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod audio;
mod extra;
mod gateway;
mod media;
mod perms;
mod secure;
mod store;
mod video;
mod voice;

use std::sync::atomic::{AtomicBool, Ordering};

use reqwest::Method;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

pub struct Core {
    pub store: Mutex<store::Store>,
    pub api: api::Api,
    gw: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    pub gw_tx: Mutex<Option<tokio::sync::mpsc::UnboundedSender<String>>>,
    pub voice: Mutex<voice::VoiceMgr>,
    pub voice_ctl: Arc<audio::VoiceCtl>,
    /// Kapat = tepsiye kucult
    tray_close: AtomicBool,
    ptt_key: Mutex<Option<String>>,
    pub video: Arc<video::VideoHub>,
    self_video: AtomicBool,
    presence: Mutex<Presence>,
    game_detect: AtomicBool,
    export_cancel: AtomicBool,
    sys_audio: Mutex<Option<audio::AudioHandle>>,
    mic_test: Mutex<Option<audio::AudioHandle>>,
    /// Uzun sure islem yoksa "bosta" goster
    auto_idle: AtomicBool,
}

#[derive(Default)]
struct Presence {
    status: String,
    custom: Option<Value>,
    game: Option<Value>,
    /// Kullanicinin elle ayarladigi etkinlik (Oynuyor/Dinliyor/Izliyor/Yarisiyor)
    rpc: Option<Value>,
}

/// Durum + ozel durum + oyun aktivitesini gateway'e gonder.
fn send_presence(core: &CoreRef) -> Result<(), String> {
    let (status, acts) = {
        let p = core.presence.lock().unwrap();
        let acts: Vec<Value> = p.custom.iter().chain(p.rpc.iter()).chain(p.game.iter()).cloned().collect();
        (if p.status.is_empty() { "online".to_string() } else { p.status.clone() }, acts)
    };
    let afk = core.auto_idle.load(Ordering::Relaxed) && status == "online";
    let status = if afk { "idle".to_string() } else { status };
    let since = if afk { store::now_ms() } else { 0 };
    gw_send(core, json!({"op": 3, "d": {"status": status, "since": since, "activities": acts, "afk": afk}}))
}

fn gw_send(core: &CoreRef, v: Value) -> Result<(), String> {
    match core.gw_tx.lock().unwrap().as_ref() {
        Some(tx) => tx.send(v.to_string()).map_err(|_| "Gateway bagli degil".to_string()),
        None => Err("Gateway bagli degil".into()),
    }
}

fn voice_state_op(core: &CoreRef, guild_id: &Option<String>, channel_id: &Option<String>) -> Result<(), String> {
    let c = &core.voice_ctl;
    gw_send(core, json!({"op": 4, "d": {
        "guild_id": guild_id, "channel_id": channel_id,
        "self_mute": c.muted.load(Ordering::Relaxed), "self_deaf": c.deafened.load(Ordering::Relaxed),
        "self_video": core.self_video.load(Ordering::Relaxed), "flags": 2
    }}))
}

#[derive(serde::Deserialize)]
struct FileIn {
    name: String,
    data: String, // base64
}
pub type CoreRef = Arc<Core>;

fn token_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("session.dat"))
}

fn accounts_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("accounts.json"))
}
fn read_accounts(app: &AppHandle) -> Vec<Value> {
    accounts_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Vec<Value>>(&t).ok())
        .unwrap_or_default()
}
fn write_accounts(app: &AppHandle, list: &[Value]) {
    if let Some(p) = accounts_path(app) {
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(p, serde_json::to_string(list).unwrap_or_default());
    }
}
/// Gateway + sesi kapat, oturumu sifirla (dosyalara dokunmaz).
fn stop_session(core: &CoreRef) {
    if let Some(h) = core.gw.lock().unwrap().take() {
        h.abort();
    }
    *core.gw_tx.lock().unwrap() = None;
    let mut vm = core.voice.lock().unwrap();
    vm.stop();
    vm.channel_id = None;
    drop(vm);
    *core.store.lock().unwrap() = store::Store::default();
    core.presence.lock().unwrap().game = None;
}

fn tok(core: &CoreRef) -> Result<String, String> {
    let t = core.store.lock().unwrap().token.clone();
    if t.is_empty() {
        Err("Giris yapilmamis".into())
    } else {
        Ok(t)
    }
}

fn nonce() -> String {
    ((store::now_ms().saturating_sub(1_420_070_400_000)) << 22).to_string()
}

#[tauri::command]
fn saved_token(app: AppHandle) -> Option<String> {
    let p = token_path(&app)?;
    let (t, legacy) = secure::open(&std::fs::read_to_string(&p).ok()?)?;
    if legacy {
        // Eski duz metin kaydi sifreliye tasi
        let _ = std::fs::write(&p, secure::seal(&t));
    }
    Some(t)
}

fn log_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("deleted-log.json"))
}

fn save_log(app: &AppHandle, core: &CoreRef) {
    let data = {
        let mut s = core.store.lock().unwrap();
        if !s.deleted_dirty {
            return;
        }
        s.deleted_dirty = false;
        serde_json::to_string(&s.deleted).unwrap_or_default()
    };
    if let Some(p) = log_path(app) {
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let _ = std::fs::write(p, data);
    }
}

#[tauri::command]
async fn login(app: AppHandle, core: State<'_, CoreRef>, token: String, remember: bool) -> Result<Value, String> {
    let token = token.trim().trim_matches('"').to_string();
    if token.is_empty() {
        return Err("Token bos olamaz".into());
    }
    let me = core
        .api
        .get(&token, "/users/@me")
        .await
        .map_err(|e| if e.starts_with("401") { "Token gecersiz".to_string() } else { e })?;
    if remember {
        if let Some(p) = token_path(&app) {
            if let Some(dir) = p.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&p, secure::seal(&token));
        }
        // Coklu hesap listesine ekle/guncelle
        let mut list = read_accounts(&app);
        list.retain(|a| a["id"] != me["id"]);
        list.insert(0, json!({"id": me["id"], "username": me["username"], "global_name": me["global_name"], "avatar": me["avatar"], "token": secure::seal(&token)}));
        write_accounts(&app, &list);
    }
    {
        let mut s = core.store.lock().unwrap();
        *s = store::Store::default();
        s.token = token.clone();
        s.set_me(me.clone());
        if let Some(log) = log_path(&app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()) {
            s.deleted = log;
        }
        s.known_names = gateway::load_names(&app);
    }
    let handle = tauri::async_runtime::spawn(gateway::run(app.clone(), core.inner().clone(), token));
    let old = core.gw.lock().unwrap().replace(handle);
    if let Some(old) = old {
        old.abort();
    }
    Ok(me)
}

/// Cikis: oturumu kapatir ve bu hesabi kayitli hesaplardan da siler.
#[tauri::command]
fn logout(app: AppHandle, core: State<'_, CoreRef>) {
    let me = core.store.lock().unwrap().me_id.clone();
    stop_session(&core);
    if let Some(p) = token_path(&app) {
        let _ = std::fs::remove_file(p);
    }
    let mut list = read_accounts(&app);
    list.retain(|a| a["id"].as_str() != Some(me.as_str()));
    write_accounts(&app, &list);
    if let Some(p) = cache_path(&app, &me) {
        let _ = std::fs::remove_file(p);
    }
}

#[tauri::command]
fn list_accounts(app: AppHandle, core: State<'_, CoreRef>) -> Vec<Value> {
    let me = core.store.lock().unwrap().me_id.clone();
    read_accounts(&app)
        .into_iter()
        .map(|a| json!({"id": a["id"], "username": a["username"], "global_name": a["global_name"], "avatar": a["avatar"], "current": a["id"].as_str() == Some(me.as_str())}))
        .collect()
}

/// Kayitli hesaba gec: oturumu kapatir, o hesabin token'ini aktif yapar (arayuz yeniden yuklenir).
#[tauri::command]
fn switch_account(app: AppHandle, core: State<'_, CoreRef>, id: String) -> Result<(), String> {
    let acc = read_accounts(&app).into_iter().find(|a| a["id"].as_str() == Some(id.as_str())).ok_or("Hesap bulunamadi")?;
    let sealed = acc["token"].as_str().ok_or("Hesap bozuk")?.to_string();
    secure::open(&sealed).ok_or("Token cozulemedi")?;
    stop_session(&core);
    let p = token_path(&app).ok_or("Ayar klasoru yok")?;
    std::fs::write(p, sealed).map_err(|e| e.to_string())
}

/// Yeni hesap eklemek icin giris ekranina don (kayitli hesaplar korunur).
#[tauri::command]
fn add_account(app: AppHandle, core: State<'_, CoreRef>) {
    stop_session(&core);
    if let Some(p) = token_path(&app) {
        let _ = std::fs::remove_file(p);
    }
}

#[tauri::command]
fn remove_account(app: AppHandle, id: String) {
    let mut list = read_accounts(&app);
    list.retain(|a| a["id"].as_str() != Some(id.as_str()));
    write_accounts(&app, &list);
    if let Some(p) = cache_path(&app, &id) {
        let _ = std::fs::remove_file(p);
    }
}

#[tauri::command]
fn get_state(core: State<'_, CoreRef>) -> Value {
    let s = core.store.lock().unwrap();
    let mut v = s.social_json();
    v["me"] = s.me.clone();
    v["guilds"] = json!(s.guild_summaries());
    v["dms"] = json!(s.dm_list());
    v["log_count"] = json!(s.deleted.len());
    v["folders"] = s.folders.clone();
    v
}

fn cache_path(app: &AppHandle, uid: &str) -> Option<std::path::PathBuf> {
    if uid.is_empty() || !uid.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    app.path().app_data_dir().ok().map(|d| d.join(format!("cache-{uid}.json")))
}

/// Hizli acilis: son durum (sunucular, DM'ler) + son kanallarin mesajlarini diske yaz.
#[tauri::command]
fn save_cache(app: AppHandle, core: State<'_, CoreRef>, channels: Vec<String>) {
    let (uid, data) = {
        let s = core.store.lock().unwrap();
        if s.guilds.is_empty() && s.dms.is_empty() {
            return;
        }
        let mut v = s.social_json();
        v["me"] = s.me.clone();
        v["guilds"] = json!(s.guild_summaries());
        v["dms"] = json!(s.dm_list());
        v["folders"] = s.folders.clone();
        let mut msgs = serde_json::Map::new();
        for c in channels.iter().take(20) {
            if let Some(list) = s.messages.get(c) {
                let n = list.len().saturating_sub(50);
                let keep: Vec<&Value> = list[n..].iter().filter(|m| m["_deleted"] != true).collect();
                msgs.insert(c.clone(), json!(keep));
            }
        }
        v["messages"] = Value::Object(msgs);
        v["saved"] = json!(store::now_ms());
        (s.me_id.clone(), v)
    };
    let Some(p) = cache_path(&app, &uid) else { return };
    std::thread::spawn(move || {
        if let Some(d) = p.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        let tmp = p.with_extension("tmp");
        if std::fs::write(&tmp, serde_json::to_vec(&data).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(tmp, p);
        }
    });
}

#[tauri::command]
fn load_cache(app: AppHandle, user_id: String) -> Option<Value> {
    let p = cache_path(&app, &user_id)?;
    serde_json::from_slice(&std::fs::read(p).ok()?).ok()
}

#[tauri::command]
fn diagnostics(app: AppHandle, core: State<'_, CoreRef>) -> Value {
    let mut d = core.store.lock().unwrap().diagnostics();
    d["version"] = json!(app.package_info().version.to_string());
    d["gateway"] = json!(core.gw_tx.lock().unwrap().is_some());
    d
}

/// Seni etiketleyen son mesajlar (Discord'un "Bahsetmeler" kutusu).
#[tauri::command]
async fn mentions_inbox(core: State<'_, CoreRef>, before: Option<String>, everyone: bool) -> Result<Value, String> {
    let t = tok(&core)?;
    let mut path = format!("/users/@me/mentions?limit=25&roles=true&everyone={everyone}");
    if let Some(b) = before.filter(|b| b.chars().all(|c| c.is_ascii_digit())) {
        path.push_str(&format!("&before={b}"));
    }
    core.api.get(&t, &path).await
}

/// Mesaji baska kanala ilet (Discord'un "Ilet" ozelligi).
#[tauri::command]
async fn forward_message(core: State<'_, CoreRef>, channel_id: String, message_id: String, guild_id: Option<String>, target: String, note: Option<String>) -> Result<(), String> {
    let t = tok(&core)?;
    let mut reference = json!({"type": 1, "message_id": message_id, "channel_id": channel_id});
    if let Some(g) = guild_id {
        reference["guild_id"] = json!(g);
    }
    let path = format!("/channels/{target}/messages");
    core.api.req(&t, Method::POST, &path, Some(json!({"message_reference": reference, "nonce": nonce(), "flags": 0, "content": ""}))).await?;
    if let Some(n) = note.filter(|n| !n.trim().is_empty()) {
        core.api.req(&t, Method::POST, &path, Some(json!({"content": n, "nonce": nonce(), "flags": 0}))).await?;
    }
    Ok(())
}

/// Bu mesajdan itibaren okunmadi isaretle (bir onceki mesaja manuel ack).
#[tauri::command]
async fn mark_unread(core: State<'_, CoreRef>, channel_id: String, before_id: String) -> Result<(), String> {
    let t = tok(&core)?;
    core.api
        .req(&t, Method::POST, &format!("/channels/{channel_id}/messages/{before_id}/ack"), Some(json!({"manual": true, "mention_count": 0})))
        .await?;
    core.store.lock().unwrap().read_states.insert(channel_id, (before_id, 0));
    Ok(())
}

#[tauri::command]
fn get_note(core: State<'_, CoreRef>, user_id: String) -> String {
    core.store.lock().unwrap().notes.get(&user_id).cloned().unwrap_or_default()
}

#[tauri::command]
async fn set_note(core: State<'_, CoreRef>, user_id: String, note: String) -> Result<(), String> {
    let t = tok(&core)?;
    let note: String = note.chars().take(256).collect();
    core.api.req(&t, Method::PUT, &format!("/users/@me/notes/{user_id}"), Some(json!({"note": note}))).await?;
    let mut s = core.store.lock().unwrap();
    if note.is_empty() {
        s.notes.remove(&user_id);
    } else {
        s.notes.insert(user_id, note);
    }
    Ok(())
}

/// Ses tahtasi: kanala ses cal.
#[tauri::command]
async fn send_sound(core: State<'_, CoreRef>, channel_id: String, sound_id: String, source_guild_id: Option<String>) -> Result<(), String> {
    let t = tok(&core)?;
    let mut body = json!({"sound_id": sound_id});
    if let Some(g) = source_guild_id {
        body["source_guild_id"] = json!(g);
    }
    core.api.req(&t, Method::POST, &format!("/channels/{channel_id}/send-soundboard-sound"), Some(body)).await.map(|_| ())
}

#[tauri::command]
async fn default_sounds(core: State<'_, CoreRef>) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api.get(&t, "/soundboard-default-sounds").await
}

/// Discord profil efektlerinin katman tanimlari (profilde yalnizca efekt kimligi gelir).
#[tauri::command]
async fn profile_effects(core: State<'_, CoreRef>) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api.get(&t, "/user-profile-effects").await
}

#[tauri::command]
fn guild_events(core: State<'_, CoreRef>, guild_id: String) -> Vec<Value> {
    let s = core.store.lock().unwrap();
    let mut v = s.guild(&guild_id).map(|g| g.events.clone()).unwrap_or_default();
    v.sort_by(|a, b| a["scheduled_start_time"].as_str().unwrap_or("").cmp(b["scheduled_start_time"].as_str().unwrap_or("")));
    v
}

/// Elle ozel etkinlik (CustomRPC). type: 0 oynuyor, 2 dinliyor, 3 izliyor, 5 yarisiyor.
#[tauri::command]
fn set_custom_rpc(core: State<'_, CoreRef>, activity: Option<Value>) -> Result<(), String> {
    let act = match activity {
        Some(a) => {
            let name: String = a["name"].as_str().unwrap_or("").trim().chars().take(128).collect();
            if name.is_empty() {
                return Err("Ad bos olamaz".into());
            }
            let ty = a["type"].as_u64().filter(|t| [0, 2, 3, 5].contains(t)).unwrap_or(0);
            let mut v = json!({"name": name, "type": ty, "timestamps": {"start": store::now_ms()}});
            for k in ["details", "state"] {
                if let Some(t) = a[k].as_str().map(str::trim).filter(|t| !t.is_empty()) {
                    v[k] = json!(t.chars().take(128).collect::<String>());
                }
            }
            Some(v)
        }
        None => None,
    };
    core.presence.lock().unwrap().rpc = act;
    send_presence(&core)
}

/// Mesaj baglantisi onizlemesi icin tek mesaj.
#[tauri::command]
async fn fetch_message(core: State<'_, CoreRef>, channel_id: String, message_id: String) -> Result<Option<Value>, String> {
    if !channel_id.chars().all(|c| c.is_ascii_digit()) || !message_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Gecersiz kimlik".into());
    }
    let t = tok(&core)?;
    let v = core.api.get(&t, &format!("/channels/{channel_id}/messages?limit=1&around={message_id}")).await?;
    Ok(v.as_array().and_then(|a| a.iter().find(|m| m["id"].as_str() == Some(message_id.as_str())).cloned()))
}

/// Bir tepkiyi kimlerin verdigi.
#[tauri::command]
async fn reaction_users(core: State<'_, CoreRef>, channel_id: String, message_id: String, emoji: String) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api
        .get(&t, &format!("/channels/{channel_id}/messages/{message_id}/reactions/{}?limit=100&type=0", api::enc(&emoji)))
        .await
}

/// Ozel emojiyi baska bir sunucuya kopyala (EmoteCloner).
#[tauri::command]
async fn clone_emoji(core: State<'_, CoreRef>, guild_id: String, name: String, url: String) -> Result<Value, String> {
    use base64::Engine;
    if !extra::allowed_media(&url) {
        return Err("Sadece Discord CDN".into());
    }
    let t = tok(&core)?;
    let name: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '_').take(32).collect();
    if name.len() < 2 {
        return Err("Emoji adi en az 2 karakter olmali".into());
    }
    let bytes = core.api.bytes(&url).await?;
    if bytes.len() > 256 * 1024 {
        return Err("Emoji 256 KB'tan buyuk".into());
    }
    let mime = if url.contains(".gif") { "image/gif" } else if url.contains(".png") { "image/png" } else { "image/webp" };
    let image = format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
    core.api.req(&t, Method::POST, &format!("/guilds/{guild_id}/emojis"), Some(json!({"name": name, "image": image, "roles": []}))).await
}

#[tauri::command]
fn set_auto_idle(core: State<'_, CoreRef>, idle: bool) -> Result<(), String> {
    if core.auto_idle.swap(idle, Ordering::Relaxed) == idle {
        return Ok(());
    }
    send_presence(&core)
}

#[tauri::command]
fn set_active_channel(core: State<'_, CoreRef>, channel_id: String) {
    core.store.lock().unwrap().active_channel = channel_id;
}

#[tauri::command]
async fn get_messages(core: State<'_, CoreRef>, channel_id: String, before: Option<String>, around: Option<String>) -> Result<Vec<Value>, String> {
    let t = tok(&core)?;
    if let Some(a) = around {
        // Arama/sabit/yer imi atlamasi: onbellege koymadan dondur
        let v = core.api.get(&t, &format!("/channels/{channel_id}/messages?limit=50&around={a}")).await?;
        let mut list = v.as_array().cloned().unwrap_or_default();
        list.reverse();
        return Ok(list);
    }
    let mut path = format!("/channels/{channel_id}/messages?limit=50");
    if let Some(b) = &before {
        path.push_str(&format!("&before={b}"));
    }
    let v = core.api.get(&t, &path).await?;
    let mut list = v.as_array().cloned().unwrap_or_default();
    list.reverse();
    let mut s = core.store.lock().unwrap();
    s.put_messages(&channel_id, list);
    Ok(s.slice(&channel_id, before.as_deref()))
}

#[tauri::command]
async fn send_message(
    core: State<'_, CoreRef>,
    channel_id: String,
    content: String,
    reply_to: Option<String>,
    files: Option<Vec<FileIn>>,
    poll: Option<Value>,
    silent: Option<bool>,
    sticker_ids: Option<Vec<String>>,
    reply_ping: Option<bool>,
) -> Result<Value, String> {
    use base64::Engine;
    let t = tok(&core)?;
    // 4096 = SUPPRESS_NOTIFICATIONS (@silent)
    let flags = if silent.unwrap_or(false) { 4096 } else { 0 };
    let mut body = json!({"content": content, "nonce": nonce(), "tts": false, "flags": flags});
    if let Some(ids) = sticker_ids.filter(|v| !v.is_empty()) {
        body["sticker_ids"] = json!(ids);
    }
    if let Some(p) = poll {
        body["poll"] = p;
    }
    if let Some(r) = reply_to {
        body["message_reference"] = json!({"message_id": r, "channel_id": channel_id});
        if reply_ping == Some(false) {
            body["allowed_mentions"] = json!({"parse": ["users", "roles", "everyone"], "replied_user": false});
        }
    }
    let path = format!("/channels/{channel_id}/messages");
    let files = files.unwrap_or_default();
    if files.is_empty() {
        return core.api.req(&t, Method::POST, &path, Some(body)).await;
    }
    let mut decoded = Vec::with_capacity(files.len());
    let mut atts = Vec::new();
    for (i, f) in files.into_iter().enumerate() {
        let data = base64::engine::general_purpose::STANDARD.decode(f.data).map_err(|e| e.to_string())?;
        atts.push(json!({"id": i, "filename": f.name}));
        decoded.push((f.name, data));
    }
    body["attachments"] = json!(atts);
    core.api.upload(&t, &path, &body, &decoded).await
}

#[tauri::command]
async fn send_typing(core: State<'_, CoreRef>, channel_id: String) -> Result<(), String> {
    let t = tok(&core)?;
    core.api.req(&t, Method::POST, &format!("/channels/{channel_id}/typing"), None).await.map(|_| ())
}

/// emoji: unicode karakter ya da "isim:id" (ozel emoji)
#[tauri::command]
async fn react(core: State<'_, CoreRef>, channel_id: String, message_id: String, emoji: String, add: bool) -> Result<(), String> {
    let t = tok(&core)?;
    let enc: String = emoji
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b == b':' || b == b'_' { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    let m = if add { Method::PUT } else { Method::DELETE };
    core.api
        .req(&t, m, &format!("/channels/{channel_id}/messages/{message_id}/reactions/{enc}/@me?location=Message"), None)
        .await
        .map(|_| ())
}

#[tauri::command]
async fn forum_threads(core: State<'_, CoreRef>, channel_id: String, offset: Option<u32>) -> Result<Value, String> {
    let t = tok(&core)?;
    let off = offset.unwrap_or(0);
    let v = core
        .api
        .get(&t, &format!("/channels/{channel_id}/threads/search?archived=true&sort_by=last_message_time&sort_order=desc&limit=25&offset={off}"))
        .await?;
    {
        let mut s = core.store.lock().unwrap();
        for th in store::arr(&v["threads"]) {
            s.upsert_thread(th);
        }
    }
    Ok(v)
}

#[tauri::command]
async fn create_forum_post(core: State<'_, CoreRef>, channel_id: String, title: String, content: String) -> Result<Value, String> {
    let t = tok(&core)?;
    let body = json!({"name": title, "auto_archive_duration": 4320, "message": {"content": content}});
    core.api.req(&t, Method::POST, &format!("/channels/{channel_id}/threads"), Some(body)).await
}

#[tauri::command]
fn join_voice(app: AppHandle, core: State<'_, CoreRef>, guild_id: Option<String>, channel_id: String) -> Result<(), String> {
    let mut vm = core.voice.lock().unwrap();
    vm.stop();
    vm.guild_id = guild_id.clone();
    vm.channel_id = Some(channel_id.clone());
    drop(vm);
    let _ = tauri::Emitter::emit(&app, "voice-status", json!({"state": "connecting"}));
    voice_state_op(&core, &guild_id, &Some(channel_id))
}

#[tauri::command]
fn leave_voice(app: AppHandle, core: State<'_, CoreRef>) -> Result<(), String> {
    core.self_video.store(false, Ordering::Relaxed);
    let mut vm = core.voice.lock().unwrap();
    vm.stop();
    let gid = vm.guild_id.take();
    vm.channel_id = None;
    drop(vm);
    let _ = tauri::Emitter::emit(&app, "voice-status", json!({"state": "disconnected"}));
    voice_state_op(&core, &gid, &None)
}

#[tauri::command]
fn set_voice_flags(core: State<'_, CoreRef>, mute: bool, deaf: bool) -> Result<(), String> {
    core.voice_ctl.muted.store(mute, Ordering::Relaxed);
    core.voice_ctl.deafened.store(deaf, Ordering::Relaxed);
    let vm = core.voice.lock().unwrap();
    let (g, c) = (vm.guild_id.clone(), vm.channel_id.clone());
    drop(vm);
    if c.is_some() {
        voice_state_op(&core, &g, &c)?;
    }
    Ok(())
}

#[tauri::command]
fn voice_devices() -> Value {
    let (inputs, outputs) = audio::list_devices();
    json!({"inputs": inputs, "outputs": outputs})
}

#[tauri::command]
fn set_voice_settings(core: State<'_, CoreRef>, input: Option<String>, output: Option<String>, threshold: f32, volume: f32) {
    let c = &core.voice_ctl;
    *c.input_device.lock().unwrap() = input.filter(|s| !s.is_empty());
    *c.output_device.lock().unwrap() = output.filter(|s| !s.is_empty());
    c.threshold.store(threshold.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    c.volume.store(volume.clamp(0.0, 3.0).to_bits(), Ordering::Relaxed);
}

#[tauri::command]
async fn ring_call(core: State<'_, CoreRef>, channel_id: String) -> Result<(), String> {
    let t = tok(&core)?;
    core.api.req(&t, Method::POST, &format!("/channels/{channel_id}/call/ring"), Some(json!({"recipients": null}))).await.map(|_| ())
}

#[tauri::command]
async fn stop_ringing(core: State<'_, CoreRef>, channel_id: String) -> Result<(), String> {
    let t = tok(&core)?;
    let me = core.store.lock().unwrap().me_id.clone();
    core.api
        .req(&t, Method::POST, &format!("/channels/{channel_id}/call/stop-ringing"), Some(json!({"recipients": [me]})))
        .await
        .map(|_| ())
}

/// online | idle | dnd | invisible  (+ istege bagli ozel durum)
#[tauri::command]
fn set_status(core: State<'_, CoreRef>, status: String, custom_text: Option<String>, custom_emoji: Option<String>) -> Result<(), String> {
    let text = custom_text.filter(|t| !t.trim().is_empty());
    let emoji = custom_emoji.filter(|e| !e.is_empty());
    let custom = if text.is_some() || emoji.is_some() {
        let mut a = json!({"name": "Custom Status", "type": 4, "state": text});
        if let Some(e) = emoji {
            a["emoji"] = json!({"name": e});
        }
        Some(a)
    } else {
        None
    };
    {
        let mut p = core.presence.lock().unwrap();
        p.status = status;
        p.custom = custom;
    }
    send_presence(&core)
}

#[tauri::command]
async fn get_profile(core: State<'_, CoreRef>, user_id: String, guild_id: Option<String>) -> Result<Value, String> {
    let t = tok(&core)?;
    let mut path = format!("/users/{user_id}/profile?with_mutual_guilds=true&with_mutual_friends=true");
    if let Some(g) = guild_id {
        path.push_str(&format!("&guild_id={g}"));
    }
    core.api.get(&t, &path).await
}

/// Profil guncelle. avatar: "data:image/png;base64,..." | null (kaldir) | alan yok (degistirme)
#[tauri::command]
async fn update_profile(core: State<'_, CoreRef>, user: Option<Value>, profile: Option<Value>) -> Result<Value, String> {
    let t = tok(&core)?;
    let mut out = json!({});
    if let Some(u) = user.filter(|u| u.as_object().map_or(false, |o| !o.is_empty())) {
        let me = core.api.req(&t, Method::PATCH, "/users/@me", Some(u)).await?;
        core.store.lock().unwrap().set_me(me.clone());
        out["user"] = me;
    }
    if let Some(p) = profile.filter(|p| p.as_object().map_or(false, |o| !o.is_empty())) {
        out["profile"] = core.api.req(&t, Method::PATCH, "/users/@me/profile", Some(p)).await?;
    }
    Ok(out)
}

/// Kullaniciyla DM kanali ac (varsa mevcut olani dondurur).
#[tauri::command]
async fn open_dm(core: State<'_, CoreRef>, user_id: String) -> Result<Value, String> {
    let t = tok(&core)?;
    let ch = core.api.req(&t, Method::POST, "/users/@me/channels", Some(json!({"recipients": [user_id]}))).await?;
    core.store.lock().unwrap().add_dm(&ch);
    Ok(ch)
}

/// Uye listesini (sag panel) almak icin gateway'e abone ol.
#[tauri::command]
fn subscribe_guild(core: State<'_, CoreRef>, guild_id: String, channel_id: String) {
    let mut channels = serde_json::Map::new();
    channels.insert(channel_id, json!([[0, 99]]));
    let msg = json!({"op": 14, "d": {
        "guild_id": guild_id, "typing": true, "activities": true, "threads": true,
        "channels": channels
    }});
    if let Some(tx) = core.gw_tx.lock().unwrap().as_ref() {
        let _ = tx.send(msg.to_string());
    }
}

#[tauri::command]
async fn edit_message(core: State<'_, CoreRef>, channel_id: String, message_id: String, content: String) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api
        .req(&t, Method::PATCH, &format!("/channels/{channel_id}/messages/{message_id}"), Some(json!({"content": content})))
        .await
}

#[tauri::command]
async fn delete_message(core: State<'_, CoreRef>, channel_id: String, message_id: String) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api.req(&t, Method::DELETE, &format!("/channels/{channel_id}/messages/{message_id}"), None).await
}

#[tauri::command]
fn channel_info(core: State<'_, CoreRef>, guild_id: String, channel_id: String) -> Option<Value> {
    core.store.lock().unwrap().channel_info(&guild_id, &channel_id)
}

#[tauri::command]
fn deleted_log(core: State<'_, CoreRef>) -> Vec<Value> {
    core.store.lock().unwrap().deleted.iter().cloned().collect()
}

#[tauri::command]
fn clear_deleted_log(core: State<'_, CoreRef>) {
    let mut s = core.store.lock().unwrap();
    s.deleted.clear();
    s.deleted_dirty = true;
}

/// Kanali okundu isaretle.
#[tauri::command]
async fn ack(core: State<'_, CoreRef>, channel_id: String, message_id: String) -> Result<(), String> {
    let t = tok(&core)?;
    {
        let mut s = core.store.lock().unwrap();
        if s.read_states.get(&channel_id).map_or(false, |r| r.0 == message_id && r.1 == 0) {
            return Ok(());
        }
        s.set_read(&channel_id, &message_id);
    }
    core.api
        .req(&t, Method::POST, &format!("/channels/{channel_id}/messages/{message_id}/ack"), Some(json!({"token": null})))
        .await
        .map(|_| ())
}

/// Mesaj arama (sunucu ya da DM).
#[tauri::command]
async fn search(core: State<'_, CoreRef>, guild_id: Option<String>, channel_id: Option<String>, query: String, offset: Option<u32>) -> Result<Value, String> {
    let t = tok(&core)?;
    let base = match (&guild_id, &channel_id) {
        (Some(g), _) => format!("/guilds/{g}/messages/search?"),
        (None, Some(c)) => format!("/channels/{c}/messages/search?"),
        _ => return Err("Arama yeri yok".into()),
    };
    let mut path = format!("{base}content={}&offset={}", api::enc(&query), offset.unwrap_or(0));
    if let (Some(_), Some(c)) = (&guild_id, &channel_id) {
        path.push_str(&format!("&channel_id={c}"));
    }
    // Indeks hazir degilse 202 doner; birkac kez dene
    for _ in 0..3 {
        let v = core.api.get(&t, &path).await?;
        if v["messages"].is_array() {
            return Ok(v);
        }
        let wait = v["retry_after"].as_f64().map_or(1500, |s| (s * 1000.0) as u64).min(5000);
        tokio::time::sleep(std::time::Duration::from_millis(wait)).await;
    }
    Err("Arama indeksi hazirlaniyor, birazdan tekrar dene".into())
}

#[tauri::command]
async fn pins(core: State<'_, CoreRef>, channel_id: String) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api.get(&t, &format!("/channels/{channel_id}/pins")).await
}

/// accept | remove | block
#[tauri::command]
async fn relationship_action(core: State<'_, CoreRef>, user_id: String, action: String) -> Result<(), String> {
    let t = tok(&core)?;
    let path = format!("/users/@me/relationships/{user_id}");
    match action.as_str() {
        "accept" => core.api.req(&t, Method::PUT, &path, Some(json!({}))).await,
        "block" => core.api.req(&t, Method::PUT, &path, Some(json!({"type": 2}))).await,
        _ => core.api.req(&t, Method::DELETE, &path, None).await,
    }
    .map(|_| ())
}

#[tauri::command]
async fn add_friend(core: State<'_, CoreRef>, username: String) -> Result<(), String> {
    let t = tok(&core)?;
    let u = username.trim().trim_start_matches('@').to_lowercase();
    if u.is_empty() {
        return Err("Kullanici adi bos".into());
    }
    core.api
        .req(&t, Method::POST, "/users/@me/relationships", Some(json!({"username": u, "discriminator": null})))
        .await
        .map(|_| ())
}

/// Sunucu (channel_id yok) ya da kanal bildirimlerini sessize al. DM icin guild_id = None.
#[tauri::command]
async fn set_mute(core: State<'_, CoreRef>, guild_id: Option<String>, channel_id: Option<String>, muted: bool) -> Result<(), String> {
    let t = tok(&core)?;
    let gid = guild_id.unwrap_or_else(|| "@me".into());
    let body = match &channel_id {
        Some(c) => {
            let mut o = serde_json::Map::new();
            o.insert(c.clone(), json!({"muted": muted}));
            json!({"channel_overrides": o})
        }
        None => json!({"muted": muted}),
    };
    {
        let mut s = core.store.lock().unwrap();
        let id = channel_id.clone().unwrap_or_else(|| gid.clone());
        let set = if channel_id.is_some() { &mut s.muted_channels } else { &mut s.muted_guilds };
        if muted {
            set.insert(id);
        } else {
            set.remove(&id);
        }
    }
    core.api.req(&t, Method::PATCH, &format!("/users/@me/guilds/{gid}/settings"), Some(body)).await.map(|_| ())
}

/// Bas-konus: enabled + kisayol (orn. "F8", "Ctrl+Shift+V")
#[tauri::command]
fn set_ptt(app: AppHandle, core: State<'_, CoreRef>, enabled: bool, shortcut: Option<String>) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let gs = app.global_shortcut();
    if let Some(old) = core.ptt_key.lock().unwrap().take() {
        let _ = gs.unregister(old.as_str());
    }
    core.voice_ctl.ptt_pressed.store(false, Ordering::Relaxed);
    core.voice_ctl.ptt_mode.store(enabled, Ordering::Relaxed);
    if !enabled {
        return Ok(());
    }
    let key = shortcut.filter(|k| !k.trim().is_empty()).ok_or("Kisayol secilmedi")?;
    gs.register(key.as_str()).map_err(|e| format!("Kisayol kaydedilemedi: {e}"))?;
    *core.ptt_key.lock().unwrap() = Some(key);
    Ok(())
}

#[tauri::command]
fn set_tray(core: State<'_, CoreRef>, enabled: bool) {
    core.tray_close.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())?;
    al.is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// Mesaj cevirisi (Google ceviri, kimliksiz). -> {text, from}
#[tauri::command]
async fn translate(core: State<'_, CoreRef>, text: String, target: String) -> Result<Value, String> {
    let v = core
        .api
        .external("https://translate.googleapis.com/translate_a/single", &[("client", "gtx"), ("sl", "auto"), ("tl", &target), ("dt", "t"), ("q", &text)])
        .await?;
    let out: String = store::arr(&v[0]).iter().filter_map(|p| p[0].as_str()).collect();
    Ok(json!({"text": out, "from": v[2]}))
}

/// GIF arama (Discord'un Tenor vekili). query bos = trend.
#[tauri::command]
async fn gifs(core: State<'_, CoreRef>, query: String) -> Result<Value, String> {
    let t = tok(&core)?;
    let q = query.trim();
    let path = if q.is_empty() {
        "/gifs/trending-gifs?media_format=mp4&locale=tr".to_string()
    } else {
        format!("/gifs/search?q={}&media_format=mp4&provider=tenor&locale=tr", api::enc(q))
    };
    core.api.get(&t, &path).await
}

/* ------------------------------------------------------------------ */
/* Goruntu: kamera + Go Live                                           */
/* ------------------------------------------------------------------ */

/// Arayuz, cozulecek goruntu karelerini bu kanaldan alir.
#[tauri::command]
fn video_subscribe(core: State<'_, CoreRef>, channel: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>) {
    *core.video.sink.lock().unwrap() = Some(channel);
}

/// Arayuzde kodlanmis H264 (Annex-B) kare. Basliklar: x-target (camera | yayin anahtari), x-key (1 = anahtar kare)
#[tauri::command]
fn video_frame(core: State<'_, CoreRef>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let target = request.headers().get("x-target").and_then(|v| v.to_str().ok()).unwrap_or("camera").to_string();
    let key = request.headers().get("x-key").and_then(|v| v.to_str().ok()) == Some("1");
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("ham veri bekleniyor".into()) };
    let tx = core.video.senders.lock().unwrap().get(&target).cloned();
    match tx {
        Some(tx) => tx.send(video::VOut::Frame { data: data.clone(), key }).map_err(|_| "baglanti kapali".to_string()),
        None => Ok(()), // baglanti henuz hazir degil: kareyi at
    }
}

/// Kamerayi ac/kapat (ses kanalinda).
#[tauri::command]
fn set_video(core: State<'_, CoreRef>, on: bool, width: u32, height: u32, fps: u32) -> Result<(), String> {
    let tx = core.video.senders.lock().unwrap().get("camera").cloned();
    if on && tx.is_none() {
        return Err("Önce bir ses kanalına bağlan".into());
    }
    if let Some(tx) = tx {
        let _ = tx.send(video::VOut::Active(on, width, height, fps));
    }
    core.self_video.store(on, Ordering::Relaxed);
    let vm = core.voice.lock().unwrap();
    let (g, c) = (vm.guild_id.clone(), vm.channel_id.clone());
    drop(vm);
    if c.is_some() {
        voice_state_op(&core, &g, &c)?;
    }
    Ok(())
}

/// Ekran paylasimini (Go Live) baslat; yayin anahtarini dondurur.
#[tauri::command]
fn start_stream(core: State<'_, CoreRef>) -> Result<String, String> {
    let me = core.store.lock().unwrap().me_id.clone();
    let mut vm = core.voice.lock().unwrap();
    let Some(ch) = vm.channel_id.clone() else { return Err("Önce bir ses kanalına bağlan".into()) };
    let g = vm.guild_id.clone();
    let key = video::stream_key(g.as_deref(), &ch, &me);
    vm.stop_stream(&key);
    vm.streams.insert(key.clone(), voice::StreamConn { sending: true, ..Default::default() });
    drop(vm);
    gw_send(&core, json!({"op": 18, "d": {"type": if g.is_some() {"guild"} else {"call"}, "guild_id": g, "channel_id": ch, "preferred_region": null}}))?;
    gw_send(&core, json!({"op": 22, "d": {"stream_key": key, "paused": false}}))?;
    Ok(key)
}

/// Yayindaki goruntu ayarlarini bildir / duraklat (op 12 yayin baglantisinda).
#[tauri::command]
fn stream_active(core: State<'_, CoreRef>, key: String, on: bool, width: u32, height: u32, fps: u32) {
    if let Some(tx) = core.video.senders.lock().unwrap().get(&key) {
        let _ = tx.send(video::VOut::Active(on, width, height, fps));
    }
}

/// Bir yayini izle (baskasinin ekran paylasimi).
#[tauri::command]
fn watch_stream(core: State<'_, CoreRef>, key: String) -> Result<(), String> {
    let mut vm = core.voice.lock().unwrap();
    if vm.channel_id.is_none() {
        return Err("Yayını izlemek için önce o ses kanalına katıl".into());
    }
    vm.stop_stream(&key);
    vm.streams.insert(key.clone(), voice::StreamConn::default());
    drop(vm);
    gw_send(&core, json!({"op": 20, "d": {"stream_key": key}}))
}

/// Kendi yayinini bitir ya da izlemeyi birak.
#[tauri::command]
fn stop_stream(core: State<'_, CoreRef>, key: String) -> Result<(), String> {
    if core.store.lock().unwrap().me_id.as_str() == video::stream_owner(&key).to_string() {
        *core.sys_audio.lock().unwrap() = None;
    }
    core.voice.lock().unwrap().stop_stream(&key);
    gw_send(&core, json!({"op": 19, "d": {"stream_key": key}}))
}

/* ------------------------------------------------------------------ */
/* Davetler, slash komutlari, anketler, sesli mesaj, moderasyon        */
/* ------------------------------------------------------------------ */

fn invite_code(s: &str) -> String {
    s.trim().trim_end_matches('/').rsplit('/').next().unwrap_or("").split('?').next().unwrap_or("").to_string()
}

#[tauri::command]
async fn invite_info(core: State<'_, CoreRef>, code: String) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api.get(&t, &format!("/invites/{}?with_counts=true&with_expiration=true", api::enc(&invite_code(&code)))).await
}

/// Davetle sunucuya katil. Discord dogrulama (captcha) isterse hata metni "captcha" icerir.
#[tauri::command]
async fn join_invite(core: State<'_, CoreRef>, code: String) -> Result<Value, String> {
    use base64::Engine;
    let t = tok(&core)?;
    let sid = core.store.lock().unwrap().gw_session.clone();
    let ctx = base64::engine::general_purpose::STANDARD.encode(r#"{"location":"Markdown Link"}"#);
    core.api
        .req_h(&t, Method::POST, &format!("/invites/{}", api::enc(&invite_code(&code))), Some(json!({"session_id": sid})), &[("X-Context-Properties", ctx)])
        .await
        .map_err(|e| if e.contains("captcha") { "captcha".to_string() } else { e })
}

#[tauri::command]
async fn create_invite(core: State<'_, CoreRef>, channel_id: String, max_age: u32, max_uses: u32) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api
        .req(&t, Method::POST, &format!("/channels/{channel_id}/invites"), Some(json!({"max_age": max_age, "max_uses": max_uses, "temporary": false})))
        .await
}

#[tauri::command]
async fn leave_guild(core: State<'_, CoreRef>, guild_id: String) -> Result<(), String> {
    let t = tok(&core)?;
    core.api.req(&t, Method::DELETE, &format!("/users/@me/guilds/{guild_id}"), Some(json!({"lurking": false}))).await.map(|_| ())
}

/// Kanalda kullanilabilir slash komutlari ({applications, application_commands}).
#[tauri::command]
async fn app_commands(core: State<'_, CoreRef>, guild_id: Option<String>, channel_id: String) -> Result<Value, String> {
    let t = tok(&core)?;
    let path = match &guild_id {
        Some(g) => format!("/guilds/{g}/application-command-index"),
        None => format!("/channels/{channel_id}/application-command-index"),
    };
    core.api.get(&t, &path).await
}

/// Slash komutu calistir. data: {version, id, name, type, options, application_command}
#[tauri::command]
async fn run_command(core: State<'_, CoreRef>, guild_id: Option<String>, channel_id: String, application_id: String, data: Value) -> Result<String, String> {
    let t = tok(&core)?;
    let sid = core.store.lock().unwrap().gw_session.clone();
    let n = nonce();
    let body = json!({"type": 2, "application_id": application_id, "guild_id": guild_id, "channel_id": channel_id, "session_id": sid, "data": data, "nonce": n});
    core.api.req(&t, Method::POST, "/interactions", Some(body)).await?;
    Ok(n)
}

#[tauri::command]
async fn poll_vote(core: State<'_, CoreRef>, channel_id: String, message_id: String, answer_ids: Vec<u32>) -> Result<(), String> {
    let t = tok(&core)?;
    let ids: Vec<String> = answer_ids.iter().map(|a| a.to_string()).collect();
    core.api
        .req(&t, Method::PUT, &format!("/channels/{channel_id}/polls/{message_id}/answers/@me"), Some(json!({"answer_ids": ids})))
        .await
        .map(|_| ())
}

#[tauri::command]
async fn end_poll(core: State<'_, CoreRef>, channel_id: String, message_id: String) -> Result<(), String> {
    let t = tok(&core)?;
    core.api.req(&t, Method::POST, &format!("/channels/{channel_id}/polls/{message_id}/expire"), None).await.map(|_| ())
}

/// Sesli mesaj gonder: govde = 48 kHz mono f32 (little endian). Baslik: x-channel
#[tauri::command]
async fn voice_message(core: State<'_, CoreRef>, request: tauri::ipc::Request<'_>) -> Result<Value, String> {
    let t = tok(&core)?;
    let ch = request.headers().get("x-channel").and_then(|v| v.to_str().ok()).ok_or("kanal yok")?.to_string();
    let tauri::ipc::InvokeBody::Raw(raw) = request.body() else { return Err("ham veri bekleniyor".into()) };
    let pcm: Vec<f32> = raw.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let vm = tauri::async_runtime::spawn_blocking(move || media::encode_voice_message(&pcm)).await.map_err(|e| e.to_string())??;
    let payload = json!({
        "flags": 8192, "nonce": nonce(), "content": "",
        "attachments": [{"id": "0", "filename": "voice-message.ogg", "duration_secs": vm.duration_secs, "waveform": vm.waveform}]
    });
    core.api.upload(&t, &format!("/channels/{ch}/messages"), &payload, &[("voice-message.ogg".into(), vm.ogg)]).await
}

/// Yayin sesi (Go Live): govde = 48 kHz stereo aralikli f32. Baslik: x-target (yayin anahtari)
#[tauri::command]
fn stream_audio(core: State<'_, CoreRef>, request: tauri::ipc::Request<'_>) {
    let Some(key) = request.headers().get("x-target").and_then(|v| v.to_str().ok()) else { return };
    let tauri::ipc::InvokeBody::Raw(raw) = request.body() else { return };
    let pcm: Vec<f32> = raw.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    if let Some(tx) = core.video.senders.lock().unwrap().get(key) {
        let _ = tx.send(video::VOut::Pcm(pcm));
    }
}

#[tauri::command]
async fn member_info(core: State<'_, CoreRef>, guild_id: String, user_id: String) -> Result<Value, String> {
    let t = tok(&core)?;
    core.api.get(&t, &format!("/guilds/{guild_id}/members/{user_id}")).await
}

/// Moderasyon: kick | ban | unban | timeout | roles | nick | pin | unpin
#[tauri::command]
async fn mod_action(
    core: State<'_, CoreRef>,
    action: String,
    guild_id: Option<String>,
    channel_id: Option<String>,
    target: String,
    value: Option<Value>,
    reason: Option<String>,
) -> Result<Value, String> {
    let t = tok(&core)?;
    let g = guild_id.unwrap_or_default();
    let mut h: Vec<(&str, String)> = vec![];
    if let Some(r) = reason.filter(|r| !r.trim().is_empty()) {
        h.push(("X-Audit-Log-Reason", api::enc(&r)));
    }
    let v = value.unwrap_or(Value::Null);
    let me = core.store.lock().unwrap().me_id.clone();
    let member = if target == me { format!("/guilds/{g}/members/@me") } else { format!("/guilds/{g}/members/{target}") };
    let (m, path, body) = match action.as_str() {
        "kick" => (Method::DELETE, format!("/guilds/{g}/members/{target}"), None),
        "ban" => (Method::PUT, format!("/guilds/{g}/bans/{target}"), Some(json!({"delete_message_seconds": v.as_u64().unwrap_or(0)}))),
        "unban" => (Method::DELETE, format!("/guilds/{g}/bans/{target}"), None),
        "timeout" => (Method::PATCH, member, Some(json!({"communication_disabled_until": v}))),
        "roles" => (Method::PATCH, member, Some(json!({"roles": v}))),
        "nick" => (Method::PATCH, member, Some(json!({"nick": v}))),
        "pin" | "unpin" => {
            let c = channel_id.ok_or("kanal yok")?;
            (if action == "pin" { Method::PUT } else { Method::DELETE }, format!("/channels/{c}/pins/{target}"), None)
        }
        _ => return Err("bilinmeyen islem".into()),
    };
    core.api.req_h(&t, m, &path, body, &h).await
}

/// Yayin sesi: sistem sesini (Shion haric) yakalayip yayin baglantisina gonder.
#[tauri::command]
fn system_audio(core: State<'_, CoreRef>, key: String, on: bool) -> Result<(), String> {
    *core.sys_audio.lock().unwrap() = None;
    if !on {
        return Ok(());
    }
    let tx = core.video.senders.lock().unwrap().get(&key).cloned().ok_or("Yayin bagli degil")?;
    let h = audio::start_system_capture(move |pcm| {
        let _ = tx.send(video::VOut::Pcm(pcm));
    })?;
    *core.sys_audio.lock().unwrap() = Some(h);
    Ok(())
}

/// Mikrofon testi: secili mikrofonu (gurultu engelleme dahil) ac, seviyeyi bildir,
/// istenirse kendi sesini hoparlorden geri cal.
#[tauri::command]
async fn mic_test(app: AppHandle, core: State<'_, CoreRef>, on: bool, playback: bool) -> Result<(), String> {
    *core.mic_test.lock().unwrap() = None;
    if !on {
        return Ok(());
    }
    let mixer: audio::Mixer = Arc::new(Mutex::new(std::collections::HashMap::new()));
    let (tx, rx) = std::sync::mpsc::sync_channel::<Vec<f32>>(64);
    let ctl = core.voice_ctl.clone();
    let mix2 = mixer.clone();
    let (h, info, has_mic) = tauri::async_runtime::spawn_blocking(move || audio::start(ctl, mix2, Some(tx))).await.map_err(|e| e.to_string())??;
    if !has_mic {
        return Err("Mikrofon acilamadi".into());
    }
    let ctl = core.voice_ctl.clone();
    std::thread::Builder::new()
        .name("shion-mictest".into())
        .spawn(move || {
            let mut rs = audio::Resampler::new(audio::RATE, info.rate);
            let ch = info.channels.max(1) as usize;
            let mut acc: Vec<f32> = Vec::new();
            let mut peak = 0f32;
            let mut n = 0;
            // tx dusurulunce (test kapaninca) rx biter
            while let Ok(chunk) = rx.recv() {
                acc.extend_from_slice(&chunk);
                while acc.len() >= 960 {
                    let fr: Vec<f32> = acc.drain(..960).collect();
                    let rms = (fr.iter().map(|s| s * s).sum::<f32>() / 960.0).sqrt();
                    peak = peak.max(rms);
                    n += 1;
                    if n % 3 == 0 {
                        let _ = tauri::Emitter::emit(&app, "mic-level", json!({"rms": peak, "speaking": peak > ctl.threshold()}));
                        peak = 0.0;
                    }
                    if playback {
                        let mut out = Vec::new();
                        rs.process(&fr, &mut out);
                        let mut m = mixer.lock().unwrap();
                        let tr = m.entry(0).or_insert_with(|| audio::Track { buf: Default::default(), primed: false });
                        for v in out { for _ in 0..ch { tr.buf.push_back(v); } }
                        let per_ms = info.rate as usize * ch / 1000;
                        if tr.buf.len() > per_ms * 300 { let extra = tr.buf.len() - per_ms * 80; tr.buf.drain(..extra); }
                        if tr.buf.len() >= per_ms * 40 { tr.primed = true; }
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    *core.mic_test.lock().unwrap() = Some(h);
    Ok(())
}

#[tauri::command]
fn set_user_volume(core: State<'_, CoreRef>, user_id: String, volume: f32) {
    let Ok(id) = user_id.parse::<u64>() else { return };
    let mut m = core.voice_ctl.user_volume.lock().unwrap();
    if (volume - 1.0).abs() < 0.01 { m.remove(&id); } else { m.insert(id, volume.clamp(0.0, 3.0)); }
}

#[tauri::command]
fn set_noise(core: State<'_, CoreRef>, on: bool) {
    core.voice_ctl.noise.store(on, Ordering::Relaxed);
}

#[tauri::command]
fn set_keywords(core: State<'_, CoreRef>, words: Vec<String>) {
    core.store.lock().unwrap().keywords = words.into_iter().map(|w| w.trim().to_lowercase()).filter(|w| w.chars().count() >= 2).collect();
}

#[tauri::command]
fn set_game_detect(core: State<'_, CoreRef>, on: bool) {
    core.game_detect.store(on, Ordering::Relaxed);
}

fn games_cache(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("games.json"))
}

/// Tespit edilebilir oyun listesi: diskte 7 gunluk onbellek, yoksa Discord'dan.
async fn load_games(app: &AppHandle, core: &CoreRef) -> Option<extra::GameMap> {
    let path = games_cache(app)?;
    let fresh = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).map_or(false, |e| e.as_secs() < 7 * 86400);
    if fresh {
        if let Some(m) = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()) {
            return Some(m);
        }
    }
    let list = core.api.external("https://discord.com/api/v9/applications/detectable", &[]).await.ok()?;
    let map = extra::build_game_map(&list);
    drop(list);
    if let Some(d) = path.parent() {
        let _ = std::fs::create_dir_all(d);
    }
    let _ = std::fs::write(&path, serde_json::to_string(&map).unwrap_or_default());
    Some(map)
}

/// Arka plan: calisan oyunu bul, "Oynuyor" aktivitesi olarak yayinla.
async fn game_loop(app: AppHandle, core: CoreRef) {
    let mut map: Option<extra::GameMap> = None;
    let mut current: Option<String> = None;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        let on = core.game_detect.load(Ordering::Relaxed) && core.gw_tx.lock().unwrap().is_some();
        let found = if on {
            if map.is_none() {
                map = load_games(&app, &core).await;
            }
            match &map {
                Some(m) => {
                    let m2 = m.clone();
                    tauri::async_runtime::spawn_blocking(move || extra::detect(&m2, &extra::running_exes())).await.ok().flatten()
                }
                None => None,
            }
        } else {
            None
        };
        let id = found.as_ref().map(|f| f.0.clone());
        let lost_presence = id.is_some() && core.presence.lock().unwrap().game.is_none();
        if id == current && !lost_presence {
            continue;
        }
        current = id;
        core.presence.lock().unwrap().game = found.as_ref().map(|(id, name)| extra::game_activity(id, name, store::now_ms()));
        let _ = send_presence(&core);
        let _ = tauri::Emitter::emit(&app, "game", found.map(|f| f.1));
    }
}

/// Kanal gecmisini Indirilenler/Shion klasorune HTML veya JSON olarak yaz.
#[tauri::command]
async fn export_channel(app: AppHandle, core: State<'_, CoreRef>, channel_id: String, name: String, format: String) -> Result<String, String> {
    let t = tok(&core)?;
    core.export_cancel.store(false, Ordering::Relaxed);
    let mut all: Vec<Value> = Vec::new();
    let mut before: Option<String> = None;
    loop {
        if core.export_cancel.load(Ordering::Relaxed) {
            return Err("iptal".into());
        }
        let mut p = format!("/channels/{channel_id}/messages?limit=100");
        if let Some(b) = &before {
            p.push_str(&format!("&before={b}"));
        }
        let page = core.api.get(&t, &p).await?;
        let list = page.as_array().cloned().unwrap_or_default();
        let n = list.len();
        before = list.last().and_then(|m| m["id"].as_str()).map(String::from);
        all.extend(list);
        let _ = tauri::Emitter::emit(&app, "export-progress", all.len());
        if n < 100 || before.is_none() {
            break;
        }
    }
    all.reverse();
    let dir = app.path().download_dir().map_err(|e| e.to_string())?.join("Shion");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let date = chrono_like_date();
    let (data, ext) = if format == "json" {
        (serde_json::to_string_pretty(&all).map_err(|e| e.to_string())?, "json")
    } else {
        (extra::export_html(&name, &all), "html")
    };
    let file = dir.join(format!("{}-{date}.{ext}", extra::safe_name(&name)));
    std::fs::write(&file, data).map_err(|e| e.to_string())?;
    {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().reveal_item_in_dir(&file);
    }
    Ok(file.to_string_lossy().into_owned())
}

#[tauri::command]
fn cancel_export(core: State<'_, CoreRef>) {
    core.export_cancel.store(true, Ordering::Relaxed);
}

/// YYYYMMDD-HHMM (UTC)
fn chrono_like_date() -> String {
    let secs = (store::now_ms() / 1000) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    // Howard Hinnant civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}{m:02}{d:02}-{:02}{:02}", rem / 3600, rem % 3600 / 60)
}

/// Gorunum yedegi gibi metin dosyalarini Indirilenler/Shion'a yaz, klasorde goster.
#[tauri::command]
fn save_text(app: AppHandle, name: String, content: String) -> Result<String, String> {
    let dir = app.path().download_dir().map_err(|e| e.to_string())?.join("Shion");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(extra::safe_name(&name));
    std::fs::write(&file, content).map_err(|e| e.to_string())?;
    {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().reveal_item_in_dir(&file);
    }
    Ok(file.to_string_lossy().into_owned())
}

/// Avatar / banner / emoji / cikartma indir (sadece Discord CDN), klasorde goster.
#[tauri::command]
async fn save_media(app: AppHandle, core: State<'_, CoreRef>, url: String, name: String) -> Result<String, String> {
    if !extra::allowed_media(&url) {
        return Err("Sadece Discord CDN".into());
    }
    let data = core.api.bytes(&url).await?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?.join("Shion");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let name = extra::safe_name(&name);
    let mut file = dir.join(&name);
    let mut i = 1;
    while file.exists() {
        let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, ""));
        file = dir.join(format!("{stem} ({i}).{ext}"));
        i += 1;
    }
    std::fs::write(&file, data).map_err(|e| e.to_string())?;
    {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().reveal_item_in_dir(&file);
    }
    Ok(file.to_string_lossy().into_owned())
}

/* ------------------------------------------------------------------ */
/* Otomatik guncelleme (GitHub Releases, imzali)                        */
/* ------------------------------------------------------------------ */
#[tauri::command]
fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<Value>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let up = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(up.map(|u| json!({"version": u.version, "current": u.current_version, "notes": u.body, "date": u.date.map(|d| d.to_string())})))
}

/// Indir, dogrula, kur ve yeniden baslat. Ilerleme: "update-progress" {got, total}
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let up = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?.ok_or("Guncelleme yok")?;
    let a2 = app.clone();
    let mut got: usize = 0;
    up.download_and_install(
        move |chunk, total| {
            got += chunk;
            let _ = tauri::Emitter::emit(&a2, "update-progress", json!({"got": got, "total": total}));
        },
        || {},
    )
    .await
    .map_err(|e| e.to_string())?;
    app.restart();
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn main() {
    let core: CoreRef = Arc::new(Core {
        store: Mutex::new(store::Store::default()),
        api: api::Api::new(),
        gw: Mutex::new(None),
        gw_tx: Mutex::new(None),
        voice: Mutex::new(voice::VoiceMgr::default()),
        voice_ctl: Arc::new(audio::VoiceCtl::default()),
        tray_close: AtomicBool::new(false),
        ptt_key: Mutex::new(None),
        video: Arc::new(video::VideoHub::default()),
        self_video: AtomicBool::new(false),
        presence: Mutex::new(Presence::default()),
        game_detect: AtomicBool::new(false),
        auto_idle: AtomicBool::new(false),
        export_cancel: AtomicBool::new(false),
        sys_audio: Mutex::new(None),
        mic_test: Mutex::new(None),
    });
    let ptt_ctl = core.voice_ctl.clone();
    let close_core = core.clone();
    let setup_core = core.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, _sc, ev| {
                    let down = ev.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed;
                    if ptt_ctl.ptt_pressed.swap(down, Ordering::Relaxed) != down {
                        let _ = tauri::Emitter::emit(app, "ptt", down);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            let show = MenuItem::with_id(app, "show", "Shion'u aç", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Çık", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tb = TrayIconBuilder::with_id("main")
                .tooltip("Shion")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tb = tb.icon(icon.clone());
            }
            tb.build(app)?;
            if std::env::args().any(|a| a == "--minimized") {
                setup_core.tray_close.store(true, Ordering::Relaxed);
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            tauri::async_runtime::spawn(game_loop(app.handle().clone(), setup_core.clone()));
            // Silinen mesaj kaydini periyodik olarak diske yaz
            let h = app.handle().clone();
            let c = setup_core.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                    save_log(&h, &c);
                }
            });
            Ok(())
        })
        .on_window_event(move |w, e| match e {
            tauri::WindowEvent::CloseRequested { api, .. } if close_core.tray_close.load(Ordering::Relaxed) => {
                api.prevent_close();
                let _ = w.hide();
            }
            tauri::WindowEvent::Destroyed => save_log(w.app_handle(), &close_core),
            _ => {}
        })
        .manage(core)
        .invoke_handler(tauri::generate_handler![
            saved_token,
            set_custom_rpc,
            fetch_message,
            reaction_users,
            clone_emoji,
            save_cache,
            load_cache,
            diagnostics,
            mentions_inbox,
            forward_message,
            mark_unread,
            get_note,
            set_note,
            send_sound,
            default_sounds,
            profile_effects,
            save_text,
            guild_events,
            set_auto_idle,
            login,
            logout,
            get_state,
            set_active_channel,
            get_messages,
            send_message,
            edit_message,
            delete_message,
            channel_info,
            deleted_log,
            clear_deleted_log,
            send_typing,
            react,
            forum_threads,
            create_forum_post,
            subscribe_guild,
            join_voice,
            leave_voice,
            set_voice_flags,
            voice_devices,
            set_voice_settings,
            ring_call,
            stop_ringing,
            set_status,
            get_profile,
            update_profile,
            open_dm,
            ack,
            search,
            pins,
            relationship_action,
            add_friend,
            set_mute,
            set_ptt,
            set_tray,
            set_autostart,
            get_autostart,
            translate,
            gifs,
            video_subscribe,
            video_frame,
            set_video,
            start_stream,
            stream_active,
            watch_stream,
            stop_stream,
            invite_info,
            join_invite,
            create_invite,
            leave_guild,
            app_commands,
            run_command,
            poll_vote,
            end_poll,
            voice_message,
            stream_audio,
            member_info,
            mod_action,
            list_accounts,
            switch_account,
            add_account,
            remove_account,
            set_noise,
            set_keywords,
            set_game_detect,
            export_channel,
            cancel_export,
            save_media,
            system_audio,
            set_user_volume,
            mic_test,
            app_version,
            check_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("Shion baslatilamadi");
}
