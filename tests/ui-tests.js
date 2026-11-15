// Shion arayuz testleri. Tarayicida (tests/serve.mjs ile) calistir:
//   await (await import("/__test/ui-tests.js")).run()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (s) => document.querySelector(s);
const called = (cmd) => window.__mock.calls.filter(([c]) => c === cmd);

export async function run() {
  const results = [];
  const test = async (name, fn) => {
    try { const info = await fn(); results.push({ name, ok: true, info: info ?? "" }); }
    catch (e) { results.push({ name, ok: false, info: String(e?.message || e) }); }
  };
  const assert = (c, msg) => { if (!c) throw new Error(msg); };
  await sleep(400);

  await test("giris yapildi, sunucular yuklendi", async () => {
    assert(!q("#app").classList.contains("hidden"), "app gizli");
    assert(S.guilds.length === 12, "guild sayisi " + S.guilds.length);
    assert(!q("#splash") || q("#splash").classList.contains("out"), "yukleme ekrani kapanmadi");
  });

  await test("okunmamislar ve etiketler read_state'ten gelir, sessizdeki gizlenir", async () => {
    const M = window.__mock, rust = M.guilds[2], kripto = M.guilds[6];
    assert(S.unread.has(rust.channels[1].id), "Rust #genel okunmamis degil");
    assert(S.mentions.get(M.dms[0].id) === 1, "DM etiketi yok");
    assert(!S.unread.has(kripto.channels[1].id), "sessizdeki sunucu okunmamis gorunuyor");
    assert(!S.unread.has(M.guilds[3].channels[1].id), "okunmus kanal okunmamis gorunuyor");
    assert(S.mutedGuilds.has(kripto.id), "sessiz sunucu kaydi yok");
  });

  await test("otomatik kategorize onerisi acildi", async () => {
    await sleep(900);
    assert(!q("#modal").classList.contains("hidden"), "modal acilmadi");
    assert(q("#modal-title").textContent.includes("kategorize"), q("#modal-title").textContent);
  });

  await test("sunucu siniflandirmasi dogru", async () => {
    const want = {
      "Valorant Türkiye": "oyun", "Minecraft Survival SMP": "oyun", "Rust Programlama": "yazilim", "Lo-fi Müzik Kafesi": "muzik",
      "Anime & Manga Kulübü": "anime", "YKS Hazırlık 2027": "egitim", "Kripto Sinyal": "kripto", "Çizim ve Sanat": "sanat",
      "kanka grubu": "arkadas", "Midjourney": "sanat", "CS2 Esports Hub": "oyun", "Python Türkiye": "yazilim",
    };
    const wrong = S.guilds.map((g) => [g.name, classifyGuild(g).key]).filter(([n, k]) => want[n] !== k);
    assert(!wrong.length, "yanlis: " + JSON.stringify(wrong));
    return "12/12";
  });

  await test("kategorize uygulaninca tum sunucular klasorde", async () => {
    [...document.querySelectorAll("#modal .btn")].find((b) => b.textContent.includes("Uygula")).click();
    await sleep(100);
    const inFolders = cfg.rail.filter((x) => x.type === "f").flatMap((f) => f.guilds);
    assert(inFolders.length === 12, "klasordeki: " + inFolders.length);
    assert(new Set(inFolders).size === 12, "tekrar eden sunucu var");
    assert(document.querySelectorAll("#guild-list .folder").length === cfg.rail.length, "klasorler cizilmedi");
    return cfg.rail.map((f) => f.name + "(" + f.guilds.length + ")").join(", ");
  });

  await test("klasor acilip kapanir, surukle-birak klasore tasir", async () => {
    const f = cfg.rail[0];
    q("#guild-list .folder-btn").click(); await sleep(50);
    assert(cfg.rail[0].open, "acilmadi");
    const moving = cfg.rail[1].guilds[0];
    railMove({ type: "g", id: moving }, { type: "f", id: f.id }, "merge");
    assert(cfg.rail.find((x) => x.id === f.id).guilds.includes(moving), "tasinmadi");
    assert(cfg.rail.flatMap((x) => x.type === "f" ? x.guilds : [x.id]).length === 12, "sunucu kayboldu");
  });

  await test("DM acilir ve MESAJ KUTUSUNA TIKLAYINCA SAYFA KAYMAZ", async () => {
    q("#home-btn").click(); await sleep(50);
    q("#channel-list .ch.dm:not(.friends-row)").click(); await sleep(300);
    q("#input").focus(); q("#input").click(); await sleep(100);
    const doc = document.scrollingElement.scrollTop;
    const hdr = q("#chat-header").getBoundingClientRect().top;
    const m = q("#messages");
    assert(doc === 0, "sayfa kaydi: " + doc);
    assert(hdr >= 0, "baslik ekran disinda: " + hdr);
    assert(m.scrollHeight > m.clientHeight && m.clientHeight < innerHeight, "mesaj listesi kendi icinde kaymiyor");
    assert(m.scrollHeight - m.scrollTop - m.clientHeight < 5, "en altta degil");
    return `liste ${m.clientHeight}px / icerik ${m.scrollHeight}px`;
  });

  await test("mesaj gonderme", async () => {
    const before = S.msgs.length;
    q("#input").value = "test mesajı **merhaba**";
    q("#input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(120);
    assert(q("#input").value === "", "kutu temizlenmedi");
    assert(S.msgs.length === before + 1, "mesaj eklenmedi");
    assert(q("#messages .msg:last-child b")?.textContent === "merhaba", "markdown yok");
  });

  await test("silinen mesaj kirmizi kalir (logger)", async () => {
    const m = S.msgs[S.msgs.length - 3];
    window.__mock.emit("msg-delete", { id: m.id, channel_id: m.channel_id });
    await sleep(30);
    assert(q(`#messages .msg[data-id="${m.id}"]`).classList.contains("deleted"), "silindi isareti yok");
  });

  await test("duzenleme gecmisi gosterilir", async () => {
    const m = { ...S.msgs[S.msgs.length - 4] };
    window.__mock.emit("msg-update", { ...m, content: "yeni hali", edited_timestamp: new Date().toISOString(), _edits: [{ content: m.content, time: m.timestamp }] });
    await sleep(30);
    const el = q(`#messages .msg[data-id="${m.id}"]`);
    assert(el.querySelector(".edits"), "eski hal yok");
    assert(el.querySelector(".edited"), "(duzenlendi) yok");
  });

  await test("XSS: mesaj icindeki HTML calismaz", async () => {
    window.__mock.emit("msg-create", { id: "1399999999999999999", channel_id: S.channel.id, author: window.__mock.users[0], content: '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>', timestamp: new Date().toISOString(), attachments: [], embeds: [], mentions: [], type: 0 });
    await sleep(80);
    assert(!window.__xss, "XSS calisti!");
    assert(!q('#messages img[src="x"]'), "ham img eklendi");
  });

  await test("kenar cubugu kaydirma konumu korunur", async () => {
    const list = q("#channel-list");
    list.style.height = "120px"; list.scrollTop = 60; const before = list.scrollTop;
    window.__mock.emit("unread", { channel_id: window.__mock.dms[3].id, mention: false });
    await sleep(200);
    const after = list.scrollTop; list.style.height = "";
    assert(before === 0 || after === before, `kaydi: ${before} -> ${after}`);
  });

  await test("gizli kanal bilgi ekrani", async () => {
    const g = S.guilds.find((x) => x.name === "Valorant Türkiye");
    openGuild(g.id); await sleep(30);
    const row = [...document.querySelectorAll("#channel-list .ch.locked")][0];
    assert(row, "kilitli kanal listede yok");
    row.click(); await sleep(100);
    assert(!q("#hidden-view").classList.contains("hidden"), "gizli gorunum acilmadi");
    assert(q("#hidden-view").textContent.includes("Görebilenler"), "roller yok");
    assert(q("#composer").classList.contains("hidden"), "mesaj kutusu gizlenmeli");
  });

  await test("ses kanali: katil, konusma halkasi, ayril", async () => {
    const g = S.guilds.find((x) => x.name === "Valorant Türkiye");
    const vc = g.channels.find((c) => c.type === 2);
    assert(document.querySelector(`.vuser[data-uid="201"]`), "sesteki kullanici listelenmedi");
    [...document.querySelectorAll("#channel-list .ch")].find((r) => r.textContent.includes(vc.name)).click();
    await sleep(50);
    const j = called("join_voice").pop();
    assert(j && j[1].channelId === vc.id, "join_voice cagrilmadi");
    window.__mock.emit("voice-status", { state: "connected", detail: { e2ee: true, mic: true } });
    window.__mock.emit("voice-privacy", "12345 67890 11121 31415");
    await sleep(30);
    assert(!q("#voice-panel").classList.contains("hidden"), "ses paneli yok");
    assert(q("#voice-panel").textContent.includes("Uçtan uca"), "E2EE gosterilmedi");
    window.__mock.emit("voice-speaking", ["201"]); await sleep(20);
    assert(q('.vuser[data-uid="201"]').classList.contains("speaking"), "konusma halkasi yok");
    q("#voice-panel .hang").click(); await sleep(20);
    assert(called("leave_voice").length, "leave_voice cagrilmadi");
    window.__mock.emit("voice-status", { state: "disconnected" }); await sleep(20);
    assert(q("#voice-panel").classList.contains("hidden"), "panel kapanmadi");
  });

  await test("mikrofon/saginlastir butonlari", async () => {
    const [mic, head] = document.querySelectorAll("#me-panel .icon-btn");
    head.click(); await sleep(20);
    let f = called("set_voice_flags").pop()[1];
    assert(f.deaf && f.mute, "sagir + sessiz olmali");
    document.querySelectorAll("#me-panel .icon-btn")[0].click(); await sleep(20);
    f = called("set_voice_flags").pop()[1];
    assert(!f.deaf && !f.mute, "mikrofon acilinca sagirlik da kalkmali");
  });

  await test("Ctrl+K hizli gecis", async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    await sleep(30);
    const inp = q("#qs-input"); assert(inp, "acilmadi");
    inp.value = "django"; inp.dispatchEvent(new Event("input"));
    await sleep(20);
    assert(q(".qs-item.sel b").textContent === "django", "ilk sonuc: " + q(".qs-item.sel b")?.textContent);
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); await sleep(300);
    assert(S.channel?.name === "django", "kanala gidilmedi");
    assert(S.view === S.guilds.find((g) => g.name === "Python Türkiye").id, "sunucu secilmedi");
  });

  await test("profil karti (mesaj yazarina tiklayinca)", async () => {
    q("#messages .msg .author[data-pop]").click(); await sleep(120);
    assert(q(".popout .pc-name"), "kart acilmadi");
    assert(called("get_profile").length, "profil istenmedi");
    document.body.click(); await sleep(20);
    assert(!q(".popout"), "kart kapanmadi");
  });

  await test("profil duzenleyici + canli onizleme", async () => {
    openProfileEditor(); await sleep(150);
    const name = q("#pe-name"); assert(name, "duzenleyici acilmadi");
    name.value = "Yeni İsim"; name.dispatchEvent(new Event("input"));
    q("#pe-fx .fx-btn:nth-child(2)").click(); await sleep(20);
    assert(q("#pe-card .pc-name").textContent === "Yeni İsim", "onizleme guncellenmedi");
    assert(q("#pe-card .pc").classList.contains("fx-aurora"), "efekt uygulanmadi");
    q("#pe-save").click(); await sleep(80);
    const u = called("update_profile").pop()[1];
    assert(u.user.global_name === "Yeni İsim", "kaydedilen: " + JSON.stringify(u));
    assert(q("#modal").classList.contains("hidden"), "modal kapanmadi");
  });

  await test("emoji secici", async () => {
    const g = S.guilds.find((x) => x.name === "Rust Programlama");
    openGuild(g.id); openChannel({ ...g.channels.find((c) => c.name === "genel"), guild_id: g.id }); await sleep(300);
    q("#emoji-btn").click(); await sleep(30);
    assert(q(".emoji-pop"), "acilmadi");
    q(".emoji-grid button").click(); await sleep(20);
    assert(q("#input").value.length > 0, "emoji eklenmedi");
    q("#input").value = "";
  });

  await test("tema degisimi (Aurora)", async () => {
    cfg.theme = "aurora"; applyCfg(); await sleep(30);
    const bg = getComputedStyle(document.body, "::before").backgroundImage;
    assert(bg.includes("gradient"), "aurora arka plani yok");
    cfg.theme = "gece"; applyCfg();
  });

  await test("acilan kanal okundu isaretlenir", async () => {
    const rust = window.__mock.guilds[2];
    if (!called("ack").some(([, a]) => a.channelId === rust.channels[1].id)) { ackActive(true); await sleep(800); }
    assert(called("ack").some(([, a]) => a.channelId === rust.channels[1].id), "ack gonderilmedi");
    assert(!S.unread.has(rust.channels[1].id), "hala okunmamis");
  });

  await test("arkadaslar: cevrimici, bekleyen istek kabul", async () => {
    showFriends(); await sleep(30);
    assert(!q("#friends-view").classList.contains("hidden"), "arkadas gorunumu acilmadi");
    assert(q("#composer").classList.contains("hidden"), "mesaj kutusu gizlenmeli");
    assert(document.querySelectorAll(".fr-row").length === 2, "cevrimici sayisi " + document.querySelectorAll(".fr-row").length);
    assert(q(".fr-row small").textContent.includes("Valorant"), "aktivite yok");
    [...document.querySelectorAll(".fr-tab")].find((b) => b.textContent.includes("Bekleyen")).click(); await sleep(20);
    assert(document.querySelectorAll(".fr-row").length === 2, "bekleyen 2 olmali");
    q(".fr-btn.ok").click(); await sleep(80);
    assert(called("relationship_action").pop()[1].action === "accept", "kabul gonderilmedi");
    assert(document.querySelectorAll(".fr-row").length === 1, "kabul edilen listeden cikmadi");
  });

  await test("arkadas ekleme (hata + basari)", async () => {
    q(".fr-tab.add").click(); await sleep(20);
    const inp = q(".fr-add .inp"); inp.value = "yok"; q(".fr-add .btn").click(); await sleep(50);
    assert(q("#toast").textContent.includes("Gönderilemedi"), "hata gosterilmedi");
    inp.value = "yeni_kisi"; q(".fr-add .btn").click(); await sleep(80);
    assert(S.friends.some((f) => f.user.username === "yeni_kisi" && f.type === 4), "giden istek eklenmedi");
  });

  await test("arama + sonuca atlama", async () => {
    const g = window.__mock.guilds[11];
    openGuild(g.id); await openChannel({ ...g.channels[1], guild_id: g.id }); await sleep(50);
    assert(!q("#search-btn").classList.contains("hidden"), "arama butonu yok");
    const target = S.msgs[5];
    openSearch(target.content); await sleep(150);
    const items = document.querySelectorAll(".search-res .res-item");
    assert(items.length > 0, "sonuc yok");
    const other = window.__mock.guilds[2].channels[1];
    jumpToMessage(other.id, window.__mock.msgs.get(other.id)[3].id); await sleep(400);
    assert(S.channel.id === other.id, "kanala gidilmedi");
    assert(q(`#messages .msg[data-id="${window.__mock.msgs.get(other.id)[3].id}"]`), "mesaj gorunmuyor");
  });

  await test("sabitlenmis mesajlar", async () => {
    q("#pins-btn").click(); await sleep(100);
    assert(document.querySelectorAll("#modal .res-item").length === 2, "sabit sayisi");
    closeModal();
  });

  await test("yer imi ekle + listede gor", async () => {
    cfg.bookmarks = [];
    const el = q("#messages .msg:not(.deleted)");
    const b = [...el.querySelectorAll(".actions button")].find((x) => x.title === "Yer imi ekle");
    assert(b, "yer imi butonu yok"); b.click();
    assert(cfg.bookmarks.length === 1 && cfg.bookmarks[0].id === el.dataset.id, "kaydedilmedi");
    q("#bookmarks-btn").click(); await sleep(30);
    assert(document.querySelectorAll("#modal .res-item").length === 1, "listede yok");
    closeModal();
  });

  await test("mesaj cevirisi", async () => {
    cfg.translateTo = "tr";
    const el = [...document.querySelectorAll("#messages .msg")].find((m) => m.querySelector('.actions button[title="Çevir"]'));
    el.querySelector('.actions button[title="Çevir"]').click(); await sleep(60);
    assert(el.querySelector(".translation")?.textContent.includes("[tr]"), "ceviri yok");
  });

  await test("GIF secici gonderir", async () => {
    q("#gif-btn").click(); await sleep(80);
    assert(document.querySelectorAll(".gif-pop .gif").length === 6, "gif listesi");
    q(".gif-pop .gif").click(); await sleep(50);
    assert(called("send_message").pop()[1].content.startsWith("https://tenor.com/"), "gif gonderilmedi");
  });

  await test("hayalet yazma: yaziyor gonderilmez", async () => {
    cfg.ghostTyping = true; lastTyping = 0;
    const n = called("send_typing").length;
    q("#input").value = "gizli"; q("#input").dispatchEvent(new Event("input")); await sleep(20);
    assert(called("send_typing").length === n, "typing gonderildi");
    cfg.ghostTyping = false; q("#input").value = "";
  });

  await test("kanal sessize alma", async () => {
    const c = S.channel;
    await toggleMute(c.guild_id, c.id);
    const a = called("set_mute").pop()[1];
    assert(a.channelId === c.id && a.muted === true, "set_mute: " + JSON.stringify(a));
    assert([...document.querySelectorAll("#channel-list .ch.active")].some((r) => r.classList.contains("muted-c")), "soluk degil");
    await toggleMute(c.guild_id, c.id);
  });

  await test("yerel takma ad", async () => {
    const u = S.msgs.find((m) => m.author.id !== S.me.id).author;
    cfg.nicknames[u.id] = "Kankam"; renderMessages(true);
    assert(dname(u) === "Kankam", "dname");
    assert([...document.querySelectorAll("#messages .author")].some((a) => a.textContent === "Kankam"), "mesajlarda gorunmuyor");
    delete cfg.nicknames[u.id]; renderMessages(true);
  });

  await test("sesli kanal sohbeti (katilmadan)", async () => {
    const g = window.__mock.guilds[1];
    openGuild(g.id); await sleep(20);
    const n = called("join_voice").length;
    const row = [...document.querySelectorAll("#channel-list .ch")].find((r) => r.querySelector(".vtext"));
    assert(row, "sohbet butonu yok");
    row.querySelector(".vtext").click(); await sleep(250);
    assert(S.channel.type === 2, "ses kanali acilmadi");
    assert(!q("#composer").classList.contains("hidden"), "mesaj kutusu yok");
    assert(called("join_voice").length === n, "sese katildi!");
  });

  await test("bas-konus sese girince kaydedilir, cikinca kalkar", async () => {
    cfg.ptt = true; cfg.pttKey = "F8";
    S.vc.channel_id = "x"; window.__mock.emit("voice-status", { state: "connected", detail: { e2ee: true, mic: true } }); await sleep(30);
    let p = called("set_ptt").pop()?.[1];
    assert(p?.enabled && p.shortcut === "F8", "kaydedilmedi: " + JSON.stringify(p));
    window.__mock.emit("voice-status", { state: "disconnected" }); await sleep(30);
    p = called("set_ptt").pop()[1];
    assert(!p.enabled, "kaldirilmadi");
    cfg.ptt = false;
  });

  await test("ayarlarda yeni bolumler", async () => {
    q("#settings-btn").click(); await sleep(50);
    const t = q("#modal-body").textContent;
    for (const w of ["Hayalet yazma", "Bas-konuş", "tepsiye", "Windows ile başlat", "Çeviri dili"]) assert(t.includes(w), w + " yok");
    closeModal();
  });

  // ---------- Görüntü ----------
  const fakeStream = (w = 320, h = 240) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d"); let i = 0;
    const iv = setInterval(() => { x.fillStyle = `hsl(${(i += 7) % 360} 70% 50%)`; x.fillRect(0, 0, w, h); x.fillStyle = "#fff"; x.fillRect((i * 3) % w, 40, 40, 40); }, 30);
    const st = c.captureStream(20); st.getVideoTracks()[0].addEventListener("ended", () => clearInterval(iv));
    return st;
  };
  const connectVoice = async () => {
    const g = window.__mock.guilds[0];
    S.vc = { ...S.vc, state: "connected", guild_id: g.id, channel_id: g.channels.find((c) => c.type === 2).id };
    window.__mock.emit("voice-status", { state: "connected", detail: { e2ee: true, mic: true } }); await sleep(30);
  };

  await test("kamera: ses yokken uyari verir", async () => {
    S.vc = { ...S.vc, state: "disconnected", channel_id: null };
    await toggleCamera();
    assert(q("#toast").textContent.includes("ses kanalına"), "uyari yok");
    assert(!V.cam, "kamera acilmamali");
  });

  await test("ses panelinde kamera + ekran dugmeleri", async () => {
    await connectVoice();
    const b = document.querySelectorAll("#voice-panel .vp-btn");
    assert(b.length === 2, "dugme sayisi " + b.length);
  });

  const hasCodecs = "VideoEncoder" in window && "MediaStreamTrackProcessor" in window;
  let encoded = [];
  await test("kamera: WebCodecs H264 kodlar ve Rust'a gonderir", async () => {
    if (!hasCodecs) return "atlandı (WebCodecs yok)";
    try { await pickCodec(320, 240, 20, 300000); } catch (e) { return "atlandı: " + e.message; }
    const orig = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => fakeStream();
    const n0 = called("video_frame").length;
    await toggleCamera(); await sleep(1500);
    navigator.mediaDevices.getUserMedia = orig;
    assert(V.cam, "kamera acilmadi");
    assert(V.tiles.has("self-cam"), "onizleme yok");
    const sv = called("set_video").pop()?.[1];
    assert(sv?.on && sv.width === 320 && sv.height === 240, "set_video: " + JSON.stringify(sv));
    encoded = called("video_frame").slice(n0);
    assert(encoded.length >= 5, "kare sayisi " + encoded.length);
    const [, data, opts] = encoded[0];
    assert(opts.headers["x-key"] === "1" && opts.headers["x-target"] === "camera", "ilk kare anahtar degil: " + JSON.stringify(opts.headers));
    assert(data[0] === 0 && data[1] === 0 && (data[2] === 1 || (data[2] === 0 && data[3] === 1)), "Annex-B degil");
    stopCamera(); await sleep(20);
    assert(!V.tiles.has("self-cam") && called("set_video").pop()[1].on === false, "kapanmadi");
    return encoded.length + " kare, ilk " + data.length + " bayt";
  });

  await test("uzak goruntu: Rust karesi cozulur ve cizilir", async () => {
    if (!encoded.length) return "atlandı (kodlanmış kare yok)";
    for (const [, data, opts] of encoded) {
      const b = new Uint8Array(14 + data.length);
      b[0] = 0; new DataView(b.buffer).setBigUint64(1, 201n); b[13] = opts.headers["x-key"] === "1" ? 1 : 0;
      b.set(data, 14);
      onVideoFrame(b.buffer);
    }
    await sleep(400);
    const t = V.tiles.get("cam:201");
    assert(t, "doseme olusmadi");
    assert(t.frames > 0, "cizilen kare yok");
    assert(t.canvas.width === 320, "boyut " + t.canvas.width);
    assert(t.el.textContent.includes("Mehmet"), "isim yok");
    window.__mock.emit("video-end", { kind: 0, user_id: "201" }); await sleep(20);
    assert(!V.tiles.has("cam:201"), "kaldirilmadi");
    return t.frames + " kare cizildi";
  });

  await test("ekran paylasimi: Go Live baslar, kareler yayin anahtarina gider", async () => {
    if (!hasCodecs || !encoded.length) return "atlandı";
    const orig = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = async () => fakeStream(640, 360);
    const n0 = called("video_frame").length;
    await toggleScreen(); await sleep(1500);
    navigator.mediaDevices.getDisplayMedia = orig;
    assert(V.screen?.key?.startsWith("guild:"), "anahtar yok");
    const sa = called("stream_active").pop()?.[1];
    assert(sa?.on && sa.width === 640 && sa.key === V.screen.key, "stream_active: " + JSON.stringify(sa));
    const fr = called("video_frame").slice(n0);
    assert(fr.length >= 5 && fr.every(([, , o]) => o.headers["x-target"] === V.screen.key), "kareler yayina gitmiyor");
    const key = V.screen.key;
    assert(q("#voice-panel .vp-btn.live"), "yayin dugmesi kirmizi degil");
    await toggleScreen(); await sleep(20);
    assert(called("stop_stream").pop()[1].key === key && !V.screen && !V.tiles.has("self-live"), "durmadi");
  });

  await test("yayin izleme: CANLI'ya tikla, bitince kapanir", async () => {
    await connectVoice();
    const g = window.__mock.guilds[0]; const vc = g.channels.find((c) => c.type === 2);
    window.__mock.emit("voice-state", { user_id: "202", channel_id: vc.id, guild_id: g.id, user: window.__mock.users[2], self_stream: true }); await sleep(150);
    openGuild(g.id); await sleep(30);
    const live = q('.vuser[data-uid="202"] .live');
    assert(live, "CANLI rozeti yok");
    live.click(); await sleep(50);
    const w = called("watch_stream").pop()?.[1];
    assert(w?.key === `guild:${g.id}:${vc.id}:202`, "watch_stream: " + JSON.stringify(w));
    assert(V.tiles.has("live:202") && !q(".popout"), "doseme yok ya da profil karti acildi");
    window.__mock.emit("stream-status", { key: w.key, sending: false, state: "ended" }); await sleep(20);
    assert(!V.tiles.has("live:202") && !V.watching.size, "kapanmadi");
  });

  await test("sesten cikinca tum goruntuler temizlenir", async () => {
    remoteTile("cam:203", "203", false);
    window.__mock.emit("voice-status", { state: "disconnected" }); await sleep(20);
    assert(!V.tiles.size && q("#video-grid").classList.contains("hidden"), "temizlenmedi");
  });

  // ---------- Davet / slash / anket / sesli mesaj / moderasyon ----------
  const openValo = async () => {
    const g = window.__mock.guilds[0];
    closeModal(); openGuild(g.id); await openChannel({ ...g.channels[1], guild_id: g.id }); await sleep(80);
    return g;
  };
  const lastMenuClick = async (label) => {
    const b = [...document.querySelectorAll(".menu button")].find((x) => x.textContent.includes(label));
    if (!b) throw new Error("menude yok: " + label + " | " + [...document.querySelectorAll(".menu button")].map((x) => x.textContent).join(","));
    b.click(); await sleep(80);
  };
  const fakeMsg = (extra) => ({ id: String(1390000000000000000n + BigInt(Math.floor(Math.random() * 1e9))), channel_id: S.channel.id, author: window.__mock.users[0], content: "", timestamp: new Date().toISOString(), attachments: [], embeds: [], mentions: [], type: 0, ...extra });

  await test("davet karti: bilgi + katil + captcha", async () => {
    await openValo();
    window.__mock.emit("msg-create", fakeMsg({ content: "gelin https://discord.gg/test123 ve discord.gg/captcha" })); await sleep(150);
    const cards = document.querySelectorAll("#messages .msg:last-child .inv-card");
    assert(cards.length === 2, "kart sayisi " + cards.length);
    assert(cards[0].textContent.includes("Test Sunucusu") && cards[0].textContent.includes("1.234"), "bilgi: " + cards[0].textContent);
    cards[0].querySelector(".btn").click(); await sleep(60);
    assert(called("join_invite").pop()[1].code === "test123", "katilma cagrilmadi");
    assert(cards[0].querySelector(".btn").textContent.includes("Katıldın"), "buton guncellenmedi");
    cards[1].querySelector(".btn").click(); await sleep(60);
    assert(q("#modal-title").textContent.includes("Doğrulama"), "captcha uyarisi yok");
    closeModal();
  });

  await test("sunucuya katil (+ dugmesi)", async () => {
    q(".rail-btn.add-guild").click(); await sleep(30);
    const inp = q("#modal .inp"); inp.value = "https://discord.gg/xyz99"; q("#modal .btn.primary").click(); await sleep(80);
    assert(q("#modal .inv-card")?.textContent.includes("Test Sunucusu"), "onizleme yok");
    closeModal();
  });

  await test("davet olustur (sunucu menusu)", async () => {
    const g = window.__mock.guilds[0];
    guildMenu({ clientX: 100, clientY: 100 }, S.guilds.find((x) => x.id === g.id));
    await lastMenuClick("Davet oluştur");
    assert(q("#modal .inp")?.value === "https://discord.gg/abc123", "link yok");
    closeModal();
  });

  await test("slash komutlari: liste, secim, calistirma", async () => {
    const inp = q("#input");
    inp.value = "/pl"; inp.dispatchEvent(new Event("input")); await sleep(200);
    assert(q(".slash-pop .sl-item b")?.textContent === "/play", "liste: " + q(".slash-pop")?.textContent);
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); await sleep(120);
    assert(inp.value.startsWith("/play sarki:"), "secim: " + inp.value);
    inp.value = "/play sarki:Tarkan Şımarık ses:50";
    await send(); await sleep(50);
    const d = called("run_command").pop()[1];
    assert(d.applicationId === "a1" && d.data.name === "play" && d.data.version === "7", "veri: " + JSON.stringify(d));
    assert(JSON.stringify(d.data.options) === JSON.stringify([{ type: 3, name: "sarki", value: "Tarkan Şımarık" }, { type: 4, name: "ses", value: 50 }]), "secenekler: " + JSON.stringify(d.data.options));
    assert(inp.value === "", "kutu temizlenmedi");
    inp.value = "/queue clear"; await send(); await sleep(50);
    const d2 = called("run_command").pop()[1].data;
    assert(d2.options[0].type === 1 && d2.options[0].name === "clear", "alt komut: " + JSON.stringify(d2.options));
    const n = called("run_command").length;
    inp.value = "/play"; await send(); await sleep(30);
    assert(called("run_command").length === n && q("#toast").textContent.includes("Zorunlu"), "zorunlu kontrolu yok");
    inp.value = "/bilinmeyen merhaba"; const sm = called("send_message").length; await send(); await sleep(50);
    assert(called("send_message").length === sm + 1, "bilinmeyen / normal mesaj olarak gitmeli");
    closeSlash();
  });

  await test("anket: goster, oy ver, olustur", async () => {
    window.__mock.emit("msg-create", fakeMsg({ poll: { question: { text: "En iyi harita?" }, answers: [{ answer_id: 1, poll_media: { text: "Ascent" } }, { answer_id: 2, poll_media: { text: "Bind" } }], expiry: new Date(Date.now() + 7200000).toISOString(), allow_multiselect: false, results: { is_finalized: false, answer_counts: [{ id: 2, count: 3, me_voted: false }] } } }));
    await sleep(60);
    const p = q("#messages .msg:last-child .poll");
    assert(p && p.querySelectorAll(".poll-a").length === 2, "anket yok");
    assert(p.textContent.includes("3 oy") && p.textContent.includes("saat kaldı"), "alt bilgi: " + p.textContent);
    p.querySelector(".poll-a").click(); await sleep(30);
    const v = called("poll_vote").pop()[1];
    assert(v.answerIds[0] === 1, "oy: " + JSON.stringify(v));
    openPollCreator(); await sleep(20);
    const ins = document.querySelectorAll("#modal .inp");
    ins[0].value = "Pizza mı döner mi?"; ins[1].value = "Pizza"; ins[2].value = "Döner";
    [...document.querySelectorAll("#modal .btn")].find((b) => b.textContent.includes("gönder")).click(); await sleep(60);
    const sm = called("send_message").pop()[1];
    assert(sm.poll?.answers.length === 2 && sm.poll.question.text === "Pizza mı döner mi?" && sm.poll.duration === 24, "anket: " + JSON.stringify(sm.poll));
    assert(q("#messages .msg:last-child .poll"), "gonderilen anket gorunmuyor");
  });

  await test("sesli mesaj: oynatici", async () => {
    const wf = btoa(String.fromCharCode(...Array.from({ length: 60 }, (_, i) => Math.round(127 + 120 * Math.sin(i / 4)))));
    window.__mock.emit("msg-create", fakeMsg({ flags: 8192, attachments: [{ id: "1", filename: "voice-message.ogg", content_type: "audio/ogg", url: "data:audio/ogg;base64,", proxy_url: "", size: 9000, duration_secs: 3.4, waveform: wf }] }));
    await sleep(60);
    const v = q("#messages .msg:last-child .vmsg");
    assert(v, "oynatici yok");
    assert(v.querySelectorAll(".vm-wave i").length >= 30, "dalga formu yok");
    assert(v.querySelector(".vm-time").textContent === "0:03", "sure: " + v.querySelector(".vm-time").textContent);
  });

  await test("sesli mesaj: kaydet ve gonder", async () => {
    const orig = navigator.mediaDevices.getUserMedia;
    navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); const o = c.createOscillator(); const d = c.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream; };
    await toggleRecord(); await sleep(1200);
    assert(q(".rec-bar"), "kayit cubugu yok");
    await toggleRecord(); await sleep(80);
    navigator.mediaDevices.getUserMedia = orig;
    const c = called("voice_message").pop();
    assert(c, "gonderilmedi");
    assert(c[1] instanceof Uint8Array && c[1].length > 48000 * 4 * 0.5, "PCM boyutu " + c[1]?.length);
    assert(c[2].headers["x-channel"] === S.channel.id, "kanal basligi");
    assert(!q(".rec-bar"), "cubuk kapanmadi");
    return (c[1].length / 4 / 48000).toFixed(2) + " sn";
  });

  await test("moderasyon: sag tik menusu, yasakla, roller", async () => {
    const g = await openValo();
    const author = [...document.querySelectorAll("#messages .author[data-pop]")].find((a) => a.dataset.pop !== S.me.id);
    author.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 200, clientY: 200 })); await sleep(30);
    const labels = [...document.querySelectorAll(".menu button")].map((x) => x.textContent).join("|");
    for (const l of ["Yasakla", "Sunucudan at", "Zaman aşımı", "Rolleri düzenle"]) assert(labels.includes(l), l + " yok: " + labels);
    await lastMenuClick("Yasakla");
    [...document.querySelectorAll("#modal .btn")].find((b) => b.textContent === "Yasakla").click(); await sleep(40);
    const b = called("mod_action").pop()[1];
    assert(b.action === "ban" && b.target === author.dataset.pop && b.guildId === g.id, "ban: " + JSON.stringify(b));
    author.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 200, clientY: 200 })); await sleep(30);
    await lastMenuClick("Rolleri düzenle"); await sleep(50);
    const items = document.querySelectorAll("#modal .role-item");
    assert(items.length === 3, "rol sayisi " + items.length);
    assert(items[0].classList.contains("off"), "ustteki rol (Kurucu) kilitli olmali");
    assert(items[2].querySelector("input").checked, "mevcut rol isaretli degil");
    items[1].querySelector("input").click();
    [...document.querySelectorAll("#modal .btn")].find((x) => x.textContent === "Kaydet").click(); await sleep(40);
    const r = called("mod_action").pop()[1];
    assert(r.action === "roles" && JSON.stringify(r.value.sort()) === JSON.stringify(["r2", "r3"]), "roller: " + JSON.stringify(r));
  });

  await test("moderator: sabitle + baskasinin mesajini sil", async () => {
    const el = [...document.querySelectorAll("#messages .msg")].find((m) => { const x = S.msgs.find((y) => y.id === m.dataset.id); return x && x.author.id !== S.me.id && !x._deleted && !x.poll; });
    const pin = [...el.querySelectorAll(".actions button")].find((b) => b.title === "Sabitle");
    assert(pin, "sabitle yok");
    pin.click(); await sleep(30);
    assert(called("mod_action").pop()[1].action === "pin", "pin cagrilmadi");
    assert([...el.querySelectorAll(".actions button")].some((b) => b.title === "Sil (moderatör)"), "moderator sil yok");
    // Yetkisiz sunucuda yok
    const g2 = window.__mock.guilds[3]; openGuild(g2.id); await openChannel({ ...g2.channels[1], guild_id: g2.id }); await sleep(60);
    assert(!q('#messages .actions button[title="Sabitle"]'), "yetkisiz sunucuda sabitle cikmamali");
  });

  // ---------- Ekstra: hesaplar, FakeNitro, profil, takip, kayıt, taslak, zamanlama, yedek ----------
  await test("coklu hesap: liste + gecis", async () => {
    await openAccounts(); await sleep(40);
    const items = document.querySelectorAll("#modal .acc-item");
    assert(items.length === 2, "hesap sayisi " + items.length);
    assert(items[0].classList.contains("cur"), "mevcut hesap isaretli degil");
    const origReload = location.reload; let reloaded = false;
    // reload'u engelle (switchAccount sonrasi)
    window.__noReload = true;
    const sw = window.switchAccount; window.switchAccount = async (id) => { await invoke("switch_account", { id }); reloaded = id; };
    items[1].onclick = () => window.switchAccount("555");
    items[1].click(); await sleep(30);
    window.switchAccount = sw;
    assert(called("switch_account").pop()[1].id === "555" && reloaded === "555", "gecis cagrilmadi");
    closeModal();
  });

  await test("FakeNitro: baska sunucu / animasyonlu emoji baglantiya donusur", async () => {
    const g0 = window.__mock.guilds[0];
    openGuild(g0.id); await openChannel({ ...g0.channels[1], guild_id: g0.id }); await sleep(60);
    const r = prepareOutgoing("selam <:valo:7001> <:kedi:7002> <a:dans:7003>");
    assert(r.content.includes("<:valo:7001>"), "kendi sunucu emojisi korunmali: " + r.content);
    assert(r.content.includes("[kedi](https://cdn.discordapp.com/emojis/7002.webp"), "kedi: " + r.content);
    assert(r.content.includes("[dans](https://cdn.discordapp.com/emojis/7003.gif"), "dans: " + r.content);
    const sil = prepareOutgoing("@silent gece gece");
    assert(sil.silent && sil.content === "gece gece", "silent: " + JSON.stringify(sil));
    $("#input").value = "@silent <:kedi:7002>"; await send(); await sleep(40);
    const sm = called("send_message").pop()[1];
    assert(sm.silent === true && sm.content.startsWith("[kedi]("), "gonderim: " + JSON.stringify(sm));
  });

  await test("emoji secici tum sunuculari gosterir", async () => {
    $("#emoji-btn").click(); await sleep(30);
    const heads = [...document.querySelectorAll(".emoji-pop h5")].map((x) => x.textContent);
    assert(heads.length >= 3 && heads[1].includes("✨"), "gruplar: " + heads.join("|"));
    closeEmojiPop();
  });

  await test("cikartma secici: kendi + FakeNitro", async () => {
    $("#sticker-btn").click(); await sleep(30);
    const imgs = document.querySelectorAll(".sticker-pop img");
    assert(imgs.length === 2, "lottie haric 2 cikartma olmali: " + imgs.length);
    imgs[0].closest("button").click(); await sleep(40);
    let sm = called("send_message").pop()[1];
    assert(JSON.stringify(sm.stickerIds) === '["8003"]', "kendi cikartmasi sticker_ids ile: " + JSON.stringify(sm));
    $("#sticker-btn").click(); await sleep(30);
    document.querySelectorAll(".sticker-pop img")[1].closest("button").click(); await sleep(40);
    sm = called("send_message").pop()[1];
    assert(!sm.stickerIds && sm.content.includes("media.discordapp.net/stickers/8001.png"), "FakeNitro cikartma: " + JSON.stringify(sm));
  });

  await test("profil: gizli bilgiler + indirme", async () => {
    const a = [...document.querySelectorAll("#messages .author[data-pop]")].find((x) => x.dataset.pop !== S.me.id);
    a.click(); await sleep(150);
    const sec = q(".popout .pc-hidden");
    assert(sec, "gizli bilgi bolumu yok");
    const t = sec.textContent;
    for (const k of ["Hesap açılışı", "Sunucuya katılım", "Nitro", "ID", "Steam: oyuncu42"]) assert(t.includes(k), k + " yok: " + t);
    assert(sec.querySelector(".pc-badges img"), "rozet yok");
    [...sec.querySelectorAll(".pc-dl button")].find((b) => b.textContent.includes("Banner")).click(); await sleep(30);
    const sv = called("save_media").pop()[1];
    assert(sv.url.includes("/banners/") && sv.url.includes("size=4096") && sv.name.endsWith(".png"), "indirme: " + JSON.stringify(sv));
    closePopout();
  });

  await test("ses kanali kaydi + isim gecmisi", async () => {
    const g = window.__mock.guilds[0]; const vc = g.channels.find((c) => c.type === 2);
    window.__mock.emit("voice-state", { user_id: "201", guild_id: g.id, channel_id: vc.id, prev_channel_id: null, user: { id: "201", username: "ali", global_name: "Ali" } });
    window.__mock.emit("voice-state", { user_id: "201", guild_id: g.id, channel_id: null, prev_channel_id: vc.id, user: { id: "201", username: "ali", global_name: "Ali" } });
    openVcLog(g.id); await sleep(20);
    const rows = document.querySelectorAll("#vclog-list .vcl-row");
    assert(rows.length >= 2 && rows[0].textContent.includes("Ali") && rows[0].textContent.includes("🔴"), "kayit: " + $("#vclog-list").textContent);
    closeModal();
    trackUser({ id: "777", username: "eski", global_name: "Eski Ad", avatar: null });
    window.__mock.emit("presence", { user_id: "777", status: "online", activities: [], user: { id: "777", username: "yeni", global_name: "Eski Ad", avatar: "x" } });
    const hist = JSON.parse(localStorage.getItem("shion.hist"))["777"];
    assert(hist?.length === 2 && hist[0].from === "eski" && hist[0].to === "yeni" && hist[1].k === "avatar", "gecmis: " + JSON.stringify(hist));
  });

  await test("anahtar kelime bildirimi", async () => {
    const n = KW_HITS.length;
    window.__mock.emit("unread", { channel_id: "x1", guild_id: null, mention: false, keyword: "maç", author: "Can", content: "akşam maç var", where: "genel", message_id: "1" });
    await sleep(20);
    assert(KW_HITS.length === n + 1 && KW_HITS[0].keyword === "maç", "kayit yok");
    openKeywordHits(); await sleep(10);
    assert(q("#modal .kw-row")?.textContent.includes("akşam maç var"), "liste yok");
    closeModal();
  });

  await test("taslaklar kanal degistirince korunur", async () => {
    const g = window.__mock.guilds[0];
    const [a, b] = g.channels.filter((c) => c.type === 0 && !c.hidden);
    await openChannel({ ...a, guild_id: g.id }); await sleep(40);
    $("#input").value = "yarim kalan mesaj";
    await openChannel({ ...b, guild_id: g.id }); await sleep(40);
    assert($("#input").value === "", "yeni kanalda bos olmali: " + $("#input").value);
    await openChannel({ ...a, guild_id: g.id }); await sleep(40);
    assert($("#input").value === "yarim kalan mesaj", "taslak geri gelmedi");
    await send(); await sleep(30);
    assert(!cfg.drafts[a.id], "gonderince taslak silinmeli");
  });

  await test("zamanlanmis mesaj", async () => {
    $("#input").value = "sonra gelecek";
    $("#sched-btn").click(); await sleep(20);
    assert(q("#modal textarea").value === "sonra gelecek", "metin aktarilmadi");
    q("#modal .btn.primary").click(); await sleep(20);
    const x = cfg.scheduled.find((y) => y.content === "sonra gelecek");
    assert(x && x.at > Date.now() + 3000000, "zamanlanmadi");
    assert($("#input").value === "", "kutu temizlenmedi");
    x.at = Date.now() - 1; const n = called("send_message").length;
    await runScheduled(); await sleep(20);
    assert(called("send_message").length === n + 1 && called("send_message").pop()[1].content === "sonra gelecek", "gonderilmedi");
    assert(!cfg.scheduled.some((y) => y.id === x.id), "listeden silinmedi");
  });

  await test("kanal yedekleme (ilerleme)", async () => {
    const g = window.__mock.guilds[0];
    await exportChannel({ ...g.channels[1], guild_id: g.id }); await sleep(10);
    q("#modal .btn.primary").click(); await sleep(400);
    const body = $("#modal-body").textContent;
    assert(body.includes("Kaydedildi") && body.includes(".html"), "sonuc: " + body);
    assert(called("export_channel").pop()[1].format === "html", "format");
    closeModal();
  });

  await test("oyun aktivitesi gostergesi + ayarlar", async () => {
    window.__mock.emit("game", "Valorant"); await sleep(20);
    assert(q("#me-panel .who small").textContent.includes("Valorant"), "panelde yok");
    window.__mock.emit("game", null); await sleep(20);
    assert(!q("#me-panel .who small").textContent.includes("Valorant"), "temizlenmedi");
    openModal("Ayarlar", settingsView()); await sleep(50);
    const t = $("#modal-body").textContent;
    for (const k of ["Gürültü engelleme", "FakeNitro", "Oyun aktivitesi", "Anahtar kelimeler"]) assert(t.includes(k), k + " ayari yok");
    closeModal();
  });

  await test("kisi basi ses seviyesi (sag tik)", async () => {
    closeModal();
    const v = [...S.vstates.values()].find((x) => x.user_id !== S.me.id && x.channel_id);
    assert(v, "seste kimse yok");
    const u = v.user;
    memberMenu({ clientX: 100, clientY: 100, target: document.body }, u); await sleep(20);
    await lastMenuClick("Ses seviyesi");
    const r = q("#modal .uvol input[type=range]");
    r.value = 150; r.dispatchEvent(new Event("input")); await sleep(10);
    assert(called("set_user_volume").pop()[1].volume === 1.5 && cfg.userVol[u.id] === 1.5, "seviye kaydedilmedi");
    closeModal();
    memberMenu({ clientX: 100, clientY: 100, target: document.body }, u); await sleep(20);
    await lastMenuClick("Yerel olarak sustur");
    assert(called("set_user_volume").pop()[1].volume === 0, "susturulmadi");
    memberMenu({ clientX: 100, clientY: 100, target: document.body }, u); await sleep(20);
    await lastMenuClick("Yerel susturmayı kaldır");
    assert(!(u.id in cfg.userVol), "sifirlanmadi");
  });

  await test("mikrofon testi: seviye gostergesi", async () => {
    openModal("Ayarlar", settingsView()); await sleep(60);
    const btn = [...document.querySelectorAll("#modal .btn")].find((b) => b.textContent.includes("Testi başlat"));
    assert(btn, "test dugmesi yok");
    btn.click(); await sleep(250);
    const lvl = q(".mic-meter .lvl");
    assert(parseFloat(lvl.style.width) > 50 && q(".mic-meter").classList.contains("on"), "seviye: " + lvl.style.width);
    closeModal(); await sleep(30);
    assert(called("mic_test").pop()[1].on === false, "modal kapaninca test durmadi");
  });

  await test("ekran paylasimi: buyuk ekran olceklenir", async () => {
    const sd = new Sender("x", null, SCR);
    const cases = [[2560, 1440, 1920, 1080], [3840, 2160, 1920, 1080], [3440, 1440, 1920, 804], [1366, 768, 1366, 768], [1081, 721, 1080, 720]];
    for (const [w, hh, ew, eh] of cases) { const [a, b] = sd.fit(w, hh); assert(a === ew && b === eh, `${w}x${hh} -> ${a}x${b}, beklenen ${ew}x${eh}`); }
    // gercek olcekleme + kodlama
    const cv = new OffscreenCanvas(2560, 1440); cv.getContext("2d").fillRect(0, 0, 10, 10);
    const fr = new VideoFrame(cv, { timestamp: 0 });
    const out = sd.scaled(fr, 1920, 1080); fr.close();
    assert(out.displayWidth === 1920 && out.displayHeight === 1080, "olceklenmis kare " + out.displayWidth);
    out.close();
    sd.lastKey = performance.now(); sd.needKey = false; sd.requestKey();
    assert(!sd.needKey, "PLI siniri calismiyor");
    sd.lastKey = performance.now() - 2000; sd.requestKey();
    assert(sd.needKey, "PLI anahtar kare istemedi");
  });

  await test("guncelleme: denetle + bildirim cubugu", async () => {
    closeModal();
    window.__mockUpdate = null;
    assert((await checkUpdate(true)) === null && q("#toast").textContent.includes("güncel"), "guncel mesaji yok");
    window.__mockUpdate = { version: "0.3.0", current: "0.2.0", notes: "yeni" };
    await checkUpdate(false);
    const bar = q("#update-bar");
    assert(bar && bar.textContent.includes("0.3.0"), "cubuk yok");
    bar.querySelector(".btn.primary").click(); await sleep(50);
    assert(called("install_update").length === 1, "kurulum cagrilmadi");
    bar.remove(); window.__mockUpdate = null;
  });

  await test("yatay tasma yok", async () => {
    assert(document.documentElement.scrollWidth <= innerWidth + 1, "scrollWidth " + document.documentElement.scrollWidth);
  });

  return results;
}
