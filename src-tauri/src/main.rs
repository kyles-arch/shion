#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod api;
mod audio;
mod gateway;
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
    }
    {
        let mut s = core.store.lock().unwrap();
        *s = store::Store::default();
        s.token = token.clone();
        s.set_me(me.clone());
        if let Some(log) = log_path(&app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()) {
            s.deleted = log;
        }
    }
    let handle = tauri::async_runtime::spawn(gateway::run(app.clone(), core.inner().clone(), token));
    let old = core.gw.lock().unwrap().replace(handle);
    if let Some(old) = old {
        old.abort();
    }
    Ok(me)
}

#[tauri::command]
fn logout(app: AppHandle, core: State<'_, CoreRef>) {
    if let Some(h) = core.gw.lock().unwrap().take() {
        h.abort();
    }
    let mut vm = core.voice.lock().unwrap();
    vm.stop();
    vm.channel_id = None;
    drop(vm);
    *core.store.lock().unwrap() = store::Store::default();
    if let Some(p) = token_path(&app) {
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
) -> Result<Value, String> {
    use base64::Engine;
    let t = tok(&core)?;
    let mut body = json!({"content": content, "nonce": nonce(), "tts": false, "flags": 0});
    if let Some(r) = reply_to {
        body["message_reference"] = json!({"message_id": r, "channel_id": channel_id});
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
    let mut activities = vec![];
    let text = custom_text.filter(|t| !t.trim().is_empty());
    let emoji = custom_emoji.filter(|e| !e.is_empty());
    if text.is_some() || emoji.is_some() {
        let mut a = json!({"name": "Custom Status", "type": 4, "state": text});
        if let Some(e) = emoji {
            a["emoji"] = json!({"name": e});
        }
        activities.push(a);
    }
    gw_send(&core, json!({"op": 3, "d": {"status": status, "since": 0, "activities": activities, "afk": false}}))
}

#[tauri::command]
async fn get_profile(core: State<'_, CoreRef>, user_id: String, guild_id: Option<String>) -> Result<Value, String> {
    let t = tok(&core)?;
    let mut path = format!("/users/{user_id}/profile?with_mutual_guilds=true&with_mutual_friends=false");
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
    core.voice.lock().unwrap().stop_stream(&key);
    gw_send(&core, json!({"op": 19, "d": {"stream_key": key}}))
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
    });
    let ptt_ctl = core.voice_ctl.clone();
    let close_core = core.clone();
    let setup_core = core.clone();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
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
            stop_stream
        ])
        .run(tauri::generate_context!())
        .expect("Shion baslatilamadi");
}
