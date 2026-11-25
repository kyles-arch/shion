//! Bellek ici durum: sunucular, kanallar, mesaj onbellegi ve silinen mesaj kaydi.

use crate::perms;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet, VecDeque};

const MAX_PER_CHANNEL: usize = 1000;
const MAX_LOG: usize = 1500;

pub fn sf(s: &str) -> u64 {
    s.parse().unwrap_or(0)
}
fn sfv(v: &Value) -> u64 {
    sf(v.as_str().unwrap_or("0"))
}
fn st(v: &Value) -> String {
    v.as_str().unwrap_or("").to_string()
}
/// Kullanıcıyı küçült ama Discord koleksiyonlarını (avatar süsü, klan etiketi, isim plakası) koru.
pub fn slim_user(u: &Value) -> Value {
    let mut o = json!({"id": u["id"], "username": u["username"], "global_name": u["global_name"], "avatar": u["avatar"]});
    for k in ["avatar_decoration_data", "primary_guild", "clan", "collectibles", "display_name_styles", "bot"] {
        if !u[k].is_null() {
            o[k] = u[k].clone();
        }
    }
    o
}

pub fn arr(v: &Value) -> &[Value] {
    v.as_array().map(|a| a.as_slice()).unwrap_or(&[])
}
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Default)]
pub struct Guild {
    pub id: String,
    pub name: String,
    pub icon: Value,
    pub owner_id: String,
    pub roles: HashMap<String, Value>,
    pub channels: HashMap<String, Value>,
    pub threads: HashMap<String, Value>,
    pub emojis: Vec<Value>,
    pub stickers: Vec<Value>,
    /// user_id -> ses durumu
    pub voice_states: HashMap<String, Value>,
    pub my_roles: Vec<String>,
    pub members_known: bool,
    /// kullanici id -> sunucu takma adi
    pub nicks: HashMap<String, String>,
    /// kullanici id -> sunucudaki rol id'leri (mesaj yazarlari icin rol rengi)
    pub member_roles: HashMap<String, Vec<String>>,
    /// Planlanmis etkinlikler
    pub events: Vec<Value>,
    /// Ses tahtasi sesleri
    pub sounds: Vec<Value>,
    /// Sunucu bilgi karti icin ozet (uye sayisi, takviye, ozellikler...)
    pub meta: Value,
}

#[derive(Default)]
pub struct Store {
    pub token: String,
    pub me: Value,
    pub me_id: String,
    pub guilds: Vec<Guild>,
    pub dms: HashMap<String, Value>,
    pub users: HashMap<String, Value>,
    pub messages: HashMap<String, Vec<Value>>,
    pub deleted: VecDeque<Value>,
    pub active_channel: String,
    /// Discord'daki sunucu klasorleri (varsa)
    pub folders: Value,
    /// kanal -> (son okunan mesaj id, etiket sayisi)
    pub read_states: HashMap<String, (String, i64)>,
    /// kullanici id -> {id, type, user, nickname}  (1 arkadas, 2 engelli, 3 gelen, 4 giden istek)
    pub relationships: HashMap<String, Value>,
    /// kullanici id -> {status, activities}
    pub presences: HashMap<String, Value>,
    pub muted_guilds: HashSet<String>,
    pub muted_channels: HashSet<String>,
    /// silinen mesaj kaydi diske yazilmayi bekliyor
    pub deleted_dirty: bool,
    /// gateway oturum kimligi (slash komutlari icin)
    pub gw_session: String,
    /// Anahtar kelime bildirimleri (kucuk harf)
    pub keywords: Vec<String>,
    /// Kanal id -> bilinen gercek ad (Discord gizli kanal adlarini artik "___hidden___" olarak gonderiyor)
    pub known_names: HashMap<String, String>,
    pub known_names_dirty: bool,
    /// Bilgisi istenmis (op 8) kullanicilar; tekrar istememek icin
    pub requested_users: HashSet<String>,
    /// Kullanici notlari (id -> not)
    pub notes: HashMap<String, String>,
    /// Son READY'nin teshis ozeti
    pub diag: Value,
}

/// Discord tarafindan adi gizlenmis kanal mi?
pub fn is_redacted(c: &Value) -> bool {
    c["name"].as_str().map_or(false, |n| n.starts_with("___") && n.contains("hidden"))
}

impl Store {
    /// READY icindeki okuma durumlari, iliskiler, durumlar ve bildirim ayarlari.
    pub fn load_social(&mut self, d: &Value) {
        let rs = if d["read_state"]["entries"].is_array() { &d["read_state"]["entries"] } else { &d["read_state"] };
        for e in arr(rs) {
            if e["read_state_type"].as_i64().unwrap_or(0) != 0 {
                continue;
            }
            let last = e["last_message_id"].as_str().map(String::from).unwrap_or_else(|| e["last_message_id"].as_u64().map(|n| n.to_string()).unwrap_or_default());
            self.read_states.insert(st(&e["id"]), (last, e["mention_count"].as_i64().unwrap_or(0)));
        }
        for r in arr(&d["relationships"]) {
            self.on_relationship(r);
        }
        let pres = if d["merged_presences"]["friends"].is_array() { &d["merged_presences"]["friends"] } else { &d["presences"] };
        for p in arr(pres) {
            self.on_presence(p);
        }
        let ugs = if d["user_guild_settings"]["entries"].is_array() { &d["user_guild_settings"]["entries"] } else { &d["user_guild_settings"] };
        for e in arr(ugs) {
            self.on_guild_settings(e);
        }
    }

    pub fn on_relationship(&mut self, r: &Value) {
        let id = st(&r["id"]);
        if id.is_empty() {
            return;
        }
        let user = if r["user"].is_object() {
            self.cache_user(&r["user"]);
            r["user"].clone()
        } else {
            self.users.get(r["user_id"].as_str().unwrap_or(&id)).cloned().unwrap_or(json!({"id": id}))
        };
        let user = slim_user(&user);
        self.relationships.insert(id.clone(), json!({"id": id, "type": r["type"], "nickname": r["nickname"], "user": user}));
    }

    /// Sadece arkadas/DM kullanicilarinin durumunu tutar; degistiyse true.
    pub fn on_presence(&mut self, p: &Value) -> bool {
        let id = p["user"]["id"].as_str().or(p["user_id"].as_str()).unwrap_or("").to_string();
        if id.is_empty() || (!p["guild_id"].is_null() && !self.relationships.contains_key(&id)) {
            return false;
        }
        let v = json!({"status": p["status"], "activities": p["activities"], "client_status": p["client_status"]});
        if self.presences.get(&id) == Some(&v) {
            return false;
        }
        self.presences.insert(id, v);
        true
    }

    pub fn on_guild_settings(&mut self, e: &Value) {
        let gid = e["guild_id"].as_str().unwrap_or("@me").to_string();
        if e["muted"] == true {
            self.muted_guilds.insert(gid);
        } else {
            self.muted_guilds.remove(&gid);
        }
        for o in arr(&e["channel_overrides"]) {
            let cid = st(&o["channel_id"]);
            if o["muted"] == true {
                self.muted_channels.insert(cid);
            } else {
                self.muted_channels.remove(&cid);
            }
        }
    }

    pub fn set_read(&mut self, ch: &str, msg: &str) {
        let e = self.read_states.entry(ch.to_string()).or_insert((String::new(), 0));
        if sf(msg) >= sf(&e.0) {
            e.0 = msg.to_string();
            e.1 = 0;
        }
    }

    pub fn social_json(&self) -> Value {
        let rs: Map<String, Value> = self.read_states.iter().map(|(k, (l, m))| (k.clone(), json!({"last": l, "mentions": m}))).collect();
        let mut friends: Vec<Value> = self
            .relationships
            .values()
            .map(|r| {
                let mut r = r.clone();
                let id = st(&r["id"]);
                r["presence"] = self.presences.get(&id).cloned().unwrap_or(json!({"status": "offline"}));
                r
            })
            .collect();
        friends.sort_by_key(|r| r["user"]["global_name"].as_str().or(r["user"]["username"].as_str()).unwrap_or("").to_lowercase());
        json!({
            "read_states": rs, "friends": friends,
            "muted_guilds": self.muted_guilds.iter().collect::<Vec<_>>(),
            "muted_channels": self.muted_channels.iter().collect::<Vec<_>>()
        })
    }

    pub fn set_me(&mut self, me: Value) {
        self.me_id = st(&me["id"]);
        self.me = me;
    }

    pub fn guild(&self, id: &str) -> Option<&Guild> {
        self.guilds.iter().find(|g| g.id == id)
    }
    pub fn guild_mut(&mut self, id: &str) -> Option<&mut Guild> {
        self.guilds.iter_mut().find(|g| g.id == id)
    }

    pub fn cache_user(&mut self, u: &Value) {
        if let Some(id) = u["id"].as_str() {
            self.users.insert(id.to_string(), u.clone());
        }
    }

    /// Kanal adini ogren (gizlenmemisse) ya da daha once bilinen adla doldur.
    pub fn learn_channel(&mut self, c: &mut Value) {
        let id = st(&c["id"]);
        if id.is_empty() {
            return;
        }
        if is_redacted(c) {
            c["redacted"] = json!(true);
            c["name"] = json!(self.known_names.get(&id).cloned().unwrap_or_else(|| "gizli-kanal".into()));
        } else if let Some(n) = c["name"].as_str() {
            if self.known_names.get(&id).map(|x| x.as_str()) != Some(n) {
                self.known_names.insert(id, n.to_string());
                self.known_names_dirty = true;
            }
        }
    }

    /// Sunucu uyesini (kullanici + takma ad) onbellege al.
    pub fn cache_member(&mut self, gid: &str, m: &Value) {
        let uid = m["user"]["id"].as_str().or(m["user_id"].as_str()).unwrap_or("").to_string();
        if uid.is_empty() {
            return;
        }
        if m["user"].is_object() {
            self.cache_user(&m["user"]);
        }
        if let Some(g) = self.guild_mut(gid) {
            if let Some(rs) = m["roles"].as_array() {
                g.member_roles.insert(uid.clone(), rs.iter().filter_map(|r| r.as_str().map(String::from)).collect());
            }
            match m["nick"].as_str() {
                Some(n) => {
                    g.nicks.insert(uid, n.to_string());
                }
                None => {
                    g.nicks.remove(&uid);
                }
            }
        }
    }

    /// Bilinen uye rollerini dondur; bilinmeyen ve henuz istenmemis olanlari (op 8 icin) ayir.
    pub fn member_roles_of(&mut self, gid: &str, ids: &[String]) -> (Map<String, Value>, Vec<String>) {
        let mut known = Map::new();
        let mut missing = vec![];
        let Some(g) = self.guild(gid) else { return (known, missing) };
        for id in ids.iter().take(200) {
            match g.member_roles.get(id) {
                Some(r) => {
                    known.insert(id.clone(), json!(r));
                }
                None => missing.push(id.clone()),
            }
        }
        missing.retain(|id| self.requested_users.insert(format!("{gid}:{id}")));
        (known, missing)
    }

    /// Ses kanalinda olup bilgisi bilinmeyen kullanicilar (henuz istenmemis olanlar).
    pub fn take_missing_voice_users(&mut self, gid: &str) -> Vec<String> {
        let Some(g) = self.guild(gid) else { return vec![] };
        let ids: Vec<String> = g
            .voice_states
            .iter()
            .filter(|(uid, v)| !v["member"]["user"].is_object() && !self.users.contains_key(*uid) && !self.requested_users.contains(*uid))
            .map(|(uid, _)| uid.clone())
            .collect();
        for id in &ids {
            self.requested_users.insert(id.clone());
        }
        ids
    }

    pub fn load_guild<'a>(&mut self, g: &'a Value, member: Option<&'a Value>) {
        if g["unavailable"].as_bool() == Some(true) {
            return;
        }
        let props = if g["properties"].is_object() { &g["properties"] } else { g };
        let id = st(&g["id"]);
        let mut guild = Guild {
            id: id.clone(),
            name: st(&props["name"]),
            icon: props["icon"].clone(),
            owner_id: st(&props["owner_id"]),
            ..Default::default()
        };
        for r in arr(&g["roles"]) {
            guild.roles.insert(st(&r["id"]), r.clone());
        }
        for c in arr(&g["channels"]) {
            let mut c = c.clone();
            c["guild_id"] = json!(id);
            self.learn_channel(&mut c);
            guild.channels.insert(st(&c["id"]), c);
        }
        for t in arr(&g["threads"]) {
            let mut t = t.clone();
            t["guild_id"] = json!(id);
            guild.threads.insert(st(&t["id"]), t);
        }
        guild.emojis = arr(&g["emojis"]).to_vec();
        guild.events = arr(&g["guild_scheduled_events"]).to_vec();
        let pick = |k: &str| if props[k].is_null() { g[k].clone() } else { props[k].clone() };
        guild.meta = json!({
            "member_count": g["member_count"], "joined_at": g["joined_at"],
            "premium_tier": pick("premium_tier"), "boosts": pick("premium_subscription_count"),
            "description": pick("description"), "vanity": pick("vanity_url_code"), "features": pick("features"),
            "banner": pick("banner"), "verification_level": pick("verification_level"), "locale": pick("preferred_locale"),
            "max_members": pick("max_members"), "nsfw_level": pick("nsfw_level")
        });
        guild.sounds = arr(&g["soundboard_sounds"]).to_vec();
        guild.stickers = arr(&g["stickers"]).to_vec();
        for vs in arr(&g["voice_states"]) {
            if vs["channel_id"].is_string() {
                guild.voice_states.insert(st(&vs["user_id"]), vs.clone());
            }
        }
        let me = self.me_id.clone();
        let member = member.or_else(|| {
            arr(&g["members"]).iter().find(|m| {
                m["user"]["id"].as_str() == Some(me.as_str()) || m["user_id"].as_str() == Some(me.as_str())
            })
        });
        if let Some(m) = member {
            guild.my_roles = arr(&m["roles"]).iter().map(st).collect();
            guild.members_known = true;
        } else if let Some(old) = self.guild(&id) {
            if old.members_known {
                guild.my_roles = old.my_roles.clone();
                guild.members_known = true;
            }
        }
        if guild.owner_id == me {
            guild.members_known = true;
        }
        if let Some(old) = self.guild(&id) {
            guild.nicks = old.nicks.clone();
        }
        match self.guilds.iter().position(|x| x.id == id) {
            Some(i) => self.guilds[i] = guild,
            None => self.guilds.push(guild),
        }
        // Discord artik kullanicilari READY'nin ust "users" listesinde degil, sunucunun "members" listesinde veriyor.
        for m in arr(&g["members"]) {
            self.cache_member(&id, m);
        }
    }

    pub fn add_dm(&mut self, pc: &Value) {
        let mut c = pc.clone();
        if !c["recipients"].is_array() {
            let rec: Vec<Value> = arr(&pc["recipient_ids"])
                .iter()
                .filter_map(|id| id.as_str().and_then(|i| self.users.get(i)).cloned())
                .collect();
            c["recipients"] = json!(rec);
        }
        for u in arr(&c["recipients"]).to_vec() {
            self.cache_user(&u);
        }
        self.dms.insert(st(&c["id"]), c);
    }

    pub fn guild_summaries(&self) -> Vec<Value> {
        self.guilds
            .iter()
            .map(|g| {
                let base = perms::base(g, &self.me_id);
                let mut chans: Vec<Value> = g
                    .channels
                    .values()
                    .map(|c| {
                        let p = perms::channel(g, c, &self.me_id, base);
                        json!({
                            "id": c["id"], "name": c["name"], "type": c["type"],
                            "parent_id": c["parent_id"], "position": c["position"],
                            "topic": c["topic"], "nsfw": c["nsfw"], "redacted": c["redacted"] == true,
                            "last_message_id": c["last_message_id"],
                            "hidden": g.members_known && p & perms::VIEW == 0,
                            "can_send": p & perms::SEND != 0,
                            "manage": p & perms::MANAGE_MESSAGES != 0,
                            "invite": p & perms::CREATE_INVITE != 0
                        })
                    })
                    .collect();
                chans.sort_by_key(|c| (c["position"].as_i64().unwrap_or(0), sfv(&c["id"])));
                let roles: Map<String, Value> = g
                    .roles
                    .values()
                    .map(|r| (st(&r["id"]), json!({"name": r["name"], "color": r["color"], "colors": r["colors"], "position": r["position"], "permissions": r["permissions"], "icon": r["icon"], "unicode_emoji": r["unicode_emoji"], "hoist": r["hoist"], "managed": r["managed"]})))
                    .collect();
                let threads: Vec<Value> = g
                    .threads
                    .values()
                    .filter(|t| t["thread_metadata"]["archived"] != true)
                    .map(|t| json!({"id": t["id"], "name": t["name"], "type": t["type"], "parent_id": t["parent_id"], "last_message_id": t["last_message_id"]}))
                    .collect();
                let emojis: Vec<Value> = g
                    .emojis
                    .iter()
                    .filter(|e| e["available"] != false)
                    .map(|e| json!({"id": e["id"], "name": e["name"], "animated": e["animated"]}))
                    .collect();
                let stickers: Vec<Value> = g
                    .stickers
                    .iter()
                    .filter(|e| e["available"] != false)
                    .map(|e| json!({"id": e["id"], "name": e["name"], "format_type": e["format_type"]}))
                    .collect();
                let voice: Vec<Value> = g.voice_states.values().map(|v| self.voice_summary(v)).collect();
                let sounds: Vec<Value> = g
                    .sounds
                    .iter()
                    .filter(|x| x["available"] != false)
                    .map(|x| json!({"sound_id": x["sound_id"], "name": x["name"], "emoji_name": x["emoji_name"], "emoji_id": x["emoji_id"], "volume": x["volume"]}))
                    .collect();
                let my_top = g.my_roles.iter().filter_map(|r| g.roles.get(r)).map(|r| r["position"].as_i64().unwrap_or(0)).max().unwrap_or(0);
                json!({"id": g.id, "name": g.name, "icon": g.icon, "perms": base.to_string(), "owner": g.owner_id == self.me_id, "owner_id": g.owner_id, "my_top": my_top, "channels": chans, "roles": roles, "threads": threads, "emojis": emojis, "stickers": stickers, "voice_states": voice, "sounds": sounds, "events": g.events.len(), "meta": g.meta})
            })
            .collect()
    }

    pub fn dm_list(&self) -> Vec<Value> {
        let mut list: Vec<&Value> = self.dms.values().collect();
        list.sort_by_key(|c| std::cmp::Reverse(sfv(&c["last_message_id"])));
        list.iter()
            .map(|c| {
                let rec: Vec<Value> = arr(&c["recipients"])
                    .iter()
                    .map(slim_user)
                    .collect();
                json!({"id": c["id"], "type": c["type"], "name": c["name"], "icon": c["icon"], "recipients": rec, "last_message_id": c["last_message_id"]})
            })
            .collect()
    }

    pub fn put_messages(&mut self, ch: &str, list: Vec<Value>) {
        for m in &list {
            self.cache_user(&m["author"]);
        }
        let v = self.messages.entry(ch.to_string()).or_default();
        for mut m in list {
            let id = sfv(&m["id"]);
            match v.binary_search_by_key(&id, |x| sfv(&x["id"])) {
                Ok(i) => {
                    for k in ["_deleted", "_edits"] {
                        if !v[i][k].is_null() {
                            m[k] = v[i][k].clone();
                        }
                    }
                    v[i] = m;
                }
                Err(i) => v.insert(i, m),
            }
        }
        if v.len() > MAX_PER_CHANNEL {
            let n = v.len() - MAX_PER_CHANNEL;
            v.drain(0..n);
        }
    }

    /// `before` verilmezse son 120 mesaj, verilirse ondan onceki 120 mesaj.
    pub fn slice(&self, ch: &str, before: Option<&str>) -> Vec<Value> {
        let Some(v) = self.messages.get(ch) else { return vec![] };
        let end = match before {
            Some(b) => {
                let b = sf(b);
                v.partition_point(|x| sfv(&x["id"]) < b)
            }
            None => v.len(),
        };
        v[end.saturating_sub(120)..end].to_vec()
    }

    pub fn touch_last(&mut self, ch: &str, id: &Value) {
        if let Some(d) = self.dms.get_mut(ch) {
            d["last_message_id"] = id.clone();
            return;
        }
        for g in self.guilds.iter_mut() {
            if let Some(c) = g.channels.get_mut(ch) {
                c["last_message_id"] = id.clone();
                return;
            }
        }
    }

    pub fn on_update(&mut self, m: &Value) -> Value {
        let ch = st(&m["channel_id"]);
        let id = sfv(&m["id"]);
        if let Some(v) = self.messages.get_mut(&ch) {
            if let Ok(i) = v.binary_search_by_key(&id, |x| sfv(&x["id"])) {
                let old = &mut v[i];
                if let Some(newc) = m["content"].as_str() {
                    let oldc = old["content"].as_str().unwrap_or("").to_string();
                    if newc != oldc {
                        let time = if old["edited_timestamp"].is_null() {
                            old["timestamp"].clone()
                        } else {
                            old["edited_timestamp"].clone()
                        };
                        if !old["_edits"].is_array() {
                            old["_edits"] = json!([]);
                        }
                        if let Some(a) = old["_edits"].as_array_mut() {
                            a.push(json!({"content": oldc, "time": time}));
                        }
                    }
                }
                if let (Some(o), Some(n)) = (old.as_object_mut(), m.as_object()) {
                    for (k, val) in n {
                        o.insert(k.clone(), val.clone());
                    }
                }
                return old.clone();
            }
        }
        m.clone()
    }

    pub fn on_delete(&mut self, ch: &str, id: &str) -> Option<Value> {
        let v = self.messages.get_mut(ch)?;
        let i = v.binary_search_by_key(&sf(id), |x| sfv(&x["id"])).ok()?;
        if v[i]["_deleted"] == true {
            return None;
        }
        v[i]["_deleted"] = json!(true);
        let m = v[i].clone();
        let (guild_id, guild_name, channel_name) = self.names(ch);
        self.deleted.push_front(json!({
            "message": m, "guild_id": guild_id, "guild_name": guild_name,
            "channel_name": channel_name, "deleted_at": now_ms()
        }));
        self.deleted.truncate(MAX_LOG);
        self.deleted_dirty = true;
        Some(m)
    }

    /// (guild_id, sunucu adi, kanal adi)
    pub fn names(&self, ch: &str) -> (Value, String, String) {
        for g in &self.guilds {
            if let Some(c) = g.channels.get(ch).or_else(|| g.threads.get(ch)) {
                return (json!(g.id), g.name.clone(), format!("#{}", st(&c["name"])));
            }
        }
        if let Some(d) = self.dms.get(ch) {
            let name = d["name"].as_str().map(String::from).unwrap_or_else(|| {
                arr(&d["recipients"])
                    .iter()
                    .map(|u| u["global_name"].as_str().or(u["username"].as_str()).unwrap_or("?").to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            });
            return (Value::Null, "Direkt Mesaj".into(), name);
        }
        (Value::Null, "?".into(), "?".into())
    }

    pub fn is_guild_channel(&self, ch: &str) -> bool {
        self.guilds.iter().any(|g| g.channels.contains_key(ch) || g.threads.contains_key(ch))
    }

    /// Arayuz icin sade ses durumu (kullanici bilgisiyle).
    pub fn voice_summary(&self, v: &Value) -> Value {
        let uid = st(&v["user_id"]);
        let user = if v["member"]["user"].is_object() {
            v["member"]["user"].clone()
        } else {
            self.users.get(&uid).cloned().unwrap_or(json!({"id": uid}))
        };
        let nick = if v["member"].is_object() {
            v["member"]["nick"].clone()
        } else {
            v["guild_id"].as_str().and_then(|g| self.guild(g)).and_then(|g| g.nicks.get(&uid)).map(|n| json!(n)).unwrap_or(Value::Null)
        };
        json!({
            "user_id": uid, "channel_id": v["channel_id"], "guild_id": v["guild_id"],
            "nick": nick, "user": slim_user(&user),
            "self_mute": v["self_mute"], "self_deaf": v["self_deaf"], "mute": v["mute"], "deaf": v["deaf"],
            "self_video": v["self_video"], "self_stream": v["self_stream"]
        })
    }

    /// VOICE_STATE_UPDATE isle; arayuze gidecek sade durumu dondurur (onceki kanal dahil).
    pub fn on_voice_state(&mut self, v: &Value) -> Value {
        if v["member"].is_object() {
            if let Some(gid) = v["guild_id"].as_str() {
                self.cache_member(gid, &v["member"]);
            }
        }
        let uid = st(&v["user_id"]);
        let mut prev = Value::Null;
        if let Some(gid) = v["guild_id"].as_str() {
            if let Some(g) = self.guild_mut(gid) {
                prev = g.voice_states.get(&uid).map(|o| o["channel_id"].clone()).unwrap_or(Value::Null);
                if v["channel_id"].is_string() {
                    g.voice_states.insert(uid, v.clone());
                } else {
                    g.voice_states.remove(&uid);
                }
            }
        }
        let mut sum = self.voice_summary(v);
        sum["prev_channel_id"] = prev;
        sum
    }

    /// Uygulamanin gordugu verinin saglik ozeti (teshis ekrani icin; token icermez).
    pub fn diagnostics(&self) -> Value {
        let mut channels = 0;
        let mut redacted = 0;
        let mut hidden_known = 0;
        let mut voice = 0;
        let mut voice_unknown = 0;
        let mut no_roles = 0;
        for g in &self.guilds {
            channels += g.channels.len();
            redacted += g.channels.values().filter(|c| c["redacted"] == true).count();
            hidden_known += g.channels.values().filter(|c| c["redacted"] == true && self.known_names.contains_key(&st(&c["id"]))).count();
            voice += g.voice_states.len();
            voice_unknown += g.voice_states.iter().filter(|(u, v)| !v["member"]["user"].is_object() && !self.users.contains_key(*u)).count();
            if !g.members_known {
                no_roles += 1;
            }
        }
        json!({
            "guilds": self.guilds.len(), "channels": channels, "redacted": redacted, "redacted_named": hidden_known,
            "voice_users": voice, "voice_unknown": voice_unknown, "guilds_without_roles": no_roles,
            "users_cached": self.users.len(), "dms": self.dms.len(), "friends": self.relationships.len(),
            "known_names": self.known_names.len(), "notes": self.notes.len(), "ready": self.diag
        })
    }

    /// Etkinlik olusturma/guncelleme/silme.
    pub fn on_event(&mut self, ev: &Value, delete: bool) {
        let Some(g) = self.guild_mut(ev["guild_id"].as_str().unwrap_or("")) else { return };
        g.events.retain(|e| e["id"] != ev["id"]);
        if !delete {
            g.events.push(ev.clone());
        }
    }

    /// Ses tahtasi sesi ekleme/guncelleme/silme.
    pub fn on_sound(&mut self, snd: &Value, delete: bool) -> bool {
        let Some(g) = self.guild_mut(snd["guild_id"].as_str().unwrap_or("")) else { return false };
        g.sounds.retain(|e| e["sound_id"] != snd["sound_id"]);
        if !delete {
            g.sounds.push(snd.clone());
        }
        true
    }

    /// Mesaj icerigi kayitli anahtar kelimelerden birini iceriyorsa onu dondurur.
    pub fn keyword_hit(&self, content: &str) -> Option<String> {
        if self.keywords.is_empty() || content.is_empty() {
            return None;
        }
        let low = content.to_lowercase();
        self.keywords.iter().find(|k| {
            // kelime siniri: harf/rakam ile cevrili degilse
            low.match_indices(k.as_str()).any(|(i, _)| {
                let before = low[..i].chars().next_back();
                let after = low[i + k.len()..].chars().next();
                !before.map_or(false, |c| c.is_alphanumeric()) && !after.map_or(false, |c| c.is_alphanumeric())
            })
        }).cloned()
    }

    pub fn upsert_thread(&mut self, t: &Value) {
        if let Some(g) = self.guild_mut(t["guild_id"].as_str().unwrap_or("")) {
            let id = st(&t["id"]);
            match g.threads.get_mut(&id) {
                Some(old) => {
                    if let (Some(o), Some(n)) = (old.as_object_mut(), t.as_object()) {
                        for (k, v) in n {
                            o.insert(k.clone(), v.clone());
                        }
                    }
                }
                None => {
                    g.threads.insert(id, t.clone());
                }
            }
        }
    }

    /// Tepki ekle/kaldir; guncel mesaji dondurur (onbellekteyse).
    pub fn on_reaction(&mut self, d: &Value, add: bool) -> Option<Value> {
        let me = self.me_id.clone();
        let v = self.messages.get_mut(d["channel_id"].as_str()?)?;
        let i = v.binary_search_by_key(&sfv(&d["message_id"]), |x| sfv(&x["id"])).ok()?;
        let m = &mut v[i];
        if !m["reactions"].is_array() {
            m["reactions"] = json!([]);
        }
        let mine = d["user_id"].as_str() == Some(me.as_str());
        let same = |r: &Value| match d["emoji"]["id"].as_str() {
            Some(id) => r["emoji"]["id"].as_str() == Some(id),
            None => r["emoji"]["id"].is_null() && r["emoji"]["name"] == d["emoji"]["name"],
        };
        let list = m["reactions"].as_array_mut()?;
        match list.iter().position(|r| same(r)) {
            Some(j) => {
                let c = list[j]["count"].as_i64().unwrap_or(1) + if add { 1 } else { -1 };
                if c <= 0 {
                    list.remove(j);
                } else {
                    list[j]["count"] = json!(c);
                    if mine {
                        list[j]["me"] = json!(add);
                    }
                }
            }
            None if add => list.push(json!({"emoji": d["emoji"], "count": 1, "me": mine})),
            None => {}
        }
        Some(m.clone())
    }

    /// Anket oyu ekle/kaldir; guncel mesaji dondurur.
    pub fn on_poll_vote(&mut self, d: &Value, add: bool) -> Option<Value> {
        let me = self.me_id.clone();
        let v = self.messages.get_mut(d["channel_id"].as_str()?)?;
        let i = v.binary_search_by_key(&sfv(&d["message_id"]), |x| sfv(&x["id"])).ok()?;
        let m = &mut v[i];
        if !m["poll"].is_object() {
            return None;
        }
        if !m["poll"]["results"]["answer_counts"].is_array() {
            m["poll"]["results"] = json!({"is_finalized": false, "answer_counts": []});
        }
        let aid = d["answer_id"].as_u64()?;
        let mine = d["user_id"].as_str() == Some(me.as_str());
        let list = m["poll"]["results"]["answer_counts"].as_array_mut()?;
        match list.iter().position(|c| c["id"].as_u64() == Some(aid)) {
            Some(j) => {
                let c = list[j]["count"].as_i64().unwrap_or(0) + if add { 1 } else { -1 };
                list[j]["count"] = json!(c.max(0));
                if mine {
                    list[j]["me_voted"] = json!(add);
                }
            }
            None if add => list.push(json!({"id": aid, "count": 1, "me_voted": mine})),
            None => {}
        }
        Some(m.clone())
    }

    pub fn clear_reactions(&mut self, ch: &str, id: &str) -> Option<Value> {
        let v = self.messages.get_mut(ch)?;
        let i = v.binary_search_by_key(&sf(id), |x| sfv(&x["id"])).ok()?;
        v[i]["reactions"] = json!([]);
        Some(v[i].clone())
    }

    pub fn channel_info(&self, gid: &str, cid: &str) -> Option<Value> {
        let g = self.guild(gid)?;
        let c = g.channels.get(cid)?;
        let overwrites: Vec<Value> = arr(&c["permission_overwrites"])
            .iter()
            .map(|o| {
                let id = st(&o["id"]);
                let member = perms::is_member_ow(o);
                let (name, color, pos) = if member {
                    let n = self
                        .users
                        .get(&id)
                        .and_then(|u| u["global_name"].as_str().or(u["username"].as_str()).map(String::from))
                        .unwrap_or_else(|| format!("Uye {id}"));
                    (n, json!(0), json!(-1))
                } else if id == g.id {
                    ("@everyone".to_string(), json!(0), json!(0))
                } else {
                    g.roles
                        .get(&id)
                        .map(|r| (st(&r["name"]), r["color"].clone(), r["position"].clone()))
                        .unwrap_or_else(|| (format!("Rol {id}"), json!(0), json!(0)))
                };
                let (allow, deny) = (perms::p(&o["allow"]), perms::p(&o["deny"]));
                let view = if allow & perms::VIEW != 0 { "allow" } else if deny & perms::VIEW != 0 { "deny" } else { "neutral" };
                json!({"id": id, "kind": if member {"member"} else {"role"}, "name": name, "color": color, "position": pos, "view": view})
            })
            .collect();
        let parent = c["parent_id"].as_str().and_then(|p| g.channels.get(p)).map(|p| p["name"].clone());
        Some(json!({
            "id": c["id"], "name": c["name"], "topic": c["topic"], "type": c["type"], "nsfw": c["nsfw"],
            "last_message_id": c["last_message_id"], "rate_limit_per_user": c["rate_limit_per_user"],
            "parent_name": parent, "guild_name": g.name, "overwrites": overwrites
        }))
    }
}

#[cfg(test)]
mod collectible_tests {
    use super::*;
    #[test]
    fn member_roles_cached_and_requested_once() {
        let mut s = Store::default();
        s.load_guild(&json!({"id": "g", "name": "G", "roles": [{"id": "r1", "name": "Mod", "color": 255, "colors": {"primary_color": 255, "secondary_color": 16711680}, "position": 2, "permissions": "8"}], "channels": []}), None);
        s.cache_member("g", &json!({"user": {"id": "u1", "username": "a"}, "roles": ["r1"], "nick": "Ali"}));
        let ids = vec!["u1".to_string(), "u2".to_string()];
        let (known, missing) = s.member_roles_of("g", &ids);
        assert_eq!(known["u1"], json!(["r1"]));
        assert_eq!(missing, vec!["u2".to_string()]);
        let (_, again) = s.member_roles_of("g", &ids);
        assert!(again.is_empty(), "ayni uye iki kez istenmemeli");
        let g = s.guild("g").unwrap();
        assert_eq!(g.roles["r1"]["colors"]["secondary_color"], json!(16711680));
    }

    #[test]
    fn slim_user_keeps_collectibles() {
        let u = json!({"id": "1", "username": "a", "email": "x", "avatar_decoration_data": {"asset": "a_1"}, "primary_guild": {"tag": "SHN"}, "collectibles": null});
        let s = slim_user(&u);
        assert_eq!(s["avatar_decoration_data"]["asset"], "a_1");
        assert_eq!(s["primary_guild"]["tag"], "SHN");
        assert!(s.get("email").is_none() && s.get("collectibles").is_none());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msg(id: &str, content: &str) -> Value {
        json!({"id": id, "channel_id": "c1", "content": content, "author": {"id": "u1", "username": "a"}, "timestamp": "2026-01-01T00:00:00Z"})
    }

    #[test]
    fn messages_stay_sorted_and_deduplicated() {
        let mut s = Store::default();
        s.put_messages("c1", vec![msg("30", "c"), msg("10", "a")]);
        s.put_messages("c1", vec![msg("20", "b"), msg("10", "a2")]);
        let ids: Vec<_> = s.messages["c1"].iter().map(|m| m["id"].as_str().unwrap().to_string()).collect();
        assert_eq!(ids, ["10", "20", "30"]);
        assert_eq!(s.messages["c1"][0]["content"], "a2");
        assert_eq!(s.slice("c1", Some("30")).len(), 2);
    }

    #[test]
    fn edit_history_is_kept() {
        let mut s = Store::default();
        s.put_messages("c1", vec![msg("10", "ilk")]);
        let m = s.on_update(&json!({"id": "10", "channel_id": "c1", "content": "ikinci", "edited_timestamp": "x"}));
        assert_eq!(m["content"], "ikinci");
        assert_eq!(m["_edits"][0]["content"], "ilk");
        // Sadece embed guncellemesi (content yok) gecmise eklenmemeli
        let m = s.on_update(&json!({"id": "10", "channel_id": "c1", "embeds": []}));
        assert_eq!(m["_edits"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn deleted_message_is_logged_and_survives_refetch() {
        let mut s = Store::default();
        s.put_messages("c1", vec![msg("10", "gizli sir")]);
        let d = s.on_delete("c1", "10").expect("loglanmali");
        assert_eq!(d["_deleted"], true);
        assert_eq!(s.deleted.len(), 1);
        assert_eq!(s.deleted[0]["message"]["content"], "gizli sir");
        // Ayni silme ikinci kez loglanmaz
        assert!(s.on_delete("c1", "10").is_none());
        // API'den tekrar cekilince silindi isareti korunur
        s.put_messages("c1", vec![msg("10", "gizli sir")]);
        assert_eq!(s.messages["c1"][0]["_deleted"], true);
        // Onbellekte olmayan mesaj
        assert!(s.on_delete("c1", "999").is_none());
    }

    #[test]
    fn reactions_add_and_remove() {
        let mut s = Store::default();
        s.me_id = "me".into();
        s.put_messages("c1", vec![msg("10", "x")]);
        let ev = |u: &str| json!({"channel_id": "c1", "message_id": "10", "user_id": u, "emoji": {"id": null, "name": "🔥"}});
        s.on_reaction(&ev("me"), true);
        let m = s.on_reaction(&ev("o"), true).unwrap();
        assert_eq!(m["reactions"][0]["count"], 2);
        assert_eq!(m["reactions"][0]["me"], true);
        s.on_reaction(&ev("me"), false);
        let m = s.on_reaction(&ev("o"), false).unwrap();
        assert!(m["reactions"].as_array().unwrap().is_empty());
    }

    #[test]
    fn voice_states_follow_events() {
        let mut s = Store::default();
        s.load_guild(&json!({"id": "g", "name": "G", "roles": [], "channels": [], "voice_states": [{"user_id": "u", "channel_id": "v"}]}), None);
        assert_eq!(s.guild("g").unwrap().voice_states.len(), 1);
        s.on_voice_state(&json!({"guild_id": "g", "user_id": "u", "channel_id": null}));
        assert!(s.guild("g").unwrap().voice_states.is_empty());
    }

    #[test]
    fn new_ready_format_members_and_redacted_names() {
        let mut s = Store::default();
        s.known_names.insert("c2".into(), "eski-ad".into());
        let g = json!({"id": "g", "name": "G", "roles": [], "channels": [
            {"id": "c1", "name": "genel", "type": 0},
            {"id": "c2", "name": "___hidden___", "type": 0, "flags": 131072},
            {"id": "c3", "name": "___hidden___", "type": 2}],
            "members": [{"user": {"id": "u1", "username": "ali", "global_name": "Ali"}, "nick": "Kaptan", "roles": []}],
            "voice_states": [{"user_id": "u1", "channel_id": "c1"}, {"user_id": "u2", "channel_id": "c1"}]});
        s.load_guild(&g, None);
        let sum = s.guild_summaries();
        let ch = sum[0]["channels"].as_array().unwrap();
        let by = |id: &str| ch.iter().find(|c| c["id"] == id).unwrap().clone();
        assert_eq!(by("c1")["name"], "genel");
        assert_eq!(by("c2")["name"], "eski-ad");
        assert_eq!(by("c2")["redacted"], true);
        assert_eq!(by("c3")["name"], "gizli-kanal");
        assert_eq!(s.known_names["c1"], "genel");
        // ses durumunda member yok: kullanici ve takma ad members listesinden gelir
        let v = s.voice_summary(&json!({"guild_id": "g", "user_id": "u1", "channel_id": "c1"}));
        assert_eq!(v["user"]["global_name"], "Ali");
        assert_eq!(v["nick"], "Kaptan");
        // u2 bilinmiyor: bir kez istenir
        assert_eq!(s.take_missing_voice_users("g"), vec!["u2".to_string()]);
        assert!(s.take_missing_voice_users("g").is_empty());
    }

    #[test]
    fn events_sounds_and_diagnostics() {
        let mut s = Store::default();
        s.load_guild(&json!({"id": "g", "name": "G", "roles": [], "channels": [{"id": "c", "name": "___hidden___", "type": 0}],
            "guild_scheduled_events": [{"id": "e1", "guild_id": "g", "name": "Turnuva"}],
            "soundboard_sounds": [{"sound_id": "s1", "guild_id": "g", "name": "boom", "available": true}, {"sound_id": "s2", "name": "x", "available": false}],
            "voice_states": [{"user_id": "u9", "channel_id": "c"}]}), None);
        let sum = s.guild_summaries();
        assert_eq!(sum[0]["events"], 1);
        assert_eq!(sum[0]["sounds"].as_array().unwrap().len(), 1);
        s.on_event(&json!({"id": "e2", "guild_id": "g", "name": "Film"}), false);
        s.on_event(&json!({"id": "e1", "guild_id": "g"}), true);
        assert_eq!(s.guild("g").unwrap().events.len(), 1);
        assert!(s.on_sound(&json!({"sound_id": "s3", "guild_id": "g", "name": "yeni"}), false));
        assert_eq!(s.guild("g").unwrap().sounds.len(), 3);
        let d = s.diagnostics();
        assert_eq!(d["redacted"], 1);
        assert_eq!(d["voice_unknown"], 1);
    }

    #[test]
    fn keyword_matching_word_boundary() {
        let mut s = Store::default();
        s.keywords = vec!["shion".into(), "maç".into()];
        assert_eq!(s.keyword_hit("Shion çok iyi"), Some("shion".into()));
        assert_eq!(s.keyword_hit("akşam MAÇ var mı?"), Some("maç".into()));
        assert_eq!(s.keyword_hit("shionlar"), None);
        assert_eq!(s.keyword_hit("hiçbir şey"), None);
        let v = s.on_voice_state(&json!({"user_id": "5", "guild_id": "g", "channel_id": "c1"}));
        assert!(v["prev_channel_id"].is_null());
    }

    #[test]
    fn poll_votes_update_counts() {
        let mut s = Store::default();
        s.me_id = "me".into();
        let mut m = msg("10", "");
        m["poll"] = json!({"question": {"text": "?"}, "answers": [{"answer_id": 1}, {"answer_id": 2}]});
        s.put_messages("c1", vec![m]);
        let ev = |u: &str, a: u64| json!({"channel_id": "c1", "message_id": "10", "user_id": u, "answer_id": a});
        s.on_poll_vote(&ev("me", 1), true);
        let m = s.on_poll_vote(&ev("x", 1), true).unwrap();
        assert_eq!(m["poll"]["results"]["answer_counts"][0]["count"], 2);
        assert_eq!(m["poll"]["results"]["answer_counts"][0]["me_voted"], true);
        let m = s.on_poll_vote(&ev("me", 1), false).unwrap();
        assert_eq!(m["poll"]["results"]["answer_counts"][0]["count"], 1);
        assert_eq!(m["poll"]["results"]["answer_counts"][0]["me_voted"], false);
    }

    #[test]
    fn social_state_from_ready() {
        let mut s = Store::default();
        s.load_social(&json!({
            "read_state": {"entries": [{"id": "c1", "last_message_id": "50", "mention_count": 2}, {"id": "x", "read_state_type": 1, "last_message_id": "1"}]},
            "relationships": [{"id": "u1", "type": 1, "user": {"id": "u1", "username": "ali"}}, {"id": "u2", "type": 3, "user": {"id": "u2", "username": "veli"}}],
            "presences": [{"user": {"id": "u1"}, "status": "online", "activities": []}],
            "user_guild_settings": {"entries": [{"guild_id": "g", "muted": true, "channel_overrides": [{"channel_id": "c9", "muted": true}]}]}
        }));
        assert_eq!(s.read_states["c1"], ("50".to_string(), 2));
        assert!(!s.read_states.contains_key("x"));
        let j = s.social_json();
        assert_eq!(j["friends"][0]["presence"]["status"], "online");
        assert_eq!(j["friends"][1]["presence"]["status"], "offline");
        assert!(s.muted_guilds.contains("g") && s.muted_channels.contains("c9"));
        // Okundu isaretleme geri gitmez, etiketleri sifirlar
        s.set_read("c1", "40");
        assert_eq!(s.read_states["c1"].0, "50");
        s.set_read("c1", "60");
        assert_eq!(s.read_states["c1"], ("60".to_string(), 0));
        // Sunucu kaynakli yabanci presence tutulmaz
        assert!(!s.on_presence(&json!({"user": {"id": "zz"}, "guild_id": "g", "status": "idle"})));
        s.on_guild_settings(&json!({"guild_id": "g", "muted": false, "channel_overrides": []}));
        assert!(!s.muted_guilds.contains("g"));
    }

    #[test]
    fn hidden_flag_in_summary() {
        let mut s = Store::default();
        s.set_me(json!({"id": "me"}));
        s.load_guild(&json!({
            "id": "g", "name": "G", "owner_id": "x",
            "roles": [{"id": "g", "permissions": "3072"}],
            "channels": [
                {"id": "a", "name": "acik", "type": 0, "permission_overwrites": []},
                {"id": "b", "name": "gizli", "type": 0, "permission_overwrites": [{"id": "g", "type": 0, "allow": "0", "deny": "1024"}]}
            ],
            "members": [{"user": {"id": "me"}, "roles": []}]
        }), None);
        let sum = s.guild_summaries();
        let ch = sum[0]["channels"].as_array().unwrap();
        let hidden = |n: &str| ch.iter().find(|c| c["name"] == n).unwrap()["hidden"].as_bool().unwrap();
        assert!(!hidden("acik"));
        assert!(hidden("gizli"));
    }
}
