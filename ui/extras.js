"use strict";
/* Shion ekstralar: otomatik sunucu kategorize, profil duzenleyici, profil kartlari,
   Ctrl+K hizli gecis, yukleme ekrani. app.js'teki global yardimcilari kullanir. */

/* ------------------------------------------------------------------ */
/* Otomatik kategorize                                                 */
/* ------------------------------------------------------------------ */
const CATEGORIES = [
  { key: "oyun", name: "🎮 Oyun", color: "#ed4245", kw: ["oyun", "game", "gaming", "valorant", "minecraft", "smp", "survival", "cs2", "csgo", "counter", "faceit", "lol", "league", "fortnite", "pubg", "apex", "roblox", "gta", "fivem", "roleplay", "steam", "overwatch", "dota", "genshin", "metin2", "zula", "wolfteam", "esports", "espor", "ranked", "rank", "lobi", "lobby", "klan", "clan", "takım-arıyorum", "lfg", "turnuva", "tournament", "mmorpg", "warzone", "rocket", "hoyoverse", "pokemon", "osu", "brawl"] },
  { key: "yazilim", name: "💻 Yazılım & Teknoloji", color: "#3498db", kw: ["kod", "code", "coding", "programlama", "programming", "developer", "geliştirici", "yazılım", "software", "python", "javascript", "typescript", "django", "react", "node", "github", "linux", "siber", "cyber", "teknoloji", "tech", "yapay-zeka", "ai-", "api", "frontend", "backend", "devops", "unity", "unreal", "gamedev", "c++", "java", "golang", "kotlin", "flutter", "discord.js", "bot-geliştirme", "hackathon"] },
  { key: "muzik", name: "🎵 Müzik", color: "#1abc9c", kw: ["müzik", "muzik", "music", "lofi", "lo-fi", "şarkı", "sarki", "song", "spotify", "rap", "hiphop", "dj", "beat", "playlist", "dinleme", "radyo", "radio", "konser", "producer", "prodüktör"] },
  { key: "anime", name: "🌸 Anime & Manga", color: "#eb459e", kw: ["anime", "manga", "waifu", "otaku", "weeb", "one-piece", "naruto", "manhwa", "webtoon", "cosplay", "seasonal-anime", "jujutsu", "demon-slayer", "vtuber"] },
  { key: "egitim", name: "📚 Eğitim & Okul", color: "#f0b232", kw: ["yks", "lgs", "kpss", "ales", "tyt", "ayt", "ders", "okul", "school", "study", "çalışma", "matematik", "math", "fizik", "kimya", "biyoloji", "ödev", "odev", "homework", "üniversite", "universite", "university", "sınav", "sinav", "exam", "ingilizce", "english", "öğren", "learn", "deneme", "hazırlık"] },
  { key: "kripto", name: "💰 Kripto & Finans", color: "#f1c40f", kw: ["kripto", "crypto", "btc", "bitcoin", "eth", "ethereum", "altcoin", "trading", "trade", "borsa", "nft", "sinyal", "signal", "finans", "finance", "forex", "yatırım", "yatirim", "airdrop", "defi", "web3"] },
  { key: "sanat", name: "🎨 Sanat & Tasarım", color: "#9b59b6", kw: ["sanat", "art", "çizim", "cizim", "drawing", "tasarım", "tasarim", "design", "commission", "illustration", "midjourney", "stable-diffusion", "fotoğraf", "fotograf", "photo", "edit", "render", "3d", "blender", "pixel", "eserler", "artwork"] },
  { key: "arkadas", name: "👥 Arkadaşlar", color: "#23a55a", kw: ["kanka", "arkadaş", "arkadas", "friends", "ekip", "aile", "family", "squad", "bizim", "kankalar", "dostlar", "sınıf", "sinif"] },
  { key: "topluluk", name: "💬 Topluluk & Sohbet", color: "#5865f2", kw: ["sohbet", "chat", "community", "topluluk", "türkiye", "turkiye", "muhabbet", "social", "sosyal", "meme", "caps", "public", "hub"] },
];
const CAT_OTHER = { key: "diger", name: "📦 Diğer", color: "#99aab5" };

function tokens(s) {
  return (s || "").toLocaleLowerCase("tr").replace(/[^\p{L}\p{N}+.\-]+/gu, " ").split(" ").filter(Boolean);
}
/** Sunucuyu adina ve kanal adlarina gore puanla. Ad 3 puan, her kanal 1 puan. */
function classifyGuild(g) {
  const nameText = (g.name || "").toLocaleLowerCase("tr");
  const nameTok = tokens(g.name);
  const chans = (g.channels || []).filter((c) => c.type !== 4).map((c) => (c.name || "").toLocaleLowerCase("tr"));
  let best = null, bestScore = 0;
  for (const cat of CATEGORIES) {
    let score = 0;
    for (const k of cat.kw) {
      if (nameTok.some((t) => t === k || (k.length > 3 && t.includes(k))) || (k.includes("-") && nameText.includes(k.replace(/-/g, " ")))) score += 3;
      for (const c of chans) if (c === k || (k.length > 3 && c.includes(k))) { score += 1; }
    }
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  if (best && bestScore >= 2) return best;
  // Ipucu yoksa: kucuk sunucular arkadas grubu, buyukler topluluk
  const real = chans.length;
  if (real <= 6) return CATEGORIES.find((c) => c.key === "arkadas");
  if (best) return best;
  return real >= 15 ? CATEGORIES.find((c) => c.key === "topluluk") : CAT_OTHER;
}

function categorizeAll() {
  const groups = new Map();
  for (const g of S.guilds) {
    const c = classifyGuild(g);
    if (!groups.has(c.key)) groups.set(c.key, { cat: c, guilds: [] });
    groups.get(c.key).guilds.push(g);
  }
  const order = [...CATEGORIES, CAT_OTHER].map((c) => c.key);
  return [...groups.values()].sort((a, b) => order.indexOf(a.cat.key) - order.indexOf(b.cat.key));
}

function openCategorize(auto) {
  const groups = categorizeAll();
  const box = h("div");
  box.append(h("p", "muted", auto ? "Sunucularını adlarına ve kanallarına bakarak grupladım. Beğenirsen uygula; sonra sürükle-bırak ile düzeltebilirsin." : "Sunucular adlarına ve kanal adlarına göre gruplandı. Bir sunucunun grubunu değiştirmek için yanındaki menüyü kullan."));
  const all = [...CATEGORIES, CAT_OTHER];
  const assign = new Map();
  groups.forEach((gr) => gr.guilds.forEach((g) => assign.set(g.id, gr.cat.key)));
  const list = h("div", "cat-preview");
  const render = () => {
    list.textContent = "";
    for (const cat of all) {
      const gs = S.guilds.filter((g) => assign.get(g.id) === cat.key);
      if (!gs.length) continue;
      const sec = h("div", "cat-group");
      sec.style.setProperty("--fc", cat.color);
      sec.append(h("div", "cat-title", `${esc(cat.name)} <small>${gs.length}</small>`));
      const chips = h("div", "cat-chips");
      for (const g of gs) {
        const chip = h("label", "cat-chip");
        const icon = guildIcon(g, 32);
        chip.innerHTML = icon ? `<img src="${icon}">` : `<span class="mini">${esc(guildAcr(g.name).slice(0, 2))}</span>`;
        chip.append(document.createTextNode(g.name));
        const sel = h("select");
        sel.innerHTML = all.map((c) => `<option value="${c.key}" ${c.key === cat.key ? "selected" : ""}>${esc(c.name)}</option>`).join("");
        sel.onchange = () => { assign.set(g.id, sel.value); render(); };
        chip.append(sel);
        chips.append(chip);
      }
      sec.append(chips);
      list.append(sec);
    }
  };
  render();
  box.append(list);
  const bar = h("div", "row");
  const cancel = h("button", "btn", auto ? "Şimdi değil" : "Vazgeç");
  cancel.onclick = closeModal;
  const ok = h("button", "btn primary", "✨ Uygula");
  ok.onclick = () => {
    cfg.rail = [];
    for (const cat of all) {
      const ids = S.guilds.filter((g) => assign.get(g.id) === cat.key).map((g) => g.id);
      if (ids.length) cfg.rail.push({ type: "f", id: "cat-" + cat.key, name: cat.name, color: cat.color, open: false, guilds: ids });
    }
    cfg.autoCatAsked = true; saveCfg(); renderRail(); closeModal();
    toast(`${S.guilds.length} sunucu ${cfg.rail.length} klasöre ayrıldı`);
  };
  bar.append(h("span"), cancel, ok);
  box.append(bar);
  openModal("Sunucuları kategorize et", box);
  if (auto) { cfg.autoCatAsked = true; saveCfg(); }
}

/* ------------------------------------------------------------------ */
/* Profil kartlari                                                     */
/* ------------------------------------------------------------------ */
const profileCache = new Map();
async function fetchProfile(userId, guildId) {
  const key = userId + ":" + (guildId || "");
  if (profileCache.has(key)) return profileCache.get(key);
  const p = invoke("get_profile", { userId, guildId: guildId || null }).catch(() => null);
  profileCache.set(key, p);
  setTimeout(() => profileCache.delete(key), 5 * 60000);
  return p;
}
const bannerUrl = (u, hash) => (hash ? `${CDN}/banners/${u.id}/${hash}.${hash.startsWith("a_") ? "gif" : "webp"}?size=600` : null);

function profileCardHtml(user, prof, opts = {}) {
  const up = prof?.user_profile || {};
  const accent = intColor(up.accent_color ?? user.accent_color) || "var(--accent)";
  const banner = opts.bannerData || bannerUrl(user, up.banner || user.banner);
  const st = opts.status || "";
  const custom = opts.custom ? `<div class="pc-custom">${esc(opts.custom)}</div>` : "";
  const effect = opts.effect || (user.id === S.me?.id ? cfg.profileEffect : "");
  return `<div class="pc ${effect ? "fx-" + effect : ""}" style="--pc-accent:${accent}">
    <div class="pc-banner" style="${banner ? `background-image:url('${banner}')` : ""}"></div>
    <div class="pc-av"><img src="${opts.avatarData || avatarUrl(user, 128)}">${st ? `<span class="st ${st}"></span>` : ""}</div>
    <div class="pc-body">
      <div class="pc-name">${esc(opts.globalName ?? dname(user))}</div>
      <div class="pc-user">@${esc(user.username || "")}${(opts.pronouns ?? up.pronouns) ? ` · ${esc(opts.pronouns ?? up.pronouns)}` : ""}</div>
      ${custom}
      ${(opts.bio ?? up.bio) ? `<div class="pc-sec"><h5>Hakkımda</h5><div class="pc-bio">${md(opts.bio ?? up.bio)}</div></div>` : ""}
      <div class="pc-sec"><h5>Discord'a katılım</h5><div>${new Date(snowTime(user.id)).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}</div></div>
      ${prof?.mutual_guilds?.length ? `<div class="pc-sec"><h5>Ortak sunucular · ${prof.mutual_guilds.length}</h5><div class="pc-mutual">${prof.mutual_guilds.slice(0, 8).map((m) => { const g = S.guilds.find((x) => x.id === m.id); return g ? (guildIcon(g, 32) ? `<img title="${esc(g.name)}" src="${guildIcon(g, 32)}">` : `<span class="mini" title="${esc(g.name)}">${esc(guildAcr(g.name).slice(0, 2))}</span>`) : ""; }).join("")}</div></div>` : ""}
    </div></div>`;
}

let popout = null;
function closePopout() { popout?.remove(); popout = null; }
async function openPopout(anchor, userId) {
  closePopout();
  const user = S.msgs.find((m) => m.author?.id === userId)?.author || S.vstates.get(userId)?.user || (userId === S.me?.id ? S.me : null) || { id: userId, username: "…" };
  const pop = h("div", "popout");
  pop.innerHTML = profileCardHtml(user, null);
  document.body.append(pop);
  popout = pop;
  const place = () => {
    const r = anchor.getBoundingClientRect();
    let x = r.right + 10, y = r.top - 20;
    if (x + pop.offsetWidth > innerWidth - 8) x = r.left - pop.offsetWidth - 10;
    pop.style.left = Math.max(8, x) + "px";
    pop.style.top = Math.max(8, Math.min(y, innerHeight - pop.offsetHeight - 8)) + "px";
  };
  place();
  const prof = await fetchProfile(userId, S.channel?.guild_id);
  if (popout !== pop) return;
  const u = prof?.user ? { ...user, ...prof.user } : user;
  pop.innerHTML = profileCardHtml(u, prof);
  if (userId !== S.me?.id) {
    const btn = h("button", "btn primary pc-dm", "💬 Mesaj gönder");
    btn.onclick = async () => {
      closePopout();
      try {
        const d = await invoke("open_dm", { userId });
        if (!S.dms.some((x) => x.id === d.id)) S.dms.unshift({ id: d.id, type: d.type, name: d.name, icon: d.icon, recipients: d.recipients || [u], last_message_id: d.last_message_id });
        S.view = "home"; renderRail(); renderSidebar();
        openChannel({ id: d.id, guild_id: null, name: dname(u), type: 1, can_send: true });
      } catch (e) { toast("DM açılamadı: " + e); }
    };
    pop.querySelector(".pc-body").append(btn);
    const nb = h("button", "btn pc-dm", cfg.nicknames?.[userId] ? "🏷 Takma adı değiştir" : "🏷 Yerel takma ad ver");
    nb.onclick = () => { closePopout(); setNickname(u); };
    pop.querySelector(".pc-body").append(nb);
  } else {
    const btn = h("button", "btn pc-dm", "✏️ Profili düzenle");
    btn.onclick = () => { closePopout(); openProfileEditor(); };
    pop.querySelector(".pc-body").append(btn);
  }
  profileExtras(pop, u, prof);
  place();
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-pop]");
  if (t) { e.stopPropagation(); openPopout(t, t.dataset.pop); return; }
  if (popout && !popout.contains(e.target)) closePopout();
});

/* ------------------------------------------------------------------ */
/* Profil duzenleyici                                                  */
/* ------------------------------------------------------------------ */
const BANNER_PRESETS = ["#7c6cff", "#5865f2", "#eb459e", "#ed4245", "#f0b232", "#23a55a", "#1abc9c", "#0f172a", "#ff8a00"];
const EFFECTS = [["", "Yok"], ["aurora", "Aurora"], ["glow", "Neon parıltı"], ["holo", "Hologram"], ["fire", "Alev"]];

async function openProfileEditor() {
  const me = S.me;
  const root = h("div", "pe");
  root.innerHTML = '<div class="muted">Profil yükleniyor…</div>';
  openModal("Profilini düzenle", root);
  const prof = (await fetchProfile(me.id, null)) || {};
  profileCache.clear();
  const up = prof.user_profile || {};
  const st = {
    globalName: me.global_name || "", bio: up.bio || "", pronouns: up.pronouns || "",
    accent: intColor(up.accent_color ?? me.accent_color) || "#7c6cff",
    avatarData: null, bannerData: null,
    custom: cfg.customText || "", customEmoji: cfg.customEmoji || "",
    effect: cfg.profileEffect || "",
  };
  root.innerHTML = `
    <div class="pe-form">
      <label>Görünen ad<input class="inp" id="pe-name" maxlength="32" placeholder="${esc(me.username)}"></label>
      <label>Zamirler<input class="inp" id="pe-pron" maxlength="40" placeholder="ör. o/onu"></label>
      <label>Hakkımda <small id="pe-count" class="muted"></small><textarea class="inp" id="pe-bio" rows="4" maxlength="190" placeholder="Kendinden bahset… (markdown destekli)"></textarea></label>
      <label>Özel durum<div class="pe-row"><input class="inp" id="pe-cemoji" maxlength="4" style="width:56px;text-align:center" placeholder="😎"><input class="inp" id="pe-custom" maxlength="128" placeholder="Ne yapıyorsun?"></div></label>
      <div><div class="pe-lbl">Avatar</div><div class="pe-row"><button class="btn" id="pe-av">🖼 Resim seç</button><button class="btn" id="pe-av-rm">Kaldır</button></div></div>
      <div><div class="pe-lbl">Banner rengi</div><div class="color-row" id="pe-colors"></div></div>
      <div><div class="pe-lbl">Profil efekti <small class="muted">(Shion'da görünür)</small></div><div class="pe-fx" id="pe-fx"></div></div>
      <input type="file" id="pe-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
    </div>
    <div class="pe-preview"><div class="pe-lbl">Önizleme</div><div id="pe-card"></div></div>
    <div class="pe-actions"><button class="btn" id="pe-cancel">Vazgeç</button><button class="btn primary" id="pe-save">Kaydet</button></div>`;
  const $p = (s) => root.querySelector(s);
  $p("#pe-name").value = st.globalName; $p("#pe-bio").value = st.bio; $p("#pe-pron").value = st.pronouns;
  $p("#pe-custom").value = st.custom; $p("#pe-cemoji").value = st.customEmoji;
  const preview = () => {
    $p("#pe-count").textContent = `${st.bio.length}/190`;
    $p("#pe-card").innerHTML = profileCardHtml({ ...me, accent_color: parseInt(st.accent.slice(1), 16) }, { user_profile: { ...up, accent_color: parseInt(st.accent.slice(1), 16) } }, {
      globalName: st.globalName || me.username, bio: st.bio, pronouns: st.pronouns, avatarData: st.avatarData === "" ? `${CDN}/embed/avatars/0.png` : st.avatarData,
      status: cfg.status, custom: (st.customEmoji ? st.customEmoji + " " : "") + st.custom, effect: st.effect,
    });
  };
  for (const [sel, key] of [["#pe-name", "globalName"], ["#pe-bio", "bio"], ["#pe-pron", "pronouns"], ["#pe-custom", "custom"], ["#pe-cemoji", "customEmoji"]]) {
    $p(sel).oninput = (e) => { st[key] = e.target.value; preview(); };
  }
  const colors = $p("#pe-colors");
  const drawColors = () => {
    colors.textContent = "";
    for (const c of BANNER_PRESETS) {
      const b = h("button", st.accent.toLowerCase() === c ? "sel" : ""); b.style.background = c;
      b.onclick = () => { st.accent = c; drawColors(); preview(); };
      colors.append(b);
    }
    const pick = h("input"); pick.type = "color"; pick.value = st.accent;
    pick.oninput = () => { st.accent = pick.value; preview(); };
    colors.append(pick);
  };
  drawColors();
  const fx = $p("#pe-fx");
  const drawFx = () => {
    fx.textContent = "";
    for (const [k, label] of EFFECTS) {
      const b = h("button", "fx-btn" + (st.effect === k ? " sel" : ""), `<span class="fx-dot fx-${k || "none"}"></span>${label}`);
      b.onclick = () => { st.effect = k; drawFx(); preview(); };
      fx.append(b);
    }
  };
  drawFx();
  $p("#pe-av").onclick = () => $p("#pe-file").click();
  $p("#pe-av-rm").onclick = () => { st.avatarData = ""; preview(); };
  $p("#pe-file").onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 8 * 1024 * 1024) return toast("Avatar en fazla 8 MB olabilir");
    const rd = new FileReader();
    rd.onload = () => { st.avatarData = rd.result; preview(); };
    rd.readAsDataURL(f);
  };
  $p("#pe-cancel").onclick = closeModal;
  $p("#pe-save").onclick = async () => {
    const btn = $p("#pe-save"); btn.disabled = true; btn.textContent = "Kaydediliyor…";
    const user = {}, profile = {};
    if (st.globalName !== (me.global_name || "")) user.global_name = st.globalName || null;
    if (st.avatarData !== null) user.avatar = st.avatarData || null;
    if (st.bio !== (up.bio || "")) profile.bio = st.bio;
    if (st.pronouns !== (up.pronouns || "")) profile.pronouns = st.pronouns;
    const accentInt = parseInt(st.accent.slice(1), 16);
    if (accentInt !== (up.accent_color ?? me.accent_color)) profile.accent_color = accentInt;
    cfg.customText = st.custom; cfg.customEmoji = st.customEmoji; cfg.profileEffect = st.effect; saveCfg();
    pushStatus();
    try {
      const r = await invoke("update_profile", { user, profile });
      if (r?.user) S.me = { ...S.me, ...r.user };
      profileCache.clear();
      renderMe(); closeModal(); toast("✨ Profil güncellendi");
    } catch (e) {
      toast("Kaydedilemedi: " + e);
      btn.disabled = false; btn.textContent = "Kaydet";
    }
  };
  preview();
}

/** Durum + ozel durumu gateway'e gonder. */
function pushStatus() {
  invoke("set_status", { status: cfg.status, customText: cfg.customText || null, customEmoji: cfg.customEmoji || null }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Ctrl+K hizli gecis                                                  */
/* ------------------------------------------------------------------ */
function quickSwitcher() {
  if (!$("#modal").classList.contains("hidden") && $("#qs-input")) return closeModal();
  const box = h("div", "qs");
  const input = h("input", "inp"); input.id = "qs-input"; input.placeholder = "Kanal, sunucu veya kişi ara…  (↑↓ Enter)";
  const list = h("div", "qs-list");
  box.append(input, list);
  const items = [];
  for (const d of S.dms) items.push({ label: d.name || d.recipients.map(dname).join(", "), sub: "Direkt Mesaj", icon: "@", open: () => { S.view = "home"; renderRail(); renderSidebar(); openChannel({ id: d.id, guild_id: null, name: d.name || d.recipients.map(dname).join(", "), type: d.type, can_send: true }); } });
  for (const g of S.guilds) {
    items.push({ label: g.name, sub: "Sunucu", icon: "◆", open: () => openGuild(g.id) });
    for (const c of g.channels) {
      if (c.type === 4 || (c.hidden && !cfg.showHidden)) continue;
      items.push({ label: c.name, sub: g.name, icon: c.hidden ? "🔒" : ICONS[c.type] ?? "#", open: () => { openGuild(g.id); openChannel({ ...c, guild_id: g.id }); } });
    }
  }
  let sel = 0, shown = [];
  const score = (it, q) => {
    const l = it.label.toLocaleLowerCase("tr");
    if (!q) return 1;
    if (l.startsWith(q)) return 3;
    if (l.includes(q)) return 2;
    let i = 0; for (const ch of l) if (ch === q[i]) i++;
    return i === q.length ? 1 : 0;
  };
  const draw = () => {
    const q = input.value.toLocaleLowerCase("tr").trim();
    shown = items.map((it) => [score(it, q), it]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 40).map(([, it]) => it);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((it, i) => `<div class="qs-item${i === sel ? " sel" : ""}" data-i="${i}"><span class="qs-ico">${it.icon}</span><b>${esc(it.label)}</b><small>${esc(it.sub)}</small></div>`).join("") || '<div class="muted" style="padding:10px">Sonuç yok</div>';
    list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
  };
  const go = (i) => { const it = shown[i]; if (it) { closeModal(); it.open(); } };
  input.oninput = () => { sel = 0; draw(); };
  input.onkeydown = (e) => {
    if (e.key === "ArrowDown") { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === "Enter") go(sel);
  };
  list.onclick = (e) => { const r = e.target.closest(".qs-item"); if (r) go(+r.dataset.i); };
  openModal("Hızlı geçiş", box);
  draw(); input.focus();
}
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !$("#app").classList.contains("hidden")) { e.preventDefault(); quickSwitcher(); }
});

/* ------------------------------------------------------------------ */
/* Yukleme ekrani                                                      */
/* ------------------------------------------------------------------ */
function showSplash(on) {
  let s = $("#splash");
  if (on) {
    if (!s) {
      s = h("div", "", `<div class="logo splash-logo">S</div><div class="splash-txt">Sunucular yükleniyor…</div><div class="splash-bar"><i></i></div>`);
      s.id = "splash"; document.body.append(s);
    }
  } else if (s) { s.classList.add("out"); setTimeout(() => s.remove(), 400); }
}
listen("gw-ready", () => {
  showSplash(false);
  // Ilk acilista (klasor yoksa) sunuculari kategorize etmeyi oner
  setTimeout(() => {
    if (!cfg.autoCatAsked && S.guilds.length >= 3 && !(cfg.rail || []).some((x) => x.type === "f") && $("#modal").classList.contains("hidden")) openCategorize(true);
  }, 900);
});
listen("gw-status", (e) => { if (String(e.payload).startsWith("fatal")) showSplash(false); });
