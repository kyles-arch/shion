// Sahte Tauri arka ucu: arayuzu Discord'a baglanmadan test etmek icin.
// Testlerden olay gondermek: window.__mock.emit("msg-create", {...})
(() => {
  const listeners = new Map();
  const calls = [];
  let sf = 1300000000000000000n;
  const id = () => String((sf += 4194304n * 1000n));
  const me = { id: "100", username: "shion", global_name: "Shion", avatar: null };
  const users = Array.from({ length: 8 }, (_, i) => ({ id: String(200 + i), username: "kisi" + i, global_name: ["Ayşe", "Mehmet", "Deniz", "Can", "Elif", "Bora", "Zeynep", "Kaan"][i], avatar: null }));

  const ch = (name, type = 0, extra = {}) => ({ id: id(), name, type, parent_id: null, position: 0, topic: null, hidden: false, can_send: true, last_message_id: null, ...extra });
  function guild(name, chans) {
    const gid = id();
    const cat = ch("Genel", 4);
    const list = [cat, ...chans.map((c, i) => ({ ...c, parent_id: cat.id, position: i }))];
    return { id: gid, name, icon: null, channels: list, roles: { [gid]: { name: "@everyone", color: 0, position: 0 } }, threads: [], emojis: [], voice_states: [] };
  }
  const guilds = [
    guild("Valorant Türkiye", [ch("sohbet"), ch("takım-arıyorum"), ch("ranked-lobi", 2), ch("klipler")]),
    guild("Minecraft Survival SMP", [ch("genel"), ch("sunucu-ip"), ch("yapılar"), ch("ses", 2)]),
    guild("Rust Programlama", [ch("genel"), ch("yardım"), ch("kod-paylaşım"), ch("github")]),
    guild("Lo-fi Müzik Kafesi", [ch("sohbet"), ch("şarkı-önerileri"), ch("dinleme-odası", 2)]),
    guild("Anime & Manga Kulübü", [ch("genel"), ch("one-piece"), ch("waifu-tartışma"), ch("seasonal-anime")]),
    guild("YKS Hazırlık 2027", [ch("genel"), ch("matematik"), ch("ders-çalışma", 2), ch("deneme-sonuçları")]),
    guild("Kripto Sinyal", [ch("btc"), ch("altcoin"), ch("trading-sohbet")]),
    guild("Çizim ve Sanat", [ch("eserler"), ch("çizim-yardım"), ch("commission")]),
    guild("kanka grubu", [ch("genel"), ch("muhabbet", 2)]),
    guild("Midjourney", [ch("announcements"), ch("newbies-1"), ch("prompt-chat")]),
    guild("CS2 Esports Hub", [ch("maç-sohbet"), ch("faceit"), ch("takım", 2)]),
    guild("Python Türkiye", [ch("genel"), ch("django"), ch("yardım-kanalı")]),
  ];
  // Emoji / cikartma (FakeNitro testleri)
  guilds[0].emojis = [{ id: "7001", name: "valo", animated: false }];
  guilds[1].emojis = [{ id: "7002", name: "kedi", animated: false }, { id: "7003", name: "dans", animated: true }];
  guilds[1].stickers = [{ id: "8001", name: "selam", format_type: 1 }, { id: "8002", name: "lottie", format_type: 3 }];
  guilds[0].stickers = [{ id: "8003", name: "gg", format_type: 4 }];
  const accounts = [{ id: "100", username: "shion", global_name: "Shion", avatar: null }, { id: "555", username: "yanhesap", global_name: "Yan", avatar: null }];
  // Valorant: yonetici yetkisi + roller (moderasyon testleri)
  Object.assign(guilds[0], { perms: "8", my_top: 10, owner: false });
  Object.assign(guilds[0].roles, { r1: { name: "Kurucu", color: 15158332, position: 20 }, r2: { name: "Yetkili", color: 3447003, position: 5 }, r3: { name: "Üye", color: 0, position: 1 } });
  for (const g of guilds) for (const c of g.channels) Object.assign(c, { manage: g === guilds[0], invite: true });
  // Gizli kanal + ses durumu ornekleri
  guilds[0].channels.push(ch("yetkili-odası", 0, { hidden: true, parent_id: guilds[0].channels[0].id }));
  guilds[0].voice_states = [{ user_id: "201", channel_id: guilds[0].channels.find((c) => c.type === 2).id, guild_id: guilds[0].id, user: users[1], self_mute: true }];

  const dms = users.slice(0, 5).map((u) => ({ id: id(), type: 1, name: null, icon: null, recipients: [u], last_message_id: null }));
  const msgs = new Map();
  // Okunmamis: Rust Programlama #genel ve ilk DM okunmamis (+1 etiket), Kripto sessizde
  const rust = guilds[2], kripto = guilds[6];
  rust.channels[1].last_message_id = id();
  dms[0].last_message_id = id();
  const read_states = {};
  for (const g of guilds) for (const c of g.channels) read_states[c.id] = { last: c.last_message_id || "0", mentions: 0 };
  for (const d of dms) read_states[d.id] = { last: d.last_message_id || "0", mentions: 0 };
  read_states[rust.channels[1].id] = { last: "1", mentions: 0 };
  read_states[dms[0].id] = { last: "1", mentions: 1 };
  kripto.channels[1].last_message_id = id(); read_states[kripto.channels[1].id] = { last: "1", mentions: 0 };
  const friends = [
    { id: "200", type: 1, user: users[0], presence: { status: "online", activities: [{ type: 0, name: "Valorant" }] } },
    { id: "201", type: 1, user: users[1], presence: { status: "idle", activities: [{ type: 4, state: "kahve molası", emoji: { name: "☕" } }] } },
    { id: "202", type: 1, user: users[2], presence: { status: "offline" } },
    { id: "203", type: 3, user: users[3], presence: { status: "offline" } },
    { id: "204", type: 4, user: users[4], presence: { status: "offline" } },
    { id: "205", type: 2, user: users[5], presence: { status: "offline" } },
  ];
  function makeMsgs(chId, n = 60) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const u = i % 4 === 0 ? me : users[i % users.length];
      out.push({ id: id(), channel_id: chId, author: u, content: i % 7 === 0 ? "Uzun bir mesaj **kalın** _italik_ `kod` https://example.com\nikinci satır" : "mesaj " + i, timestamp: new Date(Date.now() - (n - i) * 60000).toISOString(), edited_timestamp: null, attachments: [], embeds: [], mentions: [], type: 0, reactions: i === n - 2 ? [{ emoji: { id: null, name: "🔥" }, count: 3, me: true }] : [] });
    }
    return out;
  }
  const handlers = {
    saved_token: () => "test-token",
    login: () => { setTimeout(() => emit("gw-ready", null), 150); setTimeout(() => emit("gw-status", "connected"), 100); return me; },
    logout: () => null,
    get_state: () => ({ me, guilds, dms, log_count: 2, folders: null, read_states, friends, muted_guilds: [kripto.id], muted_channels: [] }),
    ack: ({ channelId, messageId }) => { read_states[channelId] = { last: messageId, mentions: 0 }; return null; },
    set_mute: () => null,
    relationship_action: ({ userId, action }) => {
      const f = friends.find((x) => x.id === userId);
      if (action === "accept" && f) f.type = 1; else { const i = friends.indexOf(f); if (i >= 0) friends.splice(i, 1); }
      setTimeout(() => emit("friends", structuredClone(friends)), 20); return null;
    },
    add_friend: ({ username }) => { if (username === "yok") throw "Böyle bir kullanıcı yok"; friends.push({ id: "299", type: 4, user: { id: "299", username, global_name: null, avatar: null }, presence: { status: "offline" } }); setTimeout(() => emit("friends", structuredClone(friends)), 20); return null; },
    search: ({ query, channelId, guildId }) => {
      const pool = [...msgs.values()].flat().filter((m) => (m.content || "").includes(query));
      return { total_results: pool.length, messages: pool.slice(0, 25).map((m) => [{ ...m, hit: true }]) };
    },
    pins: ({ channelId }) => (msgs.get(channelId) || []).slice(0, 2),
    translate: ({ text, target }) => ({ text: "[" + target + "] " + text, from: "en" }),
    gifs: ({ query }) => Array.from({ length: 6 }, (_, i) => ({ url: "https://tenor.com/view/test-" + (query || "trend") + "-" + i, src: "data:video/mp4;base64,", width: 200, height: 150 })),
    video_subscribe: () => null, video_frame: () => null, set_video: () => null, stream_active: () => null, watch_stream: () => null, stop_stream: () => null,
    start_stream: () => { const key = 'guild:' + guilds[0].id + ':' + guilds[0].channels.find((c) => c.type === 2).id + ':100'; setTimeout(() => emit('stream-status', { key, sending: true, state: 'connected', detail: { e2ee: true } }), 50); return key; },
    invite_info: ({ code }) => { if (code === "yok") throw "404 Unknown Invite"; return { code, guild: { id: "999" + code.length, name: "Test Sunucusu", icon: null }, approximate_member_count: 1234, approximate_presence_count: 321 }; },
    join_invite: ({ code }) => { if (code === "captcha") throw "captcha"; return { guild: { id: "999" } }; },
    create_invite: () => ({ code: "abc123" }), leave_guild: () => null,
    app_commands: () => ({ applications: [{ id: "a1", name: "MüzikBot", icon: null }], application_commands: [
      { id: "c1", application_id: "a1", version: "7", name: "play", description: "Şarkı çal", type: 1, options: [{ type: 3, name: "sarki", description: "", required: true }, { type: 4, name: "ses", description: "" }] },
      { id: "c2", application_id: "a1", version: "7", name: "queue", description: "Kuyruk", type: 1, options: [{ type: 1, name: "show", description: "Göster", options: [] }, { type: 1, name: "clear", description: "Temizle", options: [] }] },
    ] }),
    run_command: () => "nonce-1", poll_vote: () => null, end_poll: () => null, voice_message: () => null, stream_audio: () => null,
    member_info: () => ({ roles: ["r3"], nick: null }), mod_action: () => null,
    list_accounts: () => accounts.map((a) => ({ ...a, current: a.id === me.id })),
    switch_account: ({ id }) => { if (!accounts.some((a) => a.id === id)) throw "Hesap bulunamadi"; return null; },
    add_account: () => null,
    remove_account: ({ id }) => { const i = accounts.findIndex((a) => a.id === id); if (i >= 0) accounts.splice(i, 1); return null; },
    app_version: () => "0.2.0", check_update: () => window.__mockUpdate || null,
    install_update: async () => { emit("update-progress", { got: 512, total: 1024 }); return null; },
    system_audio: () => null, set_user_volume: () => null,
    mic_test: ({ on }) => { clearInterval(window.__micT); if (on) window.__micT = setInterval(() => emit("mic-level", { rms: 0.05, speaking: true }), 60); return null; },
    set_noise: () => null, set_keywords: () => null, set_game_detect: () => null, cancel_export: () => null,
    load_cache: () => window.__mockCache || null, save_cache: () => null,
    diagnostics: () => ({ version: "0.2.1", gateway: true, guilds: 12, channels: 50, redacted: 4, redacted_named: 1, voice_users: 3, voice_unknown: 0, guilds_without_roles: 0, users_cached: 9, dms: 2, friends: 3, known_names: 40, notes: 1, ready: { keys: 45, missing: [], legacy_users: false, api_version: 9 } }),
    mentions_inbox: ({ before }) => before ? [] : [{ id: id(), channel_id: guilds[0].channels[1].id, guild_id: guilds[0].id, author: users[0], content: "<@100> bakar mısın", timestamp: new Date().toISOString(), mentions: [me], attachments: [], embeds: [] }],
    forward_message: () => null, mark_unread: () => null,
    get_note: ({ userId }) => (window.__notes ||= {})[userId] || "", set_note: ({ userId, note }) => { (window.__notes ||= {})[userId] = note; return null; },
    send_sound: () => null, default_sounds: () => [{ sound_id: "1", name: "quack", emoji_name: "🦆", volume: 1 }, { sound_id: "2", name: "airhorn", emoji_name: "📯", volume: 1 }],
    guild_events: () => [{ id: "e1", name: "Turnuva gecesi", status: 1, scheduled_start_time: new Date(Date.now() + 86400000).toISOString(), description: "**Ödüllü**", user_count: 12, entity_metadata: { location: "Discord" } }],
    set_auto_idle: () => null,
    save_text: (a) => "C:/Users/test/Downloads/Shion/" + a.name,
    profile_effects: () => ({ profile_effect_configs: [{ id: "1139323098643333937", title: "Kar", reducedMotionSrc: "https://cdn.discordapp.com/assets/profile_effects/static.png", effects: [{ src: "https://cdn.discordapp.com/assets/profile_effects/kar.png", width: 450, height: 880, position: { x: 0, y: 0 }, zIndex: 2 }, { src: "https://evil.example/x.png", width: 10 }] }] }), set_custom_rpc: () => null,
    fetch_message: ({ messageId }) => ({ id: messageId, channel_id: "x", author: users[2], content: "bağlantılı **mesaj**", timestamp: new Date().toISOString(), attachments: [], embeds: [] }),
    reaction_users: () => [users[0], users[1]],
    clone_emoji: ({ name }) => ({ id: "999", name }),
    export_channel: async ({ name, format }) => { for (const n of [100, 200, 237]) { await new Promise((r) => setTimeout(r, 20)); emit("export-progress", n); } return "C:\\Users\\x\\Downloads\\Shion\\" + name + "." + format; },
    save_media: ({ url, name }) => { if (!/^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(url)) throw "Sadece Discord CDN"; return "C:\\Users\\x\\Downloads\\Shion\\" + name; },
    set_ptt: () => null, set_tray: () => null, get_autostart: () => false, set_autostart: ({ enabled }) => enabled,
    set_active_channel: () => null,
    get_messages: ({ channelId, before, around }) => {
      if (!msgs.has(channelId)) msgs.set(channelId, makeMsgs(channelId));
      const all = msgs.get(channelId);
      if (around) { const i = all.findIndex((m) => m.id === around); return all.slice(Math.max(0, i - 25), i + 25); }
      if (!before) return all;
      return []; // daha eski yok
    },
    send_message: ({ channelId, content, poll }) => {
      if (!msgs.has(channelId)) msgs.set(channelId, makeMsgs(channelId));
      const m = { id: id(), channel_id: channelId, author: me, content, timestamp: new Date().toISOString(), attachments: [], embeds: [], mentions: [], type: 0, ...(poll ? { poll } : {}) };
      msgs.get(channelId)?.push(m);
      setTimeout(() => emit("msg-create", m), 30);
      return m;
    },
    deleted_log: () => [], clear_deleted_log: () => null,
    channel_info: ({ channelId }) => ({ id: channelId, name: "yetkili-odası", topic: "Sadece yetkililer", type: 0, overwrites: [{ id: "1", kind: "role", name: "Yetkili", color: 15158332, view: "allow" }], guild_name: "Valorant Türkiye" }),
    voice_devices: () => ({ inputs: ["Mikrofon (Test)"], outputs: ["Hoparlör (Test)"] }),
    get_profile: ({ userId, guildId }) => ({ user: userId === me.id ? me : users[0], user_profile: { bio: "Merhaba! **Shion** kullanıyorum", pronouns: "o", accent_color: 7105791, banner: "abc" }, premium_since: "2023-05-01T10:00:00Z", badges: [{ id: "hypesquad", description: "HypeSquad Bravery", icon: "8a88d63823d8a71cd5e390baa45efa02" }], connected_accounts: [{ type: "steam", name: "oyuncu42", verified: true }], ...(guildId ? { guild_member: { joined_at: "2024-02-03T12:00:00Z" } } : {}) }),
    update_profile: (a) => ({ ok: true, ...a }),
  };
  function emit(name, payload) { (listeners.get(name) || []).forEach((cb) => cb({ event: name, payload })); }
  window.__mock = { emit, calls, guilds, dms, me, users, msgs, friends, read_states };
  window.__TAURI__ = {
    // Gercek IPC gibi her zaman kopya dondur (paylasilan referans testleri yaniltir)
    core: { Channel: class { constructor() { this.onmessage = null; } }, invoke: async (cmd, args = {}, opts) => { calls.push([cmd, args, opts]); const f = handlers[cmd]; const r = f ? await f(args) : null; return r == null ? r : structuredClone(r); } },
    event: { listen: async (name, cb) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(cb); return () => {}; } },
    opener: { openUrl: (u) => calls.push(["openUrl", u]) },
    notification: { isPermissionGranted: async () => true, requestPermission: async () => "granted", sendNotification: (n) => calls.push(["notify", n]) },
  };
})();
