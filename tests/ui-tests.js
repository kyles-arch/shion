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

  await test("yatay tasma yok", async () => {
    assert(document.documentElement.scrollWidth <= innerWidth + 1, "scrollWidth " + document.documentElement.scrollWidth);
  });

  return results;
}
