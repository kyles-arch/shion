//! Discord Gateway (WebSocket) baglantisi: heartbeat, resume, olay isleme.

use crate::store::{arr, Store};
use crate::{api, CoreRef};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio_tungstenite::{connect_async, tungstenite::Message};

enum Exit {
    Reconnect,
    Fatal(String),
}

struct Session {
    id: Option<String>,
    resume_url: Option<String>,
    seq: Option<u64>,
}

fn status(app: &AppHandle, s: &str) {
    let _ = app.emit("gw-status", s);
}

pub async fn run(app: AppHandle, core: CoreRef, token: String) {
    let mut sess = Session { id: None, resume_url: None, seq: None };
    let mut backoff = 1u64;
    loop {
        let base = sess.resume_url.clone().unwrap_or_else(|| "wss://gateway.discord.gg".into());
        let url = format!("{}/?v=9&encoding=json", base.trim_end_matches('/'));
        status(&app, "connecting");
        let mut got_hello = false;
        match session_loop(&app, &core, &token, &url, &mut sess, &mut got_hello).await {
            Ok(Exit::Fatal(msg)) => {
                status(&app, &format!("fatal:{msg}"));
                return;
            }
            Ok(Exit::Reconnect) => {}
            Err(e) => eprintln!("gateway hata: {e}"),
        }
        if got_hello {
            backoff = 1;
        }
        status(&app, "reconnecting");
        tokio::time::sleep(Duration::from_secs(backoff)).await;
        backoff = (backoff * 2).min(30);
    }
}

async fn session_loop(
    app: &AppHandle,
    core: &CoreRef,
    token: &str,
    url: &str,
    sess: &mut Session,
    got_hello: &mut bool,
) -> Result<Exit, String> {
    let (ws, _) = connect_async(url).await.map_err(|e| e.to_string())?;
    let (mut tx, mut rx) = ws.split();

    // HELLO
    let hello = loop {
        match rx.next().await {
            Some(Ok(Message::Text(t))) => break serde_json::from_str::<Value>(&t).map_err(|e| e.to_string())?,
            Some(Ok(_)) => continue,
            Some(Err(e)) => return Err(e.to_string()),
            None => return Ok(Exit::Reconnect),
        }
    };
    *got_hello = true;
    let interval = hello["d"]["heartbeat_interval"].as_u64().unwrap_or(41250);

    let first = match (&sess.id, sess.seq) {
        (Some(id), Some(seq)) => json!({"op": 6, "d": {"token": token, "session_id": id, "seq": seq}}),
        _ => json!({"op": 2, "d": {
            "token": token,
            "capabilities": 0,
            "properties": api::props(),
            "presence": {"status": "unknown", "since": 0, "activities": [], "afk": false},
            "compress": false,
            "client_state": {"guild_versions": {}}
        }}),
    };
    tx.send(Message::Text(first.to_string())).await.map_err(|e| e.to_string())?;
    status(app, "connected");

    let mut hb = tokio::time::interval(Duration::from_millis(interval));
    hb.tick().await;
    let mut acked = true;
    // Uygulamadan gateway'e giden istekler (uye listesi abonelikleri vb.)
    let (otx, mut orx) = tokio::sync::mpsc::unbounded_channel::<String>();
    *core.gw_tx.lock().unwrap() = Some(otx);

    loop {
        tokio::select! {
            Some(out) = orx.recv() => {
                tx.send(Message::Text(out)).await.map_err(|e| e.to_string())?;
            }
            _ = hb.tick() => {
                if !acked {
                    return Ok(Exit::Reconnect); // zombi baglanti
                }
                acked = false;
                tx.send(Message::Text(json!({"op": 1, "d": sess.seq}).to_string())).await.map_err(|e| e.to_string())?;
            }
            msg = rx.next() => {
                let msg = match msg {
                    None => return Ok(Exit::Reconnect),
                    Some(Err(e)) => return Err(e.to_string()),
                    Some(Ok(m)) => m,
                };
                let text = match msg {
                    Message::Text(t) => t,
                    Message::Binary(b) => String::from_utf8_lossy(&b).into_owned(),
                    Message::Close(frame) => {
                        let code = frame.map(|f| u16::from(f.code)).unwrap_or(1000);
                        return Ok(match code {
                            4004 => Exit::Fatal("Token gecersiz".into()),
                            4010..=4014 => Exit::Fatal(format!("Gateway kapatti ({code})")),
                            4007 | 4009 => { sess.id = None; sess.seq = None; Exit::Reconnect }
                            _ => Exit::Reconnect,
                        });
                    }
                    _ => continue,
                };
                let v: Value = match serde_json::from_str(&text) { Ok(v) => v, Err(_) => continue };
                match v["op"].as_u64().unwrap_or(99) {
                    0 => {
                        if let Some(s) = v["s"].as_u64() { sess.seq = Some(s); }
                        let t = v["t"].as_str().unwrap_or("");
                        if t == "READY" {
                            sess.id = v["d"]["session_id"].as_str().map(String::from);
                            sess.resume_url = v["d"]["resume_gateway_url"].as_str().map(String::from);
                        }
                        dispatch(app, core, t, &v["d"]);
                    }
                    1 => {
                        tx.send(Message::Text(json!({"op": 1, "d": sess.seq}).to_string())).await.map_err(|e| e.to_string())?;
                    }
                    7 => return Ok(Exit::Reconnect),
                    9 => {
                        if v["d"].as_bool() != Some(true) { sess.id = None; sess.seq = None; sess.resume_url = None; }
                        tokio::time::sleep(Duration::from_millis(2500)).await;
                        return Ok(Exit::Reconnect);
                    }
                    11 => acked = true,
                    _ => {}
                }
            }
        }
    }
}

fn is_mention(s: &Store, m: &Value) -> bool {
    m["guild_id"].is_null() && !s.is_guild_channel(m["channel_id"].as_str().unwrap_or(""))
        || m["mention_everyone"] == true
        || arr(&m["mentions"]).iter().any(|u| u["id"].as_str() == Some(s.me_id.as_str()))
}

fn dispatch(app: &AppHandle, core: &CoreRef, t: &str, d: &Value) {
    let mut s = core.store.lock().unwrap();
    let mut guilds_changed = false;
    match t {
        "READY" => {
            let active = std::mem::take(&mut s.active_channel);
            let token = std::mem::take(&mut s.token);
            let old_msgs = std::mem::take(&mut s.messages);
            let old_log = std::mem::take(&mut s.deleted);
            *s = Store { token, active_channel: active, messages: old_msgs, deleted: old_log, ..Default::default() };
            s.set_me(d["user"].clone());
            s.gw_session = d["session_id"].as_str().unwrap_or("").to_string();
            for u in arr(&d["users"]) {
                s.cache_user(u);
            }
            let merged = d["merged_members"].as_array();
            let me = s.me_id.clone();
            for (i, g) in arr(&d["guilds"]).iter().enumerate() {
                let mm = merged
                    .and_then(|m| m.get(i))
                    .and_then(|a| a.as_array())
                    .and_then(|a| a.iter().find(|x| x["user_id"].as_str() == Some(me.as_str())));
                s.load_guild(g, mm);
            }
            for pc in arr(&d["private_channels"]) {
                s.add_dm(pc);
            }
            // Kullanicinin sunucu siralamasi (varsa)
            let order: Vec<String> = arr(&d["user_settings"]["guild_positions"])
                .iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect();
            if !order.is_empty() {
                s.guilds.sort_by_key(|g| order.iter().position(|o| *o == g.id).unwrap_or(usize::MAX));
            }
            s.folders = d["user_settings"]["guild_folders"].clone();
            s.load_social(d);
            let missing: Vec<String> = s.guilds.iter().filter(|g| !g.members_known).map(|g| g.id.clone()).collect();
            let token = s.token.clone();
            drop(s);
            let _ = app.emit("gw-ready", ());
            if !missing.is_empty() {
                tauri::async_runtime::spawn(fetch_my_roles(app.clone(), core.clone(), token, me, missing));
            }
            return;
        }
        "GUILD_CREATE" => {
            let me = s.me_id.clone();
            let m = arr(&d["members"]).iter().find(|m| m["user"]["id"].as_str() == Some(me.as_str()));
            s.load_guild(d, m);
            guilds_changed = true;
        }
        "GUILD_UPDATE" => {
            if let Some(g) = s.guild_mut(d["id"].as_str().unwrap_or("")) {
                if let Some(n) = d["name"].as_str() {
                    g.name = n.to_string();
                }
                g.icon = d["icon"].clone();
                if let Some(o) = d["owner_id"].as_str() {
                    g.owner_id = o.to_string();
                }
                if let Some(roles) = d["roles"].as_array() {
                    g.roles = roles.iter().map(|r| (r["id"].as_str().unwrap_or("").to_string(), r.clone())).collect();
                }
                guilds_changed = true;
            }
        }
        "GUILD_DELETE" => {
            let id = d["id"].as_str().unwrap_or("");
            s.guilds.retain(|g| g.id != id);
            guilds_changed = true;
        }
        "CHANNEL_CREATE" | "CHANNEL_UPDATE" => {
            if let Some(gid) = d["guild_id"].as_str() {
                if let Some(g) = s.guild_mut(gid) {
                    g.channels.insert(d["id"].as_str().unwrap_or("").to_string(), d.clone());
                }
            } else {
                s.add_dm(d);
            }
            guilds_changed = true;
        }
        "CHANNEL_DELETE" => {
            let id = d["id"].as_str().unwrap_or("").to_string();
            if let Some(gid) = d["guild_id"].as_str() {
                if let Some(g) = s.guild_mut(gid) {
                    g.channels.remove(&id);
                }
            } else {
                s.dms.remove(&id);
            }
            guilds_changed = true;
        }
        "GUILD_ROLE_CREATE" | "GUILD_ROLE_UPDATE" => {
            if let Some(g) = s.guild_mut(d["guild_id"].as_str().unwrap_or("")) {
                g.roles.insert(d["role"]["id"].as_str().unwrap_or("").to_string(), d["role"].clone());
                guilds_changed = true;
            }
        }
        "GUILD_ROLE_DELETE" => {
            if let Some(g) = s.guild_mut(d["guild_id"].as_str().unwrap_or("")) {
                g.roles.remove(d["role_id"].as_str().unwrap_or(""));
                guilds_changed = true;
            }
        }
        "GUILD_MEMBER_UPDATE" => {
            if d["user"]["id"].as_str() == Some(s.me_id.as_str()) {
                let roles: Vec<String> = arr(&d["roles"]).iter().filter_map(|r| r.as_str().map(String::from)).collect();
                if let Some(g) = s.guild_mut(d["guild_id"].as_str().unwrap_or("")) {
                    g.my_roles = roles;
                    g.members_known = true;
                    guilds_changed = true;
                }
            }
        }
        "MESSAGE_CREATE" => {
            let ch = d["channel_id"].as_str().unwrap_or("").to_string();
            s.put_messages(&ch, vec![d.clone()]);
            s.touch_last(&ch, &d["id"]);
            if d["author"]["id"].as_str() == Some(s.me_id.as_str()) {
                s.set_read(&ch, d["id"].as_str().unwrap_or(""));
            } else if s.active_channel != ch && is_mention(&s, d) {
                let e = s.read_states.entry(ch.clone()).or_insert((String::new(), 0));
                e.1 += 1;
            }
            if s.active_channel == ch {
                let _ = app.emit("msg-create", d);
            } else {
                let mine = d["author"]["id"].as_str() == Some(s.me_id.as_str());
                let mention = is_mention(&s, d) && !mine;
                let keyword = if mine || mention { None } else { s.keyword_hit(d["content"].as_str().unwrap_or("")) };
                let mut ev = json!({"channel_id": ch, "guild_id": d["guild_id"], "mention": mention, "message_id": d["id"]});
                if let Some(k) = &keyword {
                    ev["keyword"] = json!(k);
                }
                if mention || keyword.is_some() {
                    let (_, gname, cname) = s.names(&ch);
                    let a = &d["author"];
                    ev["author"] = json!(a["global_name"].as_str().or(a["username"].as_str()).unwrap_or("?"));
                    ev["content"] = json!(d["content"].as_str().unwrap_or("").chars().take(160).collect::<String>());
                    ev["where"] = json!(if d["guild_id"].is_null() { cname } else { format!("{gname} › {cname}") });
                }
                let _ = app.emit("unread", ev);
            }
        }
        "MESSAGE_POLL_VOTE_ADD" | "MESSAGE_POLL_VOTE_REMOVE" => {
            if let Some(m) = s.on_poll_vote(d, t == "MESSAGE_POLL_VOTE_ADD") {
                if s.active_channel == d["channel_id"].as_str().unwrap_or("") {
                    let _ = app.emit("msg-update", m);
                }
            }
        }
        "INTERACTION_SUCCESS" | "INTERACTION_FAILURE" | "INTERACTION_CREATE" => {
            let _ = app.emit("interaction", json!({"nonce": d["nonce"], "ok": t != "INTERACTION_FAILURE"}));
        }
        "MESSAGE_ACK" => {
            let ch = d["channel_id"].as_str().unwrap_or("").to_string();
            s.set_read(&ch, d["message_id"].as_str().unwrap_or(""));
            let _ = app.emit("ack", json!({"channel_id": ch, "message_id": d["message_id"]}));
        }
        "RELATIONSHIP_ADD" | "RELATIONSHIP_UPDATE" => {
            s.on_relationship(d);
            let _ = app.emit("friends", s.social_json()["friends"].clone());
        }
        "RELATIONSHIP_REMOVE" => {
            s.relationships.remove(d["id"].as_str().unwrap_or(""));
            let _ = app.emit("friends", s.social_json()["friends"].clone());
        }
        "PRESENCE_UPDATE" => {
            let id = d["user"]["id"].as_str().unwrap_or("").to_string();
            if s.on_presence(d) {
                let _ = app.emit("presence", json!({"user_id": id, "status": d["status"], "activities": d["activities"], "user": d["user"]}));
            }
        }
        "USER_GUILD_SETTINGS_UPDATE" => {
            s.on_guild_settings(d);
            let sj = s.social_json();
            let _ = app.emit("mutes", json!({"guilds": sj["muted_guilds"], "channels": sj["muted_channels"]}));
        }
        "MESSAGE_UPDATE" => {
            let merged = s.on_update(d);
            if s.active_channel == d["channel_id"].as_str().unwrap_or("") {
                let _ = app.emit("msg-update", merged);
            }
        }
        "MESSAGE_DELETE" => {
            let ch = d["channel_id"].as_str().unwrap_or("").to_string();
            let id = d["id"].as_str().unwrap_or("");
            let logged = s.on_delete(&ch, id);
            if s.active_channel == ch {
                let _ = app.emit("msg-delete", json!({"id": id, "channel_id": ch}));
            }
            if logged.is_some() {
                let _ = app.emit("log-added", s.deleted.len());
            }
        }
        "MESSAGE_DELETE_BULK" => {
            let ch = d["channel_id"].as_str().unwrap_or("").to_string();
            for id in arr(&d["ids"]) {
                let id = id.as_str().unwrap_or("");
                s.on_delete(&ch, id);
                if s.active_channel == ch {
                    let _ = app.emit("msg-delete", json!({"id": id, "channel_id": ch}));
                }
            }
            let _ = app.emit("log-added", s.deleted.len());
        }
        "THREAD_CREATE" | "THREAD_UPDATE" => {
            s.upsert_thread(d);
            guilds_changed = true;
        }
        "THREAD_DELETE" => {
            if let Some(g) = s.guild_mut(d["guild_id"].as_str().unwrap_or("")) {
                g.threads.remove(d["id"].as_str().unwrap_or(""));
                guilds_changed = true;
            }
        }
        "THREAD_LIST_SYNC" => {
            for t in arr(&d["threads"]) {
                let mut t = t.clone();
                t["guild_id"] = d["guild_id"].clone();
                s.upsert_thread(&t);
            }
            guilds_changed = true;
        }
        "GUILD_EMOJIS_UPDATE" => {
            if let Some(g) = s.guild_mut(d["guild_id"].as_str().unwrap_or("")) {
                g.emojis = arr(&d["emojis"]).to_vec();
                guilds_changed = true;
            }
        }
        "MESSAGE_REACTION_ADD" | "MESSAGE_REACTION_REMOVE" => {
            let add = t == "MESSAGE_REACTION_ADD";
            if let Some(m) = s.on_reaction(d, add) {
                if s.active_channel == d["channel_id"].as_str().unwrap_or("") {
                    let _ = app.emit("msg-update", m);
                }
            }
        }
        "MESSAGE_REACTION_REMOVE_ALL" => {
            let ch = d["channel_id"].as_str().unwrap_or("").to_string();
            if let Some(m) = s.clear_reactions(&ch, d["message_id"].as_str().unwrap_or("")) {
                if s.active_channel == ch {
                    let _ = app.emit("msg-update", m);
                }
            }
        }
        "TYPING_START" => {
            if s.active_channel == d["channel_id"].as_str().unwrap_or("") && d["user_id"].as_str() != Some(s.me_id.as_str()) {
                let uid = d["user_id"].as_str().unwrap_or("");
                let user = if d["member"]["user"].is_object() { d["member"]["user"].clone() } else { s.users.get(uid).cloned().unwrap_or(Value::Null) };
                let name = d["member"]["nick"].as_str().map(String::from)
                    .or_else(|| user["global_name"].as_str().or(user["username"].as_str()).map(String::from))
                    .unwrap_or_else(|| "Biri".into());
                let _ = app.emit("typing", json!({"user_id": uid, "name": name}));
            }
        }
        "GUILD_MEMBER_LIST_UPDATE" => {
            let _ = app.emit("member-list", d);
        }
        "VOICE_STATE_UPDATE" => {
            let sum = s.on_voice_state(d);
            let _ = app.emit("voice-state", sum);
            if d["user_id"].as_str() == Some(s.me_id.as_str()) {
                let me = s.me_id.clone();
                drop(s);
                let mut vm = core.voice.lock().unwrap();
                let ch = d["channel_id"].as_str().map(String::from);
                if vm.channel_id.is_some() {
                    match ch {
                        None if vm.session_id.as_deref() == d["session_id"].as_str() || vm.task.is_none() => {
                            // Atildik / baglanti kesildi
                            vm.stop();
                            vm.channel_id = None;
                            let _ = app.emit("voice-status", json!({"state": "disconnected"}));
                        }
                        Some(c) if vm.task.is_none() => {
                            vm.session_id = d["session_id"].as_str().map(String::from);
                            vm.channel_id = Some(c);
                            vm.maybe_start(app, &me, &core.voice_ctl, &core.video);
                        }
                        Some(c) if vm.session_id.as_deref() == d["session_id"].as_str() && vm.channel_id.as_deref() != Some(c.as_str()) => {
                            vm.channel_id = Some(c.clone());
                            let _ = app.emit("voice-moved", json!({"channel_id": c, "guild_id": d["guild_id"]}));
                        }
                        _ => {}
                    }
                }
                return;
            }
        }
        "VOICE_SERVER_UPDATE" => {
            let me = s.me_id.clone();
            drop(s);
            let mut vm = core.voice.lock().unwrap();
            if vm.channel_id.is_some() {
                if let (Some(t), Some(e)) = (d["token"].as_str(), d["endpoint"].as_str()) {
                    // Sunucu degistiyse yeniden baglan
                    if let Some(old) = vm.task.take() {
                        old.abort();
                    }
                    vm.server = Some((t.to_string(), e.to_string()));
                    vm.maybe_start(app, &me, &core.voice_ctl, &core.video);
                }
            }
            return;
        }
        "STREAM_CREATE" | "STREAM_SERVER_UPDATE" => {
            let me = s.me_id.clone();
            drop(s);
            let key = d["stream_key"].as_str().unwrap_or("").to_string();
            let mut vm = core.voice.lock().unwrap();
            let Some(sc) = vm.streams.get_mut(&key) else { return };
            if t == "STREAM_CREATE" {
                sc.rtc_server_id = d["rtc_server_id"].as_str().map(String::from);
                let _ = app.emit("stream-viewers", json!({"key": key, "viewer_ids": d["viewer_ids"]}));
            } else if let (Some(tk), Some(ep)) = (d["token"].as_str(), d["endpoint"].as_str()) {
                if let Some(old) = sc.task.take() {
                    old.abort();
                }
                sc.server = Some((tk.to_string(), ep.to_string()));
            }
            vm.maybe_start_stream(&key, app, &me, &core.voice_ctl, &core.video);
            return;
        }
        "STREAM_UPDATE" => {
            let _ = app.emit("stream-viewers", json!({"key": d["stream_key"], "viewer_ids": d["viewer_ids"]}));
        }
        "STREAM_DELETE" => {
            drop(s);
            let key = d["stream_key"].as_str().unwrap_or("").to_string();
            core.voice.lock().unwrap().stop_stream(&key);
            let _ = app.emit("stream-status", json!({"key": key, "state": "ended", "detail": d["reason"]}));
            return;
        }
        "CALL_CREATE" | "CALL_UPDATE" => {
            let ch = d["channel_id"].as_str().unwrap_or("").to_string();
            let ringing = arr(&d["ringing"]).iter().any(|u| u.as_str() == Some(s.me_id.as_str()));
            for vs in arr(&d["voice_states"]) {
                let sum = s.on_voice_state(vs);
                let _ = app.emit("voice-state", sum);
            }
            if ringing {
                let (_, _, name) = s.names(&ch);
                let _ = app.emit("incoming-call", json!({"channel_id": ch, "name": name}));
            } else {
                let _ = app.emit("call-stop-ringing", json!({"channel_id": ch}));
            }
        }
        "CALL_DELETE" => {
            let _ = app.emit("call-stop-ringing", json!({"channel_id": d["channel_id"]}));
        }
        _ => {}
    }
    drop(s);
    if guilds_changed {
        let _ = app.emit("guilds-changed", ());
    }
}

/// READY'de rol bilgisi gelmeyen sunucular icin kendi uyeligimizi cek.
async fn fetch_my_roles(app: AppHandle, core: CoreRef, token: String, me: String, ids: Vec<String>) {
    for (i, gid) in ids.iter().enumerate() {
        if let Ok(m) = core.api.get(&token, &format!("/guilds/{gid}/members/{me}")).await {
            let roles: Vec<String> = arr(&m["roles"]).iter().filter_map(|r| r.as_str().map(String::from)).collect();
            let mut s = core.store.lock().unwrap();
            if let Some(g) = s.guild_mut(gid) {
                g.my_roles = roles;
                g.members_known = true;
            }
            drop(s);
        }
        if i % 5 == 4 || i == ids.len() - 1 {
            let _ = app.emit("guilds-changed", ());
        }
        tokio::time::sleep(Duration::from_millis(400)).await;
    }
}
