"use strict";
/* Shion — çoklu hesap, FakeNitro, gizli profil bilgileri, ses/arkadaş takibi, anahtar kelimeler,
   zamanlanmış mesajlar, taslaklar, oyun aktivitesi, kanal yedekleme, medya indirme, gürültü engelleme. */

const PLUS_DEFAULTS = { userVol: {}, streamAudio: true, screenQuality: "1080", noise: true, fakeNitro: true, gameDetect: true, keywords: [], scheduled: [], drafts: {}, watch: {}, vcNotify: true };
for (const [k, v] of Object.entries(PLUS_DEFAULTS)) if (cfg[k] === undefined) cfg[k] = structuredClone(v);

const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/* Açılışta Rust tarafına ayarları gönder */
function pushPlusSettings() {
  for (const [id, v] of Object.entries(cfg.userVol)) invoke("set_user_volume", { userId: id, volume: v }).catch(() => {});
  invoke("set_noise", { on: !!cfg.noise }).catch(() => {});
  invoke("set_keywords", { words: cfg.keywords }).catch(() => {});
  invoke("set_game_detect", { on: !!cfg.gameDetect }).catch(() => {});
}
pushPlusSettings();
listen("gw-ready", pushPlusSettings);

/* ------------------------------------------------------------------ */
/* Çoklu hesap                                                         */
/* ------------------------------------------------------------------ */
const accAvatar = (a) => avatarUrl({ id: a.id, avatar: a.avatar }, 64);

async function renderLoginAccounts() {
  let list = [];
  try { list = await invoke("list_accounts"); } catch {}
  let box = $("#acc-list");
  if (!box) { box = h("div", "acc-list"); box.id = "acc-list"; $("#token").before(box); }
  box.textContent = "";
  if (!list.length) return;
  box.append(h("small", "muted", "Kayıtlı hesaplar"));
  for (const a of list) {
    const r = h("div", "acc-item", `<img src="${accAvatar(a)}"><div><b>${esc(a.global_name || a.username)}</b><small>@${esc(a.username)}</small></div>`);
    const x = h("button", "icon-btn acc-x", "✕"); x.title = "Listeden kaldır";
    x.onclick = async (e) => { e.stopPropagation(); await invoke("remove_account", { id: a.id }); renderLoginAccounts(); };
    r.append(x);
    r.onclick = () => switchAccount(a.id);
    box.append(r);
  }
  box.append(h("small", "muted acc-or", "ya da yeni hesapla giriş yap"));
}
window.addEventListener("DOMContentLoaded", () => setTimeout(() => { if (!$("#login").classList.contains("hidden")) renderLoginAccounts(); }, 50));

async function switchAccount(id) {
  try { await invoke("switch_account", { id }); location.reload(); }
  catch (e) { toast("Geçilemedi: " + e); }
}

async function openAccounts() {
  const list = await invoke("list_accounts").catch(() => []);
  const box = h("div", "acc-list big");
  for (const a of list) {
    const r = h("div", "acc-item" + (a.current ? " cur" : ""), `<img src="${accAvatar(a)}"><div><b>${esc(a.global_name || a.username)}</b><small>@${esc(a.username)}${a.current ? " · şu anki" : ""}</small></div>`);
    if (!a.current) {
      r.onclick = () => switchAccount(a.id);
      const x = h("button", "icon-btn acc-x", "✕"); x.title = "Listeden kaldır";
      x.onclick = async (e) => { e.stopPropagation(); await invoke("remove_account", { id: a.id }); openAccounts(); };
      r.append(x);
    }
    box.append(r);
  }
  if (!list.length) box.append(h("p", "muted", "Kayıtlı hesap yok. \"Beni hatırla\" ile giriş yapılan hesaplar burada listelenir."));
  const add = h("button", "btn primary", "＋ Hesap ekle");
  add.onclick = async () => { await invoke("add_account"); location.reload(); };
  box.append(add);
  openModal("Hesaplar", box);
}
const accountMenuItems = () => [{ label: "👥 Hesap değiştir / ekle", fn: openAccounts }];

/* ------------------------------------------------------------------ */
/* FakeNitro: başka sunucu / animasyonlu emoji ve çıkartmalar          */
/* ------------------------------------------------------------------ */
const hasNitro = () => (S.me?.premium_type || 0) > 0;
function emojiOwner(id) {
  for (const g of S.guilds) if ((g.emojis || []).some((e) => e.id === id)) return g.id;
  return null;
}
/** Seçicide gösterilecek emoji grupları: önce açık sunucu, sonra (Nitro/FakeNitro ile) diğerleri. */
function emojiGroups(current) {
  const out = [];
  if (current?.emojis?.length) out.push(current);
  if (hasNitro() || cfg.fakeNitro) for (const g of S.guilds) if (g !== current && g.emojis?.length) out.push(g);
  return out;
}
const canUseEmoji = (id, animated) => hasNitro() || (!animated && !!S.channel?.guild_id && emojiOwner(id) === S.channel.guild_id);

/** Gönderilecek metni hazırlar: @silent ve FakeNitro dönüşümü. */
function prepareOutgoing(text) {
  let silent = false;
  if (/^@silent(\s|$)/i.test(text)) { silent = true; text = text.replace(/^@silent\s*/i, ""); }
  if (cfg.fakeNitro && !hasNitro()) {
    text = text.replace(/<(a?):(\w+):(\d+)>/g, (all, a, name, id) => {
      if (canUseEmoji(id, !!a)) return all;
      return `[${name}](${CDN}/emojis/${id}.${a ? "gif" : "webp"}?size=48&quality=lossless&name=${name})`;
    });
  }
  return { content: text, silent };
}

const stickerUrl = (s) => `https://media.discordapp.net/stickers/${s.id}.${s.format_type === 4 ? "gif" : "png"}?size=160`;
async function sendSticker(st, gid) {
  if (!S.channel) return;
  const own = hasNitro() || gid === S.channel.guild_id;
  try {
    if (own) await invoke("send_message", { channelId: S.channel.id, content: "", replyTo: null, files: [], stickerIds: [st.id] });
    else if (cfg.fakeNitro) await invoke("send_message", { channelId: S.channel.id, content: `[${st.name}](${stickerUrl(st)})`, replyTo: null, files: [] });
    else toast("Bu çıkartma için Nitro gerekli (Ayarlar → FakeNitro)");
  } catch (e) { toast("Gönderilemedi: " + e); }
}

let stickerPop = null;
function openStickerPicker(anchor) {
  stickerPop?.remove();
  if (stickerPop && stickerPop._anchor === anchor) { stickerPop = null; return; }
  const pop = h("div", "emoji-pop sticker-pop"); pop._anchor = anchor;
  const q = h("input"); q.placeholder = "Çıkartma ara…";
  const grid = h("div", "sticker-grid scroll");
  pop.append(q, grid);
  const cur = S.guilds.find((g) => g.id === S.channel?.guild_id);
  const groups = [cur, ...S.guilds.filter((g) => g !== cur)].filter((g) => g?.stickers?.length);
  const render = () => {
    const s = q.value.toLowerCase().trim(); grid.textContent = "";
    for (const g of groups) {
      const list = g.stickers.filter((x) => x.format_type !== 3 && (!s || x.name.toLowerCase().includes(s)));
      if (!list.length) continue;
      const locked = !hasNitro() && g !== cur && !cfg.fakeNitro;
      grid.append(h("h5", null, esc(g.name) + (locked ? " 🔒" : "")));
      for (const st of list) {
        const b = h("button", locked ? "locked" : null, `<img loading="lazy" src="${stickerUrl(st)}" alt="${esc(st.name)}">`); b.title = st.name;
        b.onclick = () => { pop.remove(); stickerPop = null; sendSticker(st, g.id); };
        grid.append(b);
      }
    }
    if (!grid.children.length) grid.append(h("p", "muted", "Çıkartma yok"));
  };
  q.oninput = render; render();
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right - 360, innerWidth - 368)) + "px";
  pop.style.top = Math.max(8, r.top - pop.offsetHeight - 6) + "px";
  stickerPop = pop; q.focus();
}
document.addEventListener("mousedown", (e) => { if (stickerPop && !stickerPop.contains(e.target) && !e.target.closest("#sticker-btn")) { stickerPop.remove(); stickerPop = null; } });
$("#sticker-btn").onclick = (e) => openStickerPicker(e.currentTarget);

/* ------------------------------------------------------------------ */
/* Medya indirme (avatar, banner, emoji, çıkartma, resim)              */
/* ------------------------------------------------------------------ */
function bigUrl(u) {
  try {
    const x = new URL(u);
    if (x.searchParams.has("size")) x.searchParams.set("size", x.pathname.includes("/stickers/") ? "320" : "4096");
    return x.toString();
  } catch { return u; }
}
function fileNameFor(u, base) {
  try {
    const p = new URL(u).pathname.split("/").pop();
    const ext = (p.split(".").pop() || "png").toLowerCase();
    return (base ? base.replace(/[:]/g, "") : p.replace(/\.[^.]+$/, "")) + "." + ext;
  } catch { return "dosya.png"; }
}
async function saveMedia(url, name) {
  try { const p = await invoke("save_media", { url: bigUrl(url), name: fileNameFor(url, name) }); toast("İndirildi: " + p.split(/[\\/]/).slice(-2).join("/")); }
  catch (e) { toast("İndirilemedi: " + e); }
}
const isCdn = (u) => /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(u || "");
document.addEventListener("contextmenu", (e) => {
  const img = e.target.closest("#messages img, .popout img, .emoji-pop img, .lightbox img");
  if (!img || !isCdn(img.src) || e.target.closest("[data-pop]")) return;
  e.preventDefault(); e.stopPropagation();
  const name = (img.alt || "").replace(/^:|:$/g, "") || null;
  showMenu(e, [
    { label: "⬇ İndir", fn: () => saveMedia(img.src, name) },
    { label: "🔗 Bağlantıyı kopyala", fn: () => { navigator.clipboard.writeText(bigUrl(img.src)); toast("Kopyalandı"); } },
  ]);
}, true);

/* ------------------------------------------------------------------ */
/* Gizli profil bilgileri + isim geçmişi + takip                       */
/* ------------------------------------------------------------------ */
const fmtFull = (t) => new Date(t).toLocaleString("tr-TR", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
function ago(t) {
  const d = (Date.now() - t) / 86400000;
  if (d < 1) return "bugün";
  if (d < 31) return Math.floor(d) + " gün önce";
  if (d < 365) return Math.floor(d / 30.4) + " ay önce";
  const y = Math.floor(d / 365.25), m = Math.floor((d - y * 365.25) / 30.4);
  return y + " yıl" + (m ? " " + m + " ay" : "") + " önce";
}
const CONN = { steam: "Steam", spotify: "Spotify", xbox: "Xbox", playstation: "PlayStation", github: "GitHub", twitch: "Twitch", youtube: "YouTube", reddit: "Reddit", twitter: "X", instagram: "Instagram", tiktok: "TikTok", battlenet: "Battle.net", riotgames: "Riot", leagueoflegends: "LoL", epicgames: "Epic", roblox: "Roblox" };

function profileExtras(pop, u, prof) {
  const body = pop.querySelector(".pc-body"); if (!body) return;
  const created = snowTime(u.id);
  const rows = [`<div class="kv"><span>Hesap açılışı</span><b title="${esc(fmtFull(created))}">${esc(fmtFull(created))} · ${ago(created)}</b></div>`];
  const gm = prof?.guild_member;
  if (gm?.joined_at) { const j = Date.parse(gm.joined_at); rows.push(`<div class="kv"><span>Sunucuya katılım</span><b>${esc(fmtFull(j))} · ${ago(j)}</b></div>`); }
  if (prof?.premium_since) rows.push(`<div class="kv"><span>Nitro</span><b>${esc(fmtFull(Date.parse(prof.premium_since)))}'dan beri</b></div>`);
  if (prof?.premium_guild_since) rows.push(`<div class="kv"><span>Takviye</span><b>${esc(fmtFull(Date.parse(prof.premium_guild_since)))}'dan beri</b></div>`);
  if (gm?.premium_since) rows.push(`<div class="kv"><span>Bu sunucuyu takviye</span><b>${esc(fmtFull(Date.parse(gm.premium_since)))}</b></div>`);
  if (gm?.communication_disabled_until && Date.parse(gm.communication_disabled_until) > Date.now()) rows.push(`<div class="kv"><span>Zaman aşımı</span><b>${esc(fmtFull(Date.parse(gm.communication_disabled_until)))}'a kadar</b></div>`);
  if (u.bot) rows.push(`<div class="kv"><span>Tür</span><b>🤖 Bot</b></div>`);
  const sec = h("div", "pc-sec pc-hidden", `<h5>Gizli bilgiler 🕵</h5>${rows.join("")}`);
  const idRow = h("div", "kv", `<span>ID</span><b class="copy">${esc(u.id)}</b>`);
  idRow.querySelector(".copy").onclick = () => { navigator.clipboard.writeText(u.id); toast("ID kopyalandı"); };
  sec.append(idRow);
  if (prof?.badges?.length) {
    const b = h("div", "pc-badges");
    b.innerHTML = prof.badges.map((x) => `<img title="${esc(x.description)}" src="${CDN}/badge-icons/${x.icon}.png">`).join("");
    sec.append(b);
  }
  const conns = (prof?.connected_accounts || []).filter((c) => c.name);
  if (conns.length) sec.append(h("div", "pc-conns", conns.slice(0, 10).map((c) => `<span class="chip" title="${esc(c.type)}">${esc(CONN[c.type] || c.type)}: ${esc(c.name)}${c.verified ? " ✓" : ""}</span>`).join("")));
  const hist = (lsGet("shion.hist", {})[u.id] || []).slice(-6).reverse();
  if (hist.length) sec.append(h("div", "pc-hist", `<h5>İsim / avatar geçmişi</h5>` + hist.map((x) => `<div class="kv"><span>${new Date(x.t).toLocaleDateString("tr-TR")}</span><b>${x.k === "avatar" ? "avatar değişti" : `${esc(x.from || "—")} → ${esc(x.to || "—")}`}</b></div>`).join("")));
  // İndirme düğmeleri
  const dl = h("div", "pc-dl");
  const av = h("button", "btn small", "⬇ Avatar"); av.onclick = () => saveMedia(u.avatar ? `${CDN}/avatars/${u.id}/${u.avatar}.${u.avatar.startsWith("a_") ? "gif" : "png"}?size=4096` : avatarUrl(u, 128), (u.username || "avatar") + "-avatar");
  dl.append(av);
  const bh = prof?.user_profile?.banner || u.banner;
  if (bh) { const bb = h("button", "btn small", "⬇ Banner"); bb.onclick = () => saveMedia(`${CDN}/banners/${u.id}/${bh}.${bh.startsWith("a_") ? "gif" : "png"}?size=4096`, (u.username || "banner") + "-banner"); dl.append(bb); }
  if (S.friends.some((f) => f.id === u.id && f.type === 1)) {
    const w = h("button", "btn small", cfg.watch[u.id] ? "🔕 Takibi bırak" : "🔔 Takip et");
    w.title = "Çevrimiçi olunca veya oyuna girince bildirim al";
    w.onclick = () => { if (cfg.watch[u.id]) delete cfg.watch[u.id]; else cfg.watch[u.id] = true; saveCfg(); w.textContent = cfg.watch[u.id] ? "🔕 Takibi bırak" : "🔔 Takip et"; toast(cfg.watch[u.id] ? "Takip ediliyor" : "Takip bırakıldı"); };
    dl.append(w);
  }
  sec.append(dl);
  const btn = body.querySelector(".pc-dm");
  if (btn) btn.before(sec); else body.append(sec);
}

/* İsim/avatar geçmişi: arkadaşların anlık görüntüsünü saklayıp farkları kaydeder. */
function trackUser(u) {
  if (!u?.id || (!u.username && u.avatar === undefined)) return;
  const snap = lsGet("shion.snap", {});
  const old = snap[u.id];
  const now = { n: u.username ?? old?.n, g: u.global_name !== undefined ? u.global_name : old?.g, a: u.avatar !== undefined ? u.avatar : old?.a };
  if (old) {
    const hist = lsGet("shion.hist", {});
    const add = (k, from, to) => { (hist[u.id] ||= []).push({ t: Date.now(), k, from, to }); if (hist[u.id].length > 30) hist[u.id].shift(); };
    let ch = false;
    if (now.n !== old.n) { add("kullanıcı adı", old.n, now.n); ch = true; }
    if (now.g !== old.g) { add("görünen ad", old.g, now.g); ch = true; }
    if (now.a !== old.a) { add("avatar", null, null); ch = true; }
    if (ch) lsSet("shion.hist", hist);
  }
  snap[u.id] = now; lsSet("shion.snap", snap);
}
function trackFriends() { for (const f of S.friends) if (f.type === 1) trackUser(f.user); }

/* Takip edilen arkadaş bildirimleri */
const lastPres = new Map();
const gameOf = (p) => (p?.activities || []).find((a) => a.type === 0)?.name || null;
const isOnline = (st) => st && !["offline", "invisible"].includes(st);
listen("gw-ready", () => setTimeout(() => { for (const f of S.friends) lastPres.set(f.id, f.presence || {}); trackFriends(); }, 1500));
listen("friends", () => setTimeout(trackFriends, 100));
listen("presence", (e) => {
  const { user_id, status, activities, user } = e.payload;
  if (user) trackUser(user);
  const prev = lastPres.get(user_id) || {};
  const cur = { status, activities };
  lastPres.set(user_id, cur);
  if (!cfg.watch[user_id] || cfg.status === "dnd") return;
  const f = S.friends.find((x) => x.id === user_id); if (!f) return;
  const name = dname(f.user);
  if (!isOnline(prev.status) && isOnline(status)) notify("👋 " + name, "çevrimiçi oldu");
  const g = gameOf(cur);
  if (g && g !== gameOf(prev)) notify("🎮 " + name, g + " oynamaya başladı");
});

/* ------------------------------------------------------------------ */
/* Ses kanalı kaydı                                                    */
/* ------------------------------------------------------------------ */
const VCLOG = [];
function vcName(gid, cid) { return S.guilds.find((g) => g.id === gid)?.channels.find((c) => c.id === cid)?.name || "?"; }
listen("voice-state", (e) => {
  const v = e.payload;
  if (!v.guild_id) return;
  const from = v.prev_channel_id || null, to = v.channel_id || null;
  if (from === to) return;
  const kind = !from ? "join" : !to ? "leave" : "move";
  VCLOG.push({ t: Date.now(), gid: v.guild_id, uid: v.user_id, user: v.user, nick: v.nick, from, to, kind });
  if (VCLOG.length > 500) VCLOG.shift();
  // Bulunduğum kanala giren / çıkan
  const mine = S.vc.channel_id && S.vc.state === "connected" && v.user_id !== S.me?.id && (to === S.vc.channel_id || from === S.vc.channel_id);
  if (mine && cfg.vcNotify) toast(`${to === S.vc.channel_id ? "🔊 Katıldı" : "🔈 Ayrıldı"}: ${v.nick || dname(v.user)}`);
  if ($("#vclog-list")) renderVcLog();
});
function renderVcLog(gid = renderVcLog.gid) {
  const box = $("#vclog-list"); if (!box) return;
  const list = VCLOG.filter((x) => !gid || x.gid === gid).slice(-200).reverse();
  box.innerHTML = list.length ? list.map((x) => {
    const t = new Date(x.t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const who = `<b>${esc(x.nick || dname(x.user))}</b>`;
    const what = x.kind === "join" ? `🟢 ${who} → <i>${esc(vcName(x.gid, x.to))}</i>` : x.kind === "leave" ? `🔴 ${who} ← <i>${esc(vcName(x.gid, x.from))}</i>` : `🔁 ${who} <i>${esc(vcName(x.gid, x.from))}</i> → <i>${esc(vcName(x.gid, x.to))}</i>`;
    return `<div class="vcl-row"><span class="muted">${t}</span> ${what}</div>`;
  }).join("") : '<p class="muted">Henüz kayıt yok. Shion açıkken ses kanallarına giren/çıkanlar burada listelenir.</p>';
}
function openVcLog(gid) {
  renderVcLog.gid = gid;
  const box = h("div"); const l = h("div", "vclog scroll"); l.id = "vclog-list"; box.append(l);
  openModal("Ses kanalı kaydı" + (gid ? " — " + (S.guilds.find((g) => g.id === gid)?.name || "") : ""), box);
  renderVcLog(gid);
}

/* ------------------------------------------------------------------ */
/* Anahtar kelime bildirimleri                                         */
/* ------------------------------------------------------------------ */
const KW_HITS = [];
listen("unread", (e) => {
  const p = e.payload;
  if (!p.keyword || isMuted(p.channel_id, p.guild_id)) return;
  KW_HITS.unshift({ ...p, t: Date.now() }); if (KW_HITS.length > 50) KW_HITS.pop();
  S.mentions.set(p.channel_id, (S.mentions.get(p.channel_id) || 0) + 1);
  if (cfg.notify && cfg.status !== "dnd") notify(`🔔 "${p.keyword}" — ${p.where}`, `${p.author}: ${p.content}`);
});
function openKeywordHits() {
  const box = h("div", "kw-hits");
  if (!KW_HITS.length) box.append(h("p", "muted", "Bu oturumda eşleşme yok."));
  for (const x of KW_HITS) {
    const r = h("div", "kw-row", `<small class="muted">${esc(x.where)} · ${new Date(x.t).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} · <b>${esc(x.keyword)}</b></small><div><b>${esc(x.author)}:</b> ${esc(x.content)}</div>`);
    r.onclick = () => { closeModal(); jumpToMessage(x.channel_id, x.message_id, x.guild_id); };
    box.append(r);
  }
  openModal("Anahtar kelime eşleşmeleri", box);
}

/* ------------------------------------------------------------------ */
/* Taslaklar                                                           */
/* ------------------------------------------------------------------ */
function saveDraft() {
  if (!S.channel) return;
  const v = $("#input").value.trim() ? $("#input").value : undefined;
  if (cfg.drafts[S.channel.id] === v) return; // degisiklik yoksa ayarlari yazma
  if (v) cfg.drafts[S.channel.id] = v; else delete cfg.drafts[S.channel.id];
  saveCfg();
}
function restoreDraft(c) {
  const i = $("#input");
  i.value = cfg.drafts[c.id] || "";
  autoGrow();
}
let draftTimer = null;
$("#input").addEventListener("input", () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 600); });
window.addEventListener("beforeunload", saveDraft);
const hasDraft = (cid) => !!cfg.drafts[cid] && S.channel?.id !== cid;

/* ------------------------------------------------------------------ */
/* Zamanlanmış mesajlar                                                */
/* ------------------------------------------------------------------ */
const pad2 = (n) => String(n).padStart(2, "0");
const localInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
function openScheduler() {
  if (!S.channel) return;
  const box = h("div", "new-post sched");
  const ta = h("textarea", "inp"); ta.rows = 3; ta.value = $("#input").value; ta.placeholder = "Mesaj";
  const at = h("input", "inp"); at.type = "datetime-local"; at.value = localInput(Date.now() + 3600000); at.min = localInput(Date.now());
  const quick = h("div", "sched-quick");
  for (const [l, ms] of [["10 dk", 600000], ["1 saat", 3600000], ["Yarın 09:00", null]]) {
    const b = h("button", "btn small", l);
    b.onclick = () => { let t = Date.now() + (ms || 0); if (!ms) { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); t = +d; } at.value = localInput(t); };
    quick.append(b);
  }
  const ok = h("button", "btn primary", "⏰ Zamanla");
  ok.onclick = () => {
    const when = new Date(at.value).getTime();
    if (!ta.value.trim()) return toast("Mesaj boş");
    if (!(when > Date.now())) return toast("Gelecekte bir zaman seç");
    cfg.scheduled.push({ id: Date.now() + "" + Math.random().toString(36).slice(2, 6), channel_id: S.channel.id, where: ($("#ch-icon").textContent || "") + S.channel.name, content: ta.value.trim(), at: when });
    saveCfg(); closeModal();
    if ($("#input").value.trim() === ta.value.trim()) { $("#input").value = ""; autoGrow(); saveDraft(); }
    toast("⏰ " + new Date(when).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) + " için zamanlandı");
  };
  box.append(ta, at, quick, ok);
  if (cfg.scheduled.length) {
    box.append(h("h4", null, "Bekleyenler"));
    for (const x of [...cfg.scheduled].sort((a, b) => a.at - b.at)) {
      const r = h("div", "sched-row", `<div><small class="muted">${esc(x.where)} · ${new Date(x.at).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}</small><div>${esc(x.content.slice(0, 140))}</div></div>`);
      const del = h("button", "icon-btn", "✕"); del.title = "İptal";
      del.onclick = () => { cfg.scheduled = cfg.scheduled.filter((y) => y.id !== x.id); saveCfg(); r.remove(); };
      r.append(del); box.append(r);
    }
  }
  box.append(h("p", "muted", "<small>Shion açık değilse, zamanı geçen mesajlar bir sonraki açılışta gönderilir.</small>"));
  openModal("Zamanlanmış mesaj", box);
  ta.focus();
}
$("#sched-btn").onclick = openScheduler;
let schedBusy = false;
async function runScheduled() {
  if (schedBusy || !S.me) return;
  const due = cfg.scheduled.filter((x) => x.at <= Date.now());
  if (!due.length) return;
  schedBusy = true;
  for (const x of due) {
    try {
      await invoke("send_message", { channelId: x.channel_id, content: prepareOutgoing(x.content).content, replyTo: null, files: [] });
      cfg.scheduled = cfg.scheduled.filter((y) => y.id !== x.id); saveCfg();
      toast("⏰ Zamanlanmış mesaj gönderildi: " + x.where);
    } catch (e) {
      x.fails = (x.fails || 0) + 1;
      if (x.fails >= 3) { cfg.scheduled = cfg.scheduled.filter((y) => y.id !== x.id); toast("⏰ Gönderilemedi, iptal edildi: " + e); }
      saveCfg();
    }
  }
  schedBusy = false;
}
setInterval(runScheduled, 5000);
listen("gw-ready", () => setTimeout(runScheduled, 3000));

/* ------------------------------------------------------------------ */
/* Oyun aktivitesi                                                     */
/* ------------------------------------------------------------------ */
S.game = null;
listen("game", (e) => {
  S.game = e.payload || null;
  if (S.game) toast("🎮 Profilinde görünüyor: " + S.game);
  renderMe();
});

/* ------------------------------------------------------------------ */
/* Kanal yedekleme                                                     */
/* ------------------------------------------------------------------ */
async function exportChannel(c) {
  const name = c.guild_id ? `${S.guilds.find((g) => g.id === c.guild_id)?.name || "sunucu"} - ${c.name}` : c.name || "DM";
  const box = h("div", "new-post");
  box.append(h("p", null, `<b>${esc(name)}</b> kanalının <b>tüm</b> geçmişi indirilecek. Büyük kanallarda birkaç dakika sürebilir.`));
  const fmt = h("select", "inp"); fmt.innerHTML = `<option value="html">HTML (tarayıcıda okunur)</option><option value="json">JSON (ham veri)</option>`;
  const prog = h("p", "muted", ""); const go = h("button", "btn primary", "⬇ Dışa aktar");
  box.append(fmt, go, prog);
  openModal("Kanalı yedekle", box);
  let un = null;
  go.onclick = async () => {
    go.disabled = true; fmt.disabled = true; prog.textContent = "Başlıyor…";
    const cancel = h("button", "btn", "İptal"); cancel.onclick = () => invoke("cancel_export"); box.append(cancel);
    un = await listen("export-progress", (e) => { prog.textContent = `${e.payload.toLocaleString("tr-TR")} mesaj alındı…`; });
    try {
      const p = await invoke("export_channel", { channelId: c.id, name, format: fmt.value });
      prog.innerHTML = `✅ Kaydedildi:<br><small>${esc(p)}</small>`;
    } catch (e) { prog.textContent = e === "iptal" ? "İptal edildi" : "Hata: " + e; }
    finally { un?.(); cancel.remove(); go.disabled = false; fmt.disabled = false; }
  };
}

/* ------------------------------------------------------------------ */
/* Menü ve ayar kancaları                                              */
/* ------------------------------------------------------------------ */
function plusChannelItems(c, gid) {
  return [{ label: "⬇ Kanalı yedekle", fn: () => exportChannel({ ...c, guild_id: gid || null, name: c.name || dname(c.recipients?.[0]) }) }];
}
function plusGuildItems(g) {
  return [{ label: "🔊 Ses kanalı kaydı", fn: () => openVcLog(g.id) }];
}

function plusSettings(root, sec, toggle) {
  updateSection(root);
  const ms = micTestSection(root);
  // hassasiyet kaydırıcısı değişince eşik çizgisini güncelle
  root.addEventListener("input", () => ms._setThr());
  const st = sec("Ekran paylaşımı");
  const qr = h("div", "row", `<label>Yayın kalitesi<small>Büyük ekranlar bu boyuta küçültülür. Yavaş internette 720p seç.</small></label>`);
  const qs = h("select", "inp"); qs.style.maxWidth = "200px";
  qs.innerHTML = `<option value="720">720p 30 fps</option><option value="1080">1080p 30 fps</option><option value="1080-60">1080p 60 fps</option>`;
  qs.value = cfg.screenQuality; qs.onchange = () => { cfg.screenQuality = qs.value; saveCfg(); applyScreenPreset(); toast("Bir sonraki yayında uygulanır"); };
  qr.append(qs); st.append(qr);
  toggle(st, "streamAudio", "Bilgisayar sesini paylaş", "Yayında oyun/müzik sesi de gider (sesli sohbet hariç tutulur)");
  const s = sec("Ekstra");
  toggle(s, "noise", "Gürültü engelleme 🎧", "Mikrofondaki klavye, fan ve arka plan sesini temizler (RNNoise, cihazında çalışır)", () => invoke("set_noise", { on: cfg.noise }).catch(() => {}));
  toggle(s, "fakeNitro", "FakeNitro ✨", "Nitro'n yoksa başka sunucuların / animasyonlu emojileri ve çıkartmaları bağlantı olarak gönderir", () => {});
  toggle(s, "gameDetect", "Oyun aktivitesi 🎮", "Açık oyunu algılayıp profilinde \"Oynuyor\" olarak gösterir", () => invoke("set_game_detect", { on: cfg.gameDetect }).catch(() => {}));
  toggle(s, "vcNotify", "Ses kanalı bildirimleri", "Bulunduğun ses kanalına biri girince/çıkınca küçük bildirim");
  const kr = h("div", "row col", `<label>Anahtar kelimeler 🔔<small>Herhangi bir kanalda bu kelimeler geçince (etiketlenmesen de) bildirim al. Virgülle ayır.</small></label>`);
  const ki = h("input", "inp"); ki.value = cfg.keywords.join(", "); ki.placeholder = "örn. shion, maç, adım";
  ki.onchange = () => { cfg.keywords = ki.value.split(",").map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 50); saveCfg(); invoke("set_keywords", { words: cfg.keywords }).catch(() => {}); toast("Anahtar kelimeler kaydedildi"); };
  const kb = h("button", "btn", "Eşleşmeler"); kb.onclick = openKeywordHits;
  const kw = h("div", "kw-line"); kw.append(ki, kb); kr.append(kw); s.append(kr);
  const w = Object.keys(cfg.watch).length;
  const wr = h("div", "row", `<label>Takip edilen arkadaşlar<small>${w} kişi (profil kartından 🔔 Takip et)</small></label>`);
  const wb = h("button", "btn", "Hepsini bırak"); wb.disabled = !w; wb.onclick = () => { cfg.watch = {}; saveCfg(); wb.disabled = true; };
  wr.append(wb); s.append(wr);
  const ar = h("div", "row", `<label>Hesaplar<small>Kayıtlı hesaplar arasında geçiş yap ya da yeni hesap ekle</small></label>`);
  const ab = h("button", "btn", "👥 Hesaplar"); ab.onclick = openAccounts; ar.append(ab); s.append(ar);
}

/* ------------------------------------------------------------------ */
/* Kişi başı ses seviyesi                                              */
/* ------------------------------------------------------------------ */
function voiceUserItems(u) {
  if (!u || u.id === S.me?.id) return [];
  const v = S.vstates.get(u.id);
  if (!v?.channel_id) return [];
  const pct = Math.round((cfg.userVol[u.id] ?? 1) * 100);
  return [{ label: `🔊 Ses seviyesi (%${pct})`, fn: () => openUserVolume(u) },
    { label: cfg.userVol[u.id] === 0 ? "🔈 Yerel susturmayı kaldır" : "🔇 Yerel olarak sustur", fn: () => setUserVolume(u.id, cfg.userVol[u.id] === 0 ? 1 : 0) }, "-"];
}
function setUserVolume(id, v) {
  if (Math.abs(v - 1) < 0.01) delete cfg.userVol[id]; else cfg.userVol[id] = v;
  saveCfg();
  invoke("set_user_volume", { userId: id, volume: v }).catch(() => {});
  document.querySelectorAll(`.vuser[data-uid="${id}"]`).forEach((el) => el.classList.toggle("local-muted", v === 0));
}
function openUserVolume(u) {
  const box = h("div", "uvol");
  const cur = Math.round((cfg.userVol[u.id] ?? 1) * 100);
  box.innerHTML = `<div class="uvol-head"><img src="${avatarUrl(u, 64)}"><b>${esc(dname(u))}</b><span class="uvol-val">%${cur}</span></div>`;
  const r = h("input"); r.type = "range"; r.min = 0; r.max = 200; r.step = 5; r.value = cur;
  r.oninput = () => { box.querySelector(".uvol-val").textContent = "%" + r.value; setUserVolume(u.id, r.value / 100); };
  const reset = h("button", "btn small", "Sıfırla (%100)"); reset.onclick = () => { r.value = 100; r.oninput(); };
  box.append(r, reset, h("p", "muted", "<small>Sadece senin duyduğun sesi değiştirir; Shion açıldığında hatırlanır.</small>"));
  openModal("Kullanıcı ses seviyesi", box);
}
// Yerel susturulanları ses listesinde işaretle
new MutationObserver(() => {
  for (const [id, v] of Object.entries(cfg.userVol)) if (v === 0) document.querySelectorAll(`.vuser[data-uid="${id}"]:not(.local-muted)`).forEach((el) => el.classList.add("local-muted"));
}).observe(document.body, { childList: true, subtree: true });

/* ------------------------------------------------------------------ */
/* Mikrofon testi                                                      */
/* ------------------------------------------------------------------ */
let micTestOn = false;
function micTestSection(root) {
  const s = h("div", "set-section", "<h3>Mikrofon testi</h3>");
  const meter = h("div", "mic-meter", '<i class="lvl"></i><i class="thr"></i>');
  const row = h("div", "row");
  const lb = h("label", null, "Konuş ve seviyeyi izle<small>Yeşil çizgiyi geçen ses iletilir (hassasiyet ayarı). Kulaklık takılıysa kendi sesini de duyarsın.</small>");
  const pb = h("label", "check", '<input type="checkbox"> Kendi sesimi duy');
  const btn = h("button", "btn", "▶ Testi başlat");
  const setThr = () => { meter.querySelector(".thr").style.left = Math.min(100, dbPct(cfg.threshold)) + "%"; };
  setThr();
  btn.onclick = async () => {
    if (micTestOn) return stopMicTest(btn);
    if (S.vc.state === "connected") return toast("Sesli kanaldayken test yapılamaz");
    btn.disabled = true;
    try {
      await invoke("mic_test", { on: true, playback: pb.querySelector("input").checked });
      micTestOn = true; btn.textContent = "■ Testi durdur";
    } catch (e) { toast("Mikrofon: " + e); }
    btn.disabled = false;
  };
  row.append(lb, pb, btn); s.append(row, meter);
  s._setThr = setThr;
  root.append(s);
  // modal kapanınca testi durdur
  const obs = new MutationObserver(() => { if (!s.isConnected || $("#modal").classList.contains("hidden")) { obs.disconnect(); stopMicTest(btn); } });
  obs.observe($("#modal"), { attributes: true, attributeFilter: ["class"] });
  return s;
}
// -60 dB .. 0 dB -> %0..100
const dbPct = (rms) => Math.max(0, Math.min(100, (20 * Math.log10(Math.max(rms, 1e-6)) + 60) / 60 * 100));
function stopMicTest(btn) {
  if (!micTestOn) return;
  micTestOn = false;
  invoke("mic_test", { on: false, playback: false }).catch(() => {});
  if (btn) btn.textContent = "▶ Testi başlat";
  const l = $(".mic-meter .lvl"); if (l) l.style.width = "0";
}
listen("mic-level", (e) => {
  const m = $(".mic-meter"); if (!m) return;
  m.querySelector(".lvl").style.width = dbPct(e.payload.rms) + "%";
  m.classList.toggle("on", !!e.payload.speaking);
});

/* ------------------------------------------------------------------ */
/* Otomatik güncelleme                                                 */
/* ------------------------------------------------------------------ */
const UPD = { info: null, busy: false };
async function checkUpdate(manual) {
  try {
    const u = await invoke("check_update");
    UPD.info = u;
    if (u) showUpdateBar(u);
    else if (manual) toast("Shion güncel ✅");
    return u;
  } catch (e) { if (manual) toast("Güncelleme denetlenemedi: " + e); return null; }
}
function showUpdateBar(u) {
  let bar = $("#update-bar");
  if (!bar) { bar = h("div", "update-bar"); bar.id = "update-bar"; document.body.append(bar); }
  bar.innerHTML = `<span>✨ Shion <b>${esc(u.version)}</b> hazır</span>`;
  const go = h("button", "btn primary small", "Güncelle ve yeniden başlat");
  const later = h("button", "btn small", "Sonra");
  later.onclick = () => bar.remove();
  go.onclick = () => installUpdate(bar);
  bar.append(go, later);
}
async function installUpdate(bar) {
  if (UPD.busy) return; UPD.busy = true;
  const msg = bar?.querySelector("span");
  const un = await listen("update-progress", (e) => {
    const { got, total } = e.payload;
    if (msg) msg.textContent = total ? `İndiriliyor… %${Math.round(got / total * 100)}` : `İndiriliyor… ${(got / 1048576).toFixed(1)} MB`;
  });
  try { saveDraft(); await invoke("install_update"); }
  catch (e) { toast("Güncellenemedi: " + e); if (msg) msg.textContent = "Güncelleme başarısız"; }
  finally { un(); UPD.busy = false; }
}
let updChecked = false;
listen("gw-ready", () => { if (updChecked) return; updChecked = true; setTimeout(() => checkUpdate(false), 8000); });
setInterval(() => checkUpdate(false), 6 * 3600 * 1000);
function updateSection(root) {
  const s = h("div", "set-section", "<h3>Güncelleme</h3>");
  const r = h("div", "row", `<label>Shion sürümü <b class="ver">…</b><small>Yeni sürümler GitHub'dan imzalı olarak iner (kyles-arch/shion)</small></label>`);
  invoke("app_version").then((v) => { r.querySelector(".ver").textContent = v; }).catch(() => {});
  const b = h("button", "btn", "Güncellemeleri denetle");
  b.onclick = async () => { b.disabled = true; await checkUpdate(true); b.disabled = false; };
  r.append(b); s.append(r); root.append(s);
}
