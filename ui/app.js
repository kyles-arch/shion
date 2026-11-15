"use strict";
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CDN = "https://cdn.discordapp.com";
const EPOCH = 1420070400000n;
const snowTime = (id) => { try { return Number((BigInt(id) >> 22n) + EPOCH); } catch { return Date.now(); } };

/* ------------------------------------------------------------------ */
/* Ayarlar                                                             */
/* ------------------------------------------------------------------ */
const THEMES = [
  ["gece", "Gece"], ["klasik", "Klasik Koyu"], ["amoled", "AMOLED"], ["nord", "Nord"], ["dracula", "Dracula"],
  ["mocha", "Mocha"], ["rose", "Rosé"], ["tokyo", "Tokyo Gecesi"], ["neon", "Neon"], ["sakura", "Sakura"], ["acik", "Açık"], ["aurora", "Aurora ✨"], ["cam", "Cam 🫧"],
];
const DEFAULTS = { theme: "gece", accent: "", showHidden: true, logger: true, showEdits: true, compact: false, noAnim: false, showMembers: true,
  muted: false, deafened: false, inputDevice: "", outputDevice: "", threshold: 0.012, volume: 1, status: "online", notify: true, rail: null, fontSize: 15, customCss: "", collapsed: [],
  ghostTyping: false, ptt: false, pttKey: "", tray: false, translateTo: "tr", bookmarks: [], nicknames: {} };
let cfg = { ...DEFAULTS };
try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("shion.cfg") || "{}") }; } catch {}
const saveCfg = () => { try { localStorage.setItem("shion.cfg", JSON.stringify(cfg)); } catch {} };

function applyCfg() {
  document.documentElement.dataset.theme = cfg.theme;
  const root = document.documentElement.style;
  if (cfg.accent) root.setProperty("--accent", cfg.accent); else root.removeProperty("--accent");
  root.setProperty("--fs", cfg.fontSize + "px");
  document.body.classList.toggle("compact", cfg.compact);
  document.body.classList.toggle("no-anim", cfg.noAnim);
  $("#custom-css").textContent = cfg.customCss || "";
}
applyCfg();

/* ------------------------------------------------------------------ */
/* Durum                                                               */
/* ------------------------------------------------------------------ */
const S = {
  me: null, guilds: [], dms: [], view: "home", // "home" | guildId
  channel: null, // {id, guild_id, name, type, hidden, can_send}
  msgs: [], replyTo: null, loadingOlder: false, noMore: false,
  unread: new Set(), mentions: new Map(), logCount: 0,
  typers: new Map(), files: [], members: { guild: null, items: [] },
  vstates: new Map(), // user_id -> ses durumu
  vc: { state: "disconnected", guild_id: null, channel_id: null, e2ee: false, privacy: null, speaking: new Set() },
  folders: null,
  readStates: {}, friends: [], mutedGuilds: new Set(), mutedChannels: new Set(), detached: false,
};
const collapsed = new Set(cfg.collapsed);

const avatarUrl = (u, size = 80) => {
  if (!u) return `${CDN}/embed/avatars/0.png`;
  if (u.avatar) return `${CDN}/avatars/${u.id}/${u.avatar}.webp?size=${size}`;
  try { return `${CDN}/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`; } catch { return `${CDN}/embed/avatars/0.png`; }
};
const dname = (u) => (u && cfg.nicknames?.[u.id]) || u?.global_name || u?.username || "Bilinmeyen";
const fmtTime = (iso) => {
  const d = new Date(iso), now = new Date();
  const t = d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return "Bugün " + t;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Dün " + t;
  return d.toLocaleDateString("tr-TR") + " " + t;
};
const intColor = (n) => (n ? "#" + n.toString(16).padStart(6, "0") : null);

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ------------------------------------------------------------------ */
/* Markdown                                                            */
/* ------------------------------------------------------------------ */
function userName(id, m) {
  const u = m?.mentions?.find((x) => x.id === id);
  if (u) return dname(u);
  if (S.me && S.me.id === id) return dname(S.me);
  return "kullanıcı";
}
function findChannel(id) {
  for (const g of S.guilds) { const c = g.channels.find((x) => x.id === id); if (c) return c; }
  return null;
}
function md(text, m) {
  if (!text) return "";
  const hold = [];
  const put = (html) => `\u0000${hold.push(html) - 1}\u0000`;
  let s = text
    .replace(/```(?:[\w+-]+\n)?([\s\S]*?)```/g, (_, c) => put(`<pre><code>${esc(c.replace(/^\n+|\n+$/g, ""))}</code></pre>`))
    .replace(/`([^`\n]+)`/g, (_, c) => put(`<code>${esc(c)}</code>`));
  s = esc(s);
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => put(`<a href="${u}">${t}</a>`));
  s = s.replace(/https?:\/\/[^\s<]+[^\s<.,:;"')\]]/g, (u) => {
    let tail = ""; const i = u.indexOf("&gt;"); if (i >= 0) { tail = u.slice(i); u = u.slice(0, i); }
    return put(`<a href="${u}">${u}</a>`) + tail;
  });
  s = s
    .replace(/&lt;@!?(\d+)&gt;/g, (_, id) => put(`<span class="mention">@${esc(userName(id, m))}</span>`))
    .replace(/&lt;@&amp;(\d+)&gt;/g, (_, id) => {
      const g = S.guilds.find((g) => g.roles?.[id]); const r = g?.roles[id];
      const col = intColor(r?.color);
      return put(`<span class="mention"${col ? ` style="color:${col};background:${col}22"` : ""}>@${esc(r?.name ?? "rol")}</span>`);
    })
    .replace(/&lt;#(\d+)&gt;/g, (_, id) => put(`<span class="mention">#${esc(findChannel(id)?.name ?? "kanal")}</span>`))
    .replace(/&lt;(a?):(\w+):(\d+)&gt;/g, (_, a, n, id) => put(`<img class="emoji" src="${CDN}/emojis/${id}.${a ? "gif" : "webp"}?size=48" alt=":${n}:" title=":${n}:">`))
    .replace(/&lt;t:(-?\d+)(?::[tTdDfFR])?&gt;/g, (_, t) => put(`<span class="ts">${new Date(t * 1000).toLocaleString("tr-TR")}</span>`))
    .replace(/@(everyone|here)/g, (_, w) => put(`<span class="mention">@${w}</span>`));
  s = s
    .replace(/\*\*(.+?)\*\*/gs, "<b>$1</b>")
    .replace(/__(.+?)__/gs, "<u>$1</u>")
    .replace(/\*(?!\s)(.+?)\*/gs, "<i>$1</i>")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?![\w])/gs, "$1<i>$2</i>")
    .replace(/~~(.+?)~~/gs, "<s>$1</s>")
    .replace(/\|\|(.+?)\|\|/gs, '<span class="spoiler">$1</span>')
    .replace(/^#{1,3} (.+)$/gm, "<h3>$1</h3>")
    .replace(/^&gt; (.*)$/gm, "<blockquote>$1</blockquote>")
    .replace(/<\/blockquote>\n<blockquote>/g, "<br>")
    .replace(/(<\/h3>|<\/blockquote>)\n/g, "$1");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[i]);
}

/* ------------------------------------------------------------------ */
/* Kenar cubugu: sunucular ve kanallar                                 */
/* ------------------------------------------------------------------ */
function guildAcr(name) { return name.split(/\s+/).map((w) => w[0]).join("").slice(0, 3); }

const guildUnread = (g) => g.channels.some((c) => S.unread.has(c.id)) || (g.threads || []).some((t) => S.unread.has(t.id));
const guildMentions = (g) => g.channels.reduce((a, c) => a + (S.mentions.get(c.id) || 0), 0) + (g.threads || []).reduce((a, t) => a + (S.mentions.get(t.id) || 0), 0);
const guildIcon = (g, size = 96) => (g.icon ? `${CDN}/icons/${g.id}/${g.icon}.webp?size=${size}` : null);

function guildBtn(g) {
  const b = h("button", "rail-btn" + (S.view === g.id ? " active" : ""));
  b.title = g.name;
  const icon = guildIcon(g);
  if (icon) b.innerHTML = `<img loading="lazy" src="${icon}" alt="">`;
  else b.textContent = guildAcr(g.name);
  if (guildUnread(g) && S.view !== g.id) b.classList.add("unread");
  if (S.mutedGuilds.has(g.id)) b.classList.add("muted-g");
  const mc = guildMentions(g);
  if (mc) b.append(h("span", "badge", mc));
  b.onclick = () => openGuild(g.id);
  b.oncontextmenu = (e) => { e.preventDefault(); guildMenu(e, g); };
  b.draggable = true;
  b.dataset.gid = g.id;
  setupDrag(b, { type: "g", id: g.id });
  return b;
}

function folderEl(f) {
  const wrap = h("div", "folder" + (f.open ? " open" : ""));
  if (f.color) wrap.style.setProperty("--fc", f.color);
  const gs = f.guilds.map((id) => S.guilds.find((g) => g.id === id)).filter(Boolean);
  if (!gs.length) return document.createDocumentFragment();
  const btn = h("button", "rail-btn folder-btn");
  btn.title = f.name || "Klasör";
  if (f.open) btn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="currentColor"/></svg>`;
  else {
    for (const g of gs.slice(0, 4)) {
      const icon = guildIcon(g, 32);
      btn.append(icon ? Object.assign(h("img"), { src: icon, loading: "lazy" }) : h("span", "mini", esc(guildAcr(g.name).slice(0, 2))));
    }
    if (gs.some((g) => guildUnread(g))) btn.classList.add("unread");
    const mc = gs.reduce((a, g) => a + guildMentions(g), 0);
    if (mc) btn.append(h("span", "badge", mc));
  }
  btn.onclick = () => { f.open = !f.open; saveCfg(); renderRail(); };
  btn.oncontextmenu = (e) => { e.preventDefault(); folderMenu(e, f); };
  btn.draggable = true;
  setupDrag(btn, { type: "f", id: f.id });
  wrap.append(btn);
  if (f.open) gs.forEach((g) => wrap.append(guildBtn(g)));
  return wrap;
}

/* Sunucu klasorleri: cfg.rail = [{type:"g",id} | {type:"f",id,name,color,open,guilds:[]}] */
function normalizeRail() {
  if (!S.guilds.length) { if (!Array.isArray(cfg.rail)) cfg.rail = []; return; }
  // Henuz yuklenmemis sunucular (gec gelen GUILD_CREATE) klasorden silinmesin diye bilinmeyen ID'ler korunur
  const ids = { has: () => true };
  let rail = Array.isArray(cfg.rail) ? cfg.rail : null;
  if (!rail || !rail.length) {
    rail = [];
    for (const f of Array.isArray(S.folders) ? S.folders : []) {
      const gids = (f.guild_ids || []).map(String);
      if (f.id != null && gids.length > 1) rail.push({ type: "f", id: String(f.id), name: f.name || "Klasör", color: f.color ? intColor(f.color) : null, open: false, guilds: gids });
      else gids.forEach((id) => rail.push({ type: "g", id }));
    }
  }
  const seen = new Set(), out = [];
  for (const it of rail) {
    if (it.type === "f") {
      const gs = (it.guilds || []).filter((g) => ids.has(g) && !seen.has(g));
      gs.forEach((g) => seen.add(g));
      if (gs.length) out.push({ ...it, guilds: gs });
    } else if (ids.has(it.id) && !seen.has(it.id)) { seen.add(it.id); out.push(it); }
  }
  // Yeni katilinan sunucular en uste
  for (const g of [...S.guilds].reverse()) if (!seen.has(g.id)) out.unshift({ type: "g", id: g.id });
  cfg.rail = out; saveCfg();
}

let dragItem = null;
function dropZone(e, el) {
  const r = el.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  return y < 0.25 ? "before" : y > 0.75 ? "after" : "merge";
}
function clearDropMarks() { document.querySelectorAll(".drop-before,.drop-after,.drop-merge").forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-merge")); }
function setupDrag(el, item) {
  el.addEventListener("dragstart", (e) => { dragItem = item; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "shion"); e.stopPropagation(); });
  el.addEventListener("dragend", () => { dragItem = null; clearDropMarks(); });
  el.addEventListener("dragover", (e) => {
    if (!dragItem || (dragItem.type === item.type && dragItem.id === item.id)) return;
    e.preventDefault(); e.stopPropagation();
    clearDropMarks();
    let z = dropZone(e, el);
    if (z === "merge" && dragItem.type === "f" && item.type === "g" && railFind(item.id).folder) z = "after";
    el.classList.add("drop-" + z);
  });
  el.addEventListener("drop", (e) => {
    if (!dragItem) return;
    e.preventDefault(); e.stopPropagation();
    const z = dropZone(e, el); clearDropMarks();
    railMove(dragItem, item, z); dragItem = null;
  });
}
function railFind(gid) {
  for (let i = 0; i < cfg.rail.length; i++) {
    const it = cfg.rail[i];
    if (it.type === "g" && it.id === gid) return { index: i, folder: null };
    if (it.type === "f") { const j = it.guilds.indexOf(gid); if (j >= 0) return { index: i, folder: it, sub: j }; }
  }
  return { index: -1, folder: null };
}
function railMove(src, dst, zone) {
  const rail = cfg.rail;
  // Kaynagi cikar
  let moving;
  if (src.type === "f") { const i = rail.findIndex((x) => x.type === "f" && x.id === src.id); moving = rail.splice(i, 1)[0]; }
  else {
    const loc = railFind(src.id);
    if (loc.folder) loc.folder.guilds.splice(loc.sub, 1); else rail.splice(loc.index, 1);
    moving = { type: "g", id: src.id };
  }
  const movingGuilds = moving.type === "f" ? moving.guilds : [moving.id];
  if (dst.type === "f") {
    const i = rail.findIndex((x) => x.type === "f" && x.id === dst.id);
    if (zone === "merge") rail[i].guilds.push(...movingGuilds);
    else rail.splice(zone === "before" ? i : i + 1, 0, moving);
  } else {
    const loc = railFind(dst.id);
    if (loc.folder) {
      if (moving.type === "f") rail.splice(loc.index + 1, 0, moving);
      else loc.folder.guilds.splice(zone === "before" ? loc.sub : loc.sub + 1, 0, ...movingGuilds);
    } else if (zone === "merge") {
      rail[loc.index] = { type: "f", id: "f" + Date.now(), name: "Yeni klasör", color: null, open: true, guilds: [dst.id, ...movingGuilds] };
    } else rail.splice(zone === "before" ? loc.index : loc.index + 1, 0, moving);
  }
  cfg.rail = rail.filter((x) => x.type !== "f" || x.guilds.length);
  saveCfg(); renderRail();
}

/* Sag tik menuleri */
function showMenu(e, items) {
  document.querySelector(".menu")?.remove();
  const m = h("div", "menu");
  for (const it of items) {
    if (it === "-") { m.append(h("hr")); continue; }
    const b = h("button", it.danger ? "danger" : "", it.html ?? esc(it.label));
    b.onclick = () => { m.remove(); it.fn(); };
    m.append(b);
  }
  document.body.append(m);
  m.style.left = Math.min(e.clientX, innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 8) + "px";
  setTimeout(() => document.addEventListener("mousedown", function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("mousedown", off); } }), 0);
}
function markGuildRead(g) {
  g.channels.forEach((c) => { S.unread.delete(c.id); S.mentions.delete(c.id); });
  (g.threads || []).forEach((t) => { S.unread.delete(t.id); S.mentions.delete(t.id); });
  ackGuild(g);
  renderRail(); renderSidebar();
}
function guildMenu(e, g) {
  const loc = railFind(g.id);
  const items = [{ label: "Okundu olarak işaretle", fn: () => markGuildRead(g) },
    { label: S.mutedGuilds.has(g.id) ? "🔔 Sesi aç" : "🔕 Sunucuyu sessize al", fn: () => toggleMute(g.id, null) }];
  if (loc.folder) items.push({ label: "Klasörden çıkar", fn: () => { loc.folder.guilds.splice(loc.sub, 1); cfg.rail.splice(loc.index + 1, 0, { type: "g", id: g.id }); cfg.rail = cfg.rail.filter((x) => x.type !== "f" || x.guilds.length); saveCfg(); renderRail(); } });
  else items.push({ label: "Yeni klasöre koy", fn: () => { cfg.rail[loc.index] = { type: "f", id: "f" + Date.now(), name: "Yeni klasör", color: null, open: true, guilds: [g.id] }; saveCfg(); renderRail(); } });
  const folders = cfg.rail.filter((x) => x.type === "f" && x !== loc.folder);
  if (folders.length) { items.push("-"); for (const f of folders) items.push({ label: "📁 " + f.name + " klasörüne taşı", fn: () => railMove({ type: "g", id: g.id }, { type: "f", id: f.id }, "merge") }); }
  items.push(...guildExtraItems(g), ...plusGuildItems(g));
  items.push("-", { label: "Sunucu ID'sini kopyala", fn: () => { navigator.clipboard.writeText(g.id); toast("Kopyalandı"); } });
  showMenu(e, items);
}
const FOLDER_COLORS = ["#5865f2", "#7c6cff", "#eb459e", "#ed4245", "#f0b232", "#23a55a", "#1abc9c", "#3498db", "#99aab5"];
function folderMenu(e, f) {
  showMenu(e, [
    { label: "Klasörü düzenle", fn: () => editFolder(f) },
    { label: "Okundu olarak işaretle", fn: () => f.guilds.forEach((id) => { const g = S.guilds.find((x) => x.id === id); g && markGuildRead(g); }) },
    "-",
    { label: "Klasörü dağıt", danger: true, fn: () => { const i = cfg.rail.indexOf(f); cfg.rail.splice(i, 1, ...f.guilds.map((id) => ({ type: "g", id }))); saveCfg(); renderRail(); } },
  ]);
}
function editFolder(f) {
  const box = h("div", "new-post");
  const name = h("input", "inp"); name.value = f.name || ""; name.placeholder = "Klasör adı"; name.maxLength = 32;
  const colors = h("div", "color-row");
  let color = f.color;
  for (const c of [null, ...FOLDER_COLORS]) {
    const b = h("button", color === c ? "sel" : ""); b.style.background = c || "var(--bg-4)"; b.title = c || "Varsayılan";
    b.onclick = () => { color = c; colors.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); };
    colors.append(b);
  }
  const ok = h("button", "btn primary", "Kaydet");
  ok.onclick = () => { f.name = name.value.trim() || "Klasör"; f.color = color; saveCfg(); renderRail(); closeModal(); };
  box.append(name, colors, ok);
  openModal("Klasör", box); name.focus();
}

function renderRail() {
  const list = $("#guild-list"); list.textContent = "";
  normalizeRail();
  for (const it of cfg.rail) {
    if (it.type === "f") list.append(folderEl(it));
    else { const g = S.guilds.find((x) => x.id === it.id); if (g) list.append(guildBtn(g)); }
  }
  const dmMentions = S.dms.reduce((a, c) => a + (S.mentions.get(c.id) || 0), 0);
  const home = $("#home-btn");
  home.classList.toggle("active", S.view === "home");
  home.querySelector(".badge")?.remove();
  if (dmMentions) home.append(h("span", "badge", dmMentions));
  const lb = $("#log-badge");
  lb.textContent = S.logCount > 99 ? "99+" : S.logCount;
  lb.classList.toggle("hidden", !S.logCount || !cfg.logger);
}

const ICONS = { 0: "#", 2: "🔊", 4: "", 5: "📢", 10: "🧵", 11: "🧵", 12: "🧵", 13: "🎙", 15: "💬", 16: "🖼" };

function threadRow(t, parent, guildId) {
  const r = h("div", "ch thread");
  if (S.channel?.id === t.id) r.classList.add("active");
  if (S.unread.has(t.id)) r.classList.add("unread");
  r.innerHTML = `<span class="ico">🧵</span><span class="name">${esc(t.name)}</span>`;
  const mc = S.mentions.get(t.id); if (mc) r.append(h("span", "mbadge", mc));
  r.onclick = () => openChannel({ ...t, guild_id: guildId, can_send: parent.can_send, hidden: false, parent_name: parent.name });
  return r;
}
function rowWithThreads(c, g) {
  const frag = document.createDocumentFragment();
  frag.append(channelRow(c, g.id));
  if (c.type === 2 || c.type === 13) { frag.append(voiceUsers(c.id)); return frag; }
  if (c.hidden || c.type === 15 || c.type === 16) return frag;
  const ths = (g.threads || []).filter((t) => t.parent_id === c.id)
    .sort((a, b) => (BigInt(b.last_message_id || b.id) > BigInt(a.last_message_id || a.id) ? 1 : -1)).slice(0, 6);
  ths.forEach((t) => frag.append(threadRow(t, c, g.id)));
  return frag;
}
const TEXTLIKE = new Set([0, 5]);

function channelRow(c, guildId) {
  const r = h("div", "ch");
  if (c.hidden) r.classList.add("locked");
  if (S.channel?.id === c.id) r.classList.add("active");
  if (S.unread.has(c.id)) r.classList.add("unread");
  r.innerHTML = `<span class="ico">${c.hidden ? "🔒" : ICONS[c.type] ?? "#"}</span><span class="name">${esc(c.name)}</span>`;
  const mc = S.mentions.get(c.id);
  if (mc) r.append(h("span", "mbadge", mc));
  r.title = c.hidden ? "Gizli kanal — görme iznin yok" : c.topic || c.name;
  r.onclick = () => openChannel({ ...c, guild_id: guildId });
  if (S.mutedChannels.has(c.id)) r.classList.add("muted-c");
  r.oncontextmenu = (e) => { e.preventDefault(); channelMenu(e, c, guildId); };
  if ((c.type === 2 || c.type === 13) && !c.hidden) {
    const tc = h("button", "vtext", "💬"); tc.title = "Sesli kanalın sohbeti";
    tc.onclick = (e) => { e.stopPropagation(); openChannel({ ...c, guild_id: guildId, textOnly: true }); };
    r.append(tc);
  }
  return r;
}

function renderSidebar() {
  const list = $("#channel-list");
  // Yeniden cizerken kaydirma konumunu koru (eskiden liste en basa/sona atliyordu)
  const keep = list.scrollTop;
  renderSidebarInner(list);
  list.scrollTop = keep;
}
function renderSidebarInner(list) {
  list.textContent = "";
  if (S.view === "home") {
    $("#sb-title").textContent = "Direkt Mesajlar";
    list.append(friendsRow());
    for (const d of S.dms) {
      const r = h("div", "ch dm");
      if (S.channel?.id === d.id) r.classList.add("active");
      if (S.unread.has(d.id)) r.classList.add("unread");
      const name = d.name || d.recipients.map(dname).join(", ") || "Boş grup";
      const img = d.type === 3 ? (d.icon ? `${CDN}/channel-icons/${d.id}/${d.icon}.webp?size=64` : `${CDN}/embed/avatars/1.png`) : avatarUrl(d.recipients[0], 64);
      r.innerHTML = `<img class="av" loading="lazy" src="${img}"><span class="name">${esc(name)}</span>`;
      const mc = S.mentions.get(d.id); if (mc) r.append(h("span", "mbadge", mc));
      r.onclick = () => openChannel({ id: d.id, guild_id: null, name, type: d.type, hidden: false, can_send: true, dm: d });
      if (S.mutedChannels.has(d.id)) r.classList.add("muted-c");
      r.oncontextmenu = (e) => { e.preventDefault(); channelMenu(e, { id: d.id, name }, null); };
      list.append(r);
    }
    if (!S.dms.length) list.append(h("div", "muted", "<p style='padding:12px'>Hiç DM yok</p>"));
    return;
  }
  const g = S.guilds.find((x) => x.id === S.view);
  if (!g) return;
  $("#sb-title").textContent = g.name;
  const visible = (c) => cfg.showHidden || !c.hidden;
  const sortKids = (a, b) => (TEXTLIKE.has(a.type) || a.type === 15) === (TEXTLIKE.has(b.type) || b.type === 15) ? 0 : (TEXTLIKE.has(a.type) || a.type === 15) ? -1 : 1;
  const top = g.channels.filter((c) => c.type !== 4 && !c.parent_id && visible(c)).sort(sortKids);
  top.forEach((c) => list.append(rowWithThreads(c, g)));
  for (const cat of g.channels.filter((c) => c.type === 4)) {
    const kids = g.channels.filter((c) => c.parent_id === cat.id && visible(c)).sort(sortKids);
    if (!kids.length && (cat.hidden && !cfg.showHidden)) continue;
    if (!kids.length && cat.hidden) continue;
    const head = h("div", "cat" + (collapsed.has(cat.id) ? " collapsed" : ""), `<span class="arrow">▼</span>${cat.hidden ? "🔒 " : ""}${esc(cat.name)}`);
    head.onclick = () => {
      collapsed.has(cat.id) ? collapsed.delete(cat.id) : collapsed.add(cat.id);
      cfg.collapsed = [...collapsed]; saveCfg(); renderSidebar();
    };
    list.append(head);
    if (!collapsed.has(cat.id)) kids.forEach((c) => list.append(rowWithThreads(c, g)));
    else kids.filter((c) => c.id === S.channel?.id || S.unread.has(c.id)).forEach((c) => list.append(channelRow(c, g.id)));
  }
}

const SVG = {
  mic: '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z" fill="currentColor"/></svg>',
  micOff: '<svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11z" fill="currentColor"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2.4"/></svg>',
  head: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h2v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h2a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z" fill="currentColor"/></svg>',
  headOff: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 0 0-9 9v6a3 3 0 0 0 3 3h2v-8H5v-1a7 7 0 0 1 14 0v1h-3v8h2a3 3 0 0 0 3-3v-6a9 9 0 0 0-9-9z" fill="currentColor"/><path d="M3 3l18 18" stroke="currentColor" stroke-width="2.4"/></svg>',
  hang: '<svg viewBox="0 0 24 24"><path d="M12 9c-1.6 0-3.1.3-4.6.7v3.1c0 .4-.2.7-.6.9-1 .5-1.9 1.1-2.6 1.8-.2.2-.4.3-.7.3s-.5-.1-.7-.3L.3 13c-.2-.2-.3-.4-.3-.7s.1-.5.3-.7C3.3 8.7 7.4 7 12 7s8.7 1.7 11.7 4.6c.2.2.3.4.3.7s-.1.5-.3.7l-2.5 2.5c-.2.2-.4.3-.7.3s-.5-.1-.7-.3c-.8-.7-1.7-1.3-2.6-1.8-.3-.2-.6-.5-.6-.9V9.7C15.1 9.3 13.6 9 12 9z" fill="currentColor"/></svg>',
};
const STATUS = { online: ["Çevrimiçi", "#23a55a"], idle: ["Boşta", "#f0b232"], dnd: ["Rahatsız Etmeyin", "#f23f43"], invisible: ["Görünmez", "#80848e"] };

function renderMe() {
  const u = S.me; if (!u) return;
  const p = $("#me-panel");
  p.innerHTML = `<div class="me-av"><img class="speaking-ring${S.vc.speaking.has(u.id) ? " speaking" : ""}" data-uid="${u.id}" src="${avatarUrl(u, 64)}"><span class="st ${cfg.status}"></span></div>
    <div class="who"><b>${esc(dname(u))}</b><small>${S.game ? "🎮 " + esc(S.game) : STATUS[cfg.status]?.[0] ?? "@" + esc(u.username)}</small></div>`;
  const mic = h("button", "icon-btn" + (cfg.muted || cfg.deafened ? " off" : ""), cfg.muted || cfg.deafened ? SVG.micOff : SVG.mic);
  mic.title = cfg.muted ? "Mikrofonu aç" : "Mikrofonu kapat";
  mic.onclick = () => { if (cfg.deafened) { cfg.deafened = false; cfg.muted = false; } else cfg.muted = !cfg.muted; applyVoiceFlags(); };
  const head = h("button", "icon-btn" + (cfg.deafened ? " off" : ""), cfg.deafened ? SVG.headOff : SVG.head);
  head.title = cfg.deafened ? "Sağırlaştırmayı kapat" : "Sağırlaştır";
  head.onclick = () => { cfg.deafened = !cfg.deafened; applyVoiceFlags(); };
  p.append(mic, head);
  const openStatus = (e) => showMenu(e, Object.entries(STATUS).map(([k, [label, col]]) => ({
    html: `<span class="dot" style="background:${col}"></span>${label}`,
    fn: () => { cfg.status = k; saveCfg(); pushStatus(); renderMe(); },
  })).concat(["-", { label: "✏️ Profili düzenle", fn: () => openProfileEditor() }, { label: "👤 Profil kartımı göster", fn: () => openPopout(p.querySelector(".me-av"), u.id) }, ...accountMenuItems()]));
  p.querySelector(".me-av").onclick = openStatus;
  p.querySelector(".who").onclick = openStatus;
}

function openGuild(id) {
  S.view = id; renderRail(); renderSidebar();
}

/* ------------------------------------------------------------------ */
/* Mesajlar                                                            */
/* ------------------------------------------------------------------ */
const SYSTEM = { 7: "sunucuya katıldı 👋", 8: "sunucuya takviye yaptı 💎", 6: "bir mesajı sabitledi 📌", 1: "gruba birini ekledi", 2: "gruptan birini çıkardı", 3: "arama başlattı 📞", 4: "grup adını değiştirdi", 18: "bir alt başlık başlattı" };

function isMentioned(m) {
  return m.mention_everyone || m.mentions?.some((u) => u.id === S.me?.id);
}

function renderMsg(m, prev) {
  const grouped = prev && !m.referenced_message && prev.author?.id === m.author?.id && m.type in { 0: 1, 19: 1 } && prev.type in { 0: 1, 19: 1 } &&
    snowTime(m.id) - snowTime(prev.id) < 7 * 60000 && !!prev._deleted === !!m._deleted;
  const el = h("div", "msg" + (grouped ? " grouped" : ""));
  el.dataset.id = m.id;
  if (m._deleted) el.classList.add("deleted");
  if (isMentioned(m)) el.classList.add("mentioned");

  if (m.referenced_message || (m.message_reference && m.type === 19)) {
    const rm = m.referenced_message;
    const line = h("div", "reply-line");
    line.innerHTML = rm ? `<img src="${avatarUrl(rm.author, 32)}"><b>${esc(dname(rm.author))}</b><span>${esc((rm.content || "📎 ek").slice(0, 140))}</span>` : `<span class="muted">Orijinal mesaj silindi</span>`;
    if (rm) line.onclick = () => jumpTo(rm.id);
    el.append(h("div"), line);
  }

  const side = grouped ? h("div", "side-time", new Date(m.timestamp).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })) : h("img", "av");
  if (!grouped) { side.src = avatarUrl(m.author); side.loading = "lazy"; side.dataset.pop = m.author?.id; }
  const body = h("div", "body");
  if (!grouped) {
    body.innerHTML = `<div class="head"><span class="author" data-pop="${m.author?.id}">${esc(dname(m.author))}</span>${m.author?.bot ? '<span class="bot">BOT</span>' : ""}<span class="time">${fmtTime(m.timestamp)}</span></div>`;
  }

  if (SYSTEM[m.type]) {
    body.append(h("div", "content muted", `<i>${esc(dname(m.author))} ${SYSTEM[m.type]}</i>`));
  } else {
    if (cfg.showEdits && m._edits?.length) {
      const ed = h("div", "edits");
      for (const e of m._edits) {
        const d = h("div"); d.innerHTML = `<small>${e.time ? fmtTime(e.time) : ""}</small>`; d.append(document.createTextNode(e.content || "(boş)"));
        ed.append(d);
      }
      body.append(ed);
    }
    const c = h("div", "content", md(m.content, m));
    if (m.content && /^(\s*(<a?:\w+:\d+>|\p{Extended_Pictographic}|‍|️)\s*){1,27}$/u.test(m.content)) c.classList.add("jumbo");
    if (m.edited_timestamp) {
      const t = h("span", "edited", "(düzenlendi)");
      t.title = m._edits?.length ? "Eski hali:\n" + m._edits.map((e) => e.content).join("\n— ") : "Düzenlendi: " + fmtTime(m.edited_timestamp);
      c.append(t);
    }
    if (m._deleted) c.append(h("span", "del-tag", "SİLİNDİ"));
    body.append(c);
  }

  if (m.attachments?.length) {
    const box = h("div", "atts");
    for (const a of m.attachments) {
      const ct = a.content_type || "";
      if (ct.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.filename)) {
        const img = h("img"); img.loading = "lazy";
        const w = Math.min(a.width || 420, 840);
        img.src = a.proxy_url + (a.proxy_url.includes("?") ? "&" : "?") + `width=${w}&height=${Math.round(((a.height || 300) * w) / (a.width || w))}`;
        img.onclick = () => lightbox(a.url);
        box.append(img);
      } else if (ct.startsWith("audio/") || a.waveform || /\.(ogg|mp3|wav|m4a|opus)$/i.test(a.filename)) {
        box.append(audioPlayer(a));
      } else if (ct.startsWith("video/")) {
        const v = h("video"); v.src = a.url; v.controls = true; v.preload = "metadata"; box.append(v);
      } else {
        const f = h("a", "file", `📄 <span>${esc(a.filename)}</span><small class="muted">${(a.size / 1024).toFixed(0)} KB</small>`);
        f.href = a.url; box.append(f);
      }
    }
    body.append(box);
  }
  for (const s of m.sticker_items || []) {
    const i = h("img", "sticker"); i.src = `https://media.discordapp.net/stickers/${s.id}.webp?size=160`; i.title = s.name; body.append(i);
  }
  if (m.poll) body.append(renderPoll(m));
  for (const e of m.embeds || []) body.append(renderEmbed(e));
  if (m.content && !m._deleted) body.append(...inviteCards(m));
  if (m.reactions?.length) body.append(renderReactions(m));

  // Eylemler
  const act = h("div", "actions");
  const btn = (txt, title, fn, cls) => { const b = h("button", cls, txt); b.title = title; b.onclick = fn; act.append(b); };
  if (!m._deleted) btn("☺", "Tepki ekle", (e) => openEmojiPicker(e.currentTarget, (em) =>
    invoke("react", { channelId: m.channel_id, messageId: m.id, emoji: emojiKey(em), add: true }).catch((err) => toast("Tepki: " + err))), "react-add");
  if (!m._deleted) btn("↩", "Yanıtla", () => setReply(m));
  btn("⧉", "Metni kopyala", () => { navigator.clipboard.writeText(m.content || ""); toast("Kopyalandı"); });
  if (m.author?.id === S.me?.id && !m._deleted) {
    btn("✎", "Düzenle", () => startEdit(el, m));
    btn("🗑", "Sil", () => delMsg(m), "del");
  }
  if (m._deleted) btn("✕", "Görünümden kaldır", () => el.remove(), "del");
  extraActions(btn, m, el);
  moreActions(btn, m, el);
  el.append(side, body, act);
  return el;
}

function renderEmbed(e) {
  if (e.type === "image" || e.type === "gifv") {
    const src = e.thumbnail?.proxy_url || e.thumbnail?.url;
    if (e.video?.url && e.type === "gifv") {
      const v = h("video"); v.src = e.video.proxy_url || e.video.url; v.autoplay = v.loop = v.muted = true;
      v.style.cssText = "max-width:420px;border-radius:8px;margin-top:4px"; return v;
    }
    if (src) { const i = h("img"); i.src = src; i.loading = "lazy"; i.style.cssText = "max-width:420px;max-height:340px;border-radius:8px;margin-top:4px;cursor:zoom-in"; i.onclick = () => lightbox(e.url || src); return i; }
  }
  const box = h("div", "embed");
  if (e.color) box.style.borderLeftColor = intColor(e.color);
  if (e.author?.name) box.append(h("div", "muted", `<small>${esc(e.author.name)}</small>`));
  if (e.title) box.append(h("div", "e-title", e.url ? `<a href="${esc(e.url)}">${esc(e.title)}</a>` : esc(e.title)));
  if (e.description) box.append(h("div", "e-desc", md(e.description)));
  for (const f of e.fields || []) box.append(h("div", "e-field", `<b>${esc(f.name)}</b>${md(f.value)}`));
  const img = e.image?.proxy_url || e.image?.url || (e.type !== "rich" ? e.thumbnail?.proxy_url : null);
  if (img) { const i = h("img"); i.src = img; i.loading = "lazy"; box.append(i); }
  if (e.footer?.text) box.append(h("div", "muted", `<small>${esc(e.footer.text)}</small>`));
  return box;
}

function lightbox(url) {
  const lb = h("div", "lightbox"); const i = h("img"); i.src = url; lb.append(i);
  lb.onclick = () => lb.remove(); document.body.append(lb);
}

function renderMessages(keepPos) {
  const box = $("#messages");
  const oldH = box.scrollHeight, oldTop = box.scrollTop;
  box.textContent = "";
  if (!S.msgs.length) { box.append(h("div", "empty", "Henüz mesaj yok")); return; }
  const frag = document.createDocumentFragment();
  if (!S.noMore) frag.append(h("div", "loading-older", "Yukarı kaydır: eski mesajlar"));
  let prev = null;
  for (const m of S.msgs) {
    if (m._deleted && !cfg.logger) continue;
    frag.append(renderMsg(m, prev)); prev = m;
  }
  box.append(frag);
  if (keepPos) box.scrollTop = box.scrollHeight - oldH + oldTop;
  else box.scrollTop = box.scrollHeight;
}

const nearBottom = () => { const b = $("#messages"); return b.scrollHeight - b.scrollTop - b.clientHeight < 150; };

function appendMsg(m) {
  if (S.detached) { showJumpPresent(); return; }
  const box = $("#messages");
  const stick = nearBottom();
  box.querySelector(".empty")?.remove();
  const prev = S.msgs[S.msgs.length - 1];
  S.msgs.push(m);
  const el = renderMsg(m, prev);
  el.classList.add("fresh");
  box.append(el);
  // DOM'u hafif tut
  if (S.msgs.length > 300) { S.msgs.splice(0, S.msgs.length - 250); S.noMore = false; renderMessages(); return; }
  if (stick) box.scrollTop = box.scrollHeight;
}

function replaceMsg(m) {
  const i = S.msgs.findIndex((x) => x.id === m.id);
  if (i < 0) return;
  S.msgs[i] = m;
  const old = $(`#messages .msg[data-id="${m.id}"]`);
  if (old) old.replaceWith(renderMsg(m, S.msgs[i - 1]));
}

function jumpTo(id) {
  const e = $(`#messages .msg[data-id="${id}"]`);
  if (!e) return toast("Mesaj yüklü değil");
  e.scrollIntoView({ block: "center", behavior: cfg.noAnim ? "auto" : "smooth" });
  e.animate([{ background: "var(--mention)" }, { background: "transparent" }], { duration: 1600 });
}

async function openChannel(c) {
  if ((c.type === 2 || c.type === 13) && !c.textOnly) {
    if (c.hidden) return toast("Bu ses kanalına girme iznin yok");
    return joinVoice(c.guild_id, c.id);
  }
  if (c.type === 4) return;
  saveDraft();
  S.channel = c; S.replyTo = null; S.noMore = false; S.msgs = []; S.detached = false; hideJumpPresent();
  S.unread.delete(c.id); S.mentions.delete(c.id);
  S.typers.clear(); renderTyping(); clearFiles();
  invoke("set_active_channel", { channelId: c.id });
  setupMembers(c);
  renderRail(); renderSidebar();
  $("#ch-icon").textContent = c.guild_id ? (c.hidden ? "🔒" : ICONS[c.type] ?? "#") : "@";
  $("#ch-name").textContent = c.parent_name ? `${c.parent_name} › ${c.name}` : c.name;
  $("#ch-topic").textContent = c.topic || "";
  $("#reply-bar").classList.add("hidden");

  for (const id of ["#messages", "#composer", "#hidden-view", "#forum-view", "#friends-view"]) $(id).classList.add("hidden");
  for (const id of ["#search-btn", "#pins-btn"]) $(id).classList.toggle("hidden", !!c.hidden);
  $("#call-btn").classList.toggle("hidden", !!c.guild_id);
  renderCallBar();
  if (c.hidden) return showHiddenView(c);
  if (c.type === 15 || c.type === 16) return showForumView(c);
  $("#messages").classList.remove("hidden"); $("#composer").classList.remove("hidden");
  const input = $("#input");
  input.disabled = c.can_send === false;
  input.placeholder = input.disabled ? "Bu kanala mesaj gönderme iznin yok" : `${c.guild_id ? "#" : "@"}${c.name} kanalına mesaj gönder`;
  restoreDraft(c);
  $("#messages").innerHTML = '<div class="empty">Yükleniyor…</div>';
  try {
    const list = await invoke("get_messages", { channelId: c.id, before: null });
    if (S.channel?.id !== c.id) return;
    S.msgs = list; S.noMore = list.length < 50;
    renderMessages();
    ackActive();
    if (!input.disabled) input.focus();
  } catch (e) {
    $("#messages").innerHTML = `<div class="empty">Mesajlar alınamadı: ${esc(e)}</div>`;
  }
}

async function loadOlder() {
  if (S.loadingOlder || S.noMore || !S.channel || !S.msgs.length) return;
  S.loadingOlder = true;
  const ch = S.channel.id;
  try {
    const list = await invoke("get_messages", { channelId: ch, before: S.msgs[0].id });
    if (S.channel?.id !== ch) return;
    if (!list.length) S.noMore = true;
    S.msgs = list.concat(S.msgs);
    if (list.length < 50) S.noMore = true;
    renderMessages(true);
  } catch (e) { toast("Hata: " + e); }
  finally { S.loadingOlder = false; }
}

async function showHiddenView(c) {
  const v = $("#hidden-view"); v.classList.remove("hidden");
  const info = await invoke("channel_info", { guildId: c.guild_id, channelId: c.id });
  if (!info) { v.innerHTML = '<div class="empty">Bilgi yok</div>'; return; }
  const chip = (o) => {
    const col = intColor(o.color) || "var(--muted)";
    return `<span class="chip"><span class="dot" style="background:${col}"></span>${esc(o.name)}</span>`;
  };
  const allowed = info.overwrites.filter((o) => o.view === "allow").sort((a, b) => (b.position ?? 0) - (a.position ?? 0));
  const denied = info.overwrites.filter((o) => o.view === "deny");
  const last = info.last_message_id ? fmtTime(snowTime(info.last_message_id)) : "—";
  v.innerHTML = `<div class="hv-card">
    <div class="hv-lock">🔒</div>
    <h2>${ICONS[info.type] ?? "#"} ${esc(info.name)}</h2>
    <p class="muted">Bu kanal gizli — ${esc(info.guild_name)}${info.parent_name ? " › " + esc(info.parent_name) : ""}</p>
    ${info.topic ? `<div class="topic">${md(info.topic)}</div>` : ""}
    <div class="hv-meta">
      <span class="chip">🕒 Son mesaj: ${last}</span>
      <span class="chip">📅 Oluşturulma: ${fmtTime(snowTime(info.id))}</span>
      ${info.nsfw ? '<span class="chip">🔞 NSFW</span>' : ""}
      ${info.rate_limit_per_user ? `<span class="chip">🐢 Yavaş mod: ${info.rate_limit_per_user}sn</span>` : ""}
    </div>
    <h4>Görebilenler (${allowed.length})</h4>
    <div class="chips">${allowed.map(chip).join("") || '<span class="muted">Sadece yöneticiler</span>'}</div>
    ${denied.length ? `<h4>Engellenenler (${denied.length})</h4><div class="chips">${denied.map(chip).join("")}</div>` : ""}
  </div>`;
}

/* ------------------------------------------------------------------ */
/* Gonderme / yanit / duzenleme / silme                                */
/* ------------------------------------------------------------------ */
function setReply(m) {
  S.replyTo = m;
  const bar = $("#reply-bar"); bar.classList.remove("hidden");
  bar.querySelector("span").innerHTML = `<b>${esc(dname(m.author))}</b> kişisine yanıt veriliyor`;
  $("#input").focus();
}
$("#reply-cancel").onclick = () => { S.replyTo = null; $("#reply-bar").classList.add("hidden"); };

async function send() {
  const input = $("#input");
  const text = input.value.trim();
  if ((!text && !S.files.length) || !S.channel || input.disabled) return;
  if (text.startsWith("/") && !S.files.length && (await runSlash(text))) return;
  const files = S.files.map(({ name, data }) => ({ name, data }));
  const out = prepareOutgoing(text);
  input.value = ""; autoGrow(); clearFiles(); saveDraft();
  const reply = S.replyTo?.id ?? null;
  S.replyTo = null; $("#reply-bar").classList.add("hidden");
  lastTyping = 0;
  if (files.length) toast(`${files.length} dosya yükleniyor…`);
  try { await invoke("send_message", { channelId: S.channel.id, content: out.content, replyTo: reply, files, silent: out.silent }); }
  catch (e) { toast("Gönderilemedi: " + e); input.value = text; }
}

/* ---------- Dosya ekleme: buton, yapistirma, surukle-birak ---------- */
const MAX_FILE = 50 * 1024 * 1024;
function addFiles(list) {
  for (const f of list) {
    if (S.files.length >= 10) { toast("En fazla 10 dosya"); break; }
    if (f.size > MAX_FILE) { toast(`${f.name}: 50 MB'tan büyük`); continue; }
    const rd = new FileReader();
    rd.onload = () => {
      const url = rd.result;
      S.files.push({ name: f.name || "dosya.png", data: url.slice(url.indexOf(",") + 1), preview: f.type.startsWith("image/") ? url : null, size: f.size });
      renderFiles();
    };
    rd.readAsDataURL(f);
  }
}
function renderFiles() {
  const bar = $("#file-bar"); bar.textContent = "";
  bar.classList.toggle("hidden", !S.files.length);
  S.files.forEach((f, i) => {
    const c = h("div", "fchip", `${f.preview ? `<img src="${f.preview}">` : '<div style="font-size:30px;text-align:center">📄</div>'}<div class="fn">${esc(f.name)}</div><small class="muted">${(f.size / 1024 / 1024).toFixed(2)} MB</small>`);
    const x = h("button", null, "✕"); x.onclick = () => { S.files.splice(i, 1); renderFiles(); };
    c.append(x); bar.append(c);
  });
}
function clearFiles() { S.files = []; renderFiles(); }
$("#attach-btn").onclick = () => $("#file-input").click();
$("#file-input").onchange = (e) => { addFiles(e.target.files); e.target.value = ""; };
$("#input").addEventListener("paste", (e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); addFiles(e.clipboardData.files); } });
{
  let depth = 0;
  const chat = $("#chat"), dz = $("#drop-zone");
  const canDrop = () => !$("#composer").classList.contains("hidden") && !$("#input").disabled;
  chat.addEventListener("dragenter", (e) => { if (!e.dataTransfer?.types.includes("Files") || !canDrop()) return; depth++; dz.classList.remove("hidden"); });
  chat.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; dz.classList.add("hidden"); } });
  chat.addEventListener("dragover", (e) => { if (canDrop()) e.preventDefault(); });
  chat.addEventListener("drop", (e) => { e.preventDefault(); depth = 0; dz.classList.add("hidden"); if (canDrop() && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
}

/* ---------- Yaziyor gostergesi ---------- */
let lastTyping = 0;
$("#input").addEventListener("input", () => {
  if (!S.channel || !$("#input").value || cfg.ghostTyping) return;
  const now = Date.now();
  if (now - lastTyping > 8000) { lastTyping = now; invoke("send_typing", { channelId: S.channel.id }).catch(() => {}); }
});
function renderTyping() {
  const now = Date.now();
  for (const [k, v] of S.typers) if (v.until < now) S.typers.delete(k);
  const names = [...S.typers.values()].map((v) => `<b>${esc(v.name)}</b>`);
  $("#typing").innerHTML = !names.length ? "" : names.length > 3 ? "Birkaç kişi yazıyor…" : names.join(", ") + (names.length > 1 ? " yazıyorlar…" : " yazıyor…");
  clearTimeout(renderTyping._t);
  if (S.typers.size) renderTyping._t = setTimeout(renderTyping, 1000);
}

/* ---------- Tepkiler + emoji secici ---------- */
const emojiKey = (e) => (e.id ? `${e.name}:${e.id}` : e.name);
const emojiHtml = (e, size = 48) => e.id ? `<img src="${CDN}/emojis/${e.id}.${e.animated ? "gif" : "webp"}?size=${size}" alt=":${esc(e.name)}:">` : esc(e.name);
function renderReactions(m) {
  const box = h("div", "reactions");
  for (const r of m.reactions) {
    const b = h("button", "react" + (r.me ? " me" : ""), `${emojiHtml(r.emoji, 32)}<span>${r.count}</span>`);
    b.title = ":" + (r.emoji.name || "") + ":";
    b.onclick = () => invoke("react", { channelId: m.channel_id, messageId: m.id, emoji: emojiKey(r.emoji), add: !r.me }).catch((e) => toast("Tepki: " + e));
    box.append(b);
  }
  return box;
}

const UNICODE_EMOJI = ("😀 gul,😂 kahkaha,🤣 yerlere,😊 mutlu,😍 ask,🥰 sevgi,😘 opucuk,😎 havali,🤔 dusun,😐 duz,🙄 goz,😏 sirit,😢 uzgun,😭 aglama,😡 kizgin,🤬 kufur,😱 korku,😳 utanc,🥺 rica,😴 uyku,🤮 kusma,🤯 sok,🥳 parti,😇 melek,🤡 palyaco,💀 olu,👻 hayalet,👽 uzayli,🤖 robot,💩 kaka," +
  "👍 like,👎 dislike,👏 alkis,🙏 dua,🤝 tokalas,👋 selam,✌️ zafer,🤞 sans,👌 tamam,💪 guc,🫡 selamlama,👀 goz,🧠 beyin," +
  "❤️ kalp,🧡 turuncu,💛 sari,💚 yesil,💙 mavi,💜 mor,🖤 siyah,💔 kirik,💯 yuz,🔥 ates,✨ parilti,⭐ yildiz,🎉 kutlama,🎁 hediye,💎 elmas,⚡ simsek," +
  "✅ evet,❌ hayir,⚠️ uyari,❓ soru,❗ unlem,🆗 ok,🆒 cool,🔴 kirmizi,🟢 yesil,🔵 mavi," +
  "🐱 kedi,🐶 kopek,🦊 tilki,🐸 kurbaga,🐍 yilan,🦄 unicorn,🍕 pizza,🍔 burger,🍟 patates,☕ kahve,🍺 bira,🎮 oyun,🎵 muzik,⚽ futbol,🏆 kupa,🚀 roket,💻 bilgisayar,📌 pin,🕒 saat,💰 para")
  .split(",").map((x) => { const [c, k] = x.split(" "); return { c, k }; });

let emojiPop = null;
function closeEmojiPop() { emojiPop?.remove(); emojiPop = null; }
function openEmojiPicker(anchor, onPick) {
  closeEmojiPop();
  const pop = h("div", "emoji-pop");
  const q = h("input"); q.placeholder = "Emoji ara…";
  const grid = h("div", "emoji-grid scroll");
  pop.append(q, grid);
  const guild = S.guilds.find((g) => g.id === S.channel?.guild_id);
  const render = () => {
    const s = q.value.toLowerCase().trim(); grid.textContent = "";
    let budget = s ? 600 : 400;
    for (const g of emojiGroups(guild)) {
      if (budget <= 0) break;
      const custom = (g.emojis || []).filter((e) => !s || e.name.toLowerCase().includes(s)).slice(0, budget);
      if (!custom.length) continue;
      budget -= custom.length;
      grid.append(h("h5", null, esc(g.name) + (g !== guild && !hasNitro() ? " ✨" : "")));
      for (const e of custom) {
        const b = h("button", null, emojiHtml(e).replace("<img ", '<img loading="lazy" ')); b.title = ":" + e.name + ":";
        b.onclick = () => { onPick(e); closeEmojiPop(); }; grid.append(b);
      }
    }
    const uni = UNICODE_EMOJI.filter((e) => !s || e.k.includes(s));
    if (uni.length) grid.append(h("h5", null, "Emojiler"));
    for (const e of uni) { const b = h("button", null, e.c); b.title = e.k; b.onclick = () => { onPick({ id: null, name: e.c }); closeEmojiPop(); }; grid.append(b); }
  };
  q.oninput = render; render();
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right - 340, innerWidth - 348)) + "px";
  pop.style.top = (r.top > 380 ? r.top - pop.offsetHeight - 6 : r.bottom + 6) + "px";
  emojiPop = pop; q.focus();
}
document.addEventListener("mousedown", (e) => { if (emojiPop && !emojiPop.contains(e.target) && !e.target.closest("#emoji-btn, .react-add")) closeEmojiPop(); });
$("#emoji-btn").onclick = (e) => {
  if (emojiPop) return closeEmojiPop();
  openEmojiPicker(e.currentTarget, (em) => {
    const input = $("#input");
    const txt = em.id ? `<${em.animated ? "a" : ""}:${em.name}:${em.id}>` : em.name;
    const p = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, p) + txt + input.value.slice(input.selectionEnd ?? p);
    input.focus(); input.selectionStart = input.selectionEnd = p + txt.length; autoGrow();
  });
};

/* ---------- Uye listesi (sag panel) ---------- */
function setupMembers(c) {
  const isGuild = !!c.guild_id;
  $("#members-btn").classList.toggle("hidden", !isGuild);
  $("#members-btn").classList.toggle("on", cfg.showMembers);
  const show = isGuild && cfg.showMembers;
  $("#members").classList.toggle("hidden", !show);
  $("#app").classList.toggle("with-members", show);
  if (!isGuild) return;
  if (S.members.guild !== c.guild_id || S.members.channel !== c.id) {
    S.members = { guild: c.guild_id, channel: c.id, items: [] };
    $("#members").innerHTML = '<div class="muted" style="padding:8px">Üyeler yükleniyor…</div>';
    // Gizli kanal icin uye listesi istenemez; ayni sunucunun gorunur bir kanalini kullan
    const g = S.guilds.find((x) => x.id === c.guild_id);
    const sub = c.hidden || c.type === 15 || c.type === 16 || c.parent_name ? g?.channels.find((x) => !x.hidden && TEXTLIKE.has(x.type)) : c;
    if (sub) invoke("subscribe_guild", { guildId: c.guild_id, channelId: sub.id });
  }
}
$("#members-btn").onclick = () => { cfg.showMembers = !cfg.showMembers; saveCfg(); if (S.channel) setupMembers(S.channel); renderMembers(); };

function topRoleColor(g, roles) {
  let best = null;
  for (const id of roles || []) { const r = g?.roles?.[id]; if (r?.color && (!best || r.position > best.position)) best = r; }
  return intColor(best?.color);
}
function activityText(p) {
  for (const a of p?.activities || []) {
    if (a.type === 4) return (a.emoji?.name && !a.emoji.id ? a.emoji.name + " " : "") + (a.state || "");
    if (a.type === 0) return "Oynuyor: " + a.name;
    if (a.type === 2) return "Dinliyor: " + (a.details || a.name);
    if (a.type === 3) return "İzliyor: " + a.name;
    if (a.type === 1) return "Yayında: " + a.name;
  }
  return "";
}
function renderMembers() {
  const box = $("#members");
  if (box.classList.contains("hidden")) return;
  const g = S.guilds.find((x) => x.id === S.members.guild);
  if (!S.members.items.length) return;
  const frag = document.createDocumentFragment();
  for (const it of S.members.items) {
    if (!it) continue;
    if (it.group) {
      const name = it.group.id === "online" ? "Çevrimiçi" : it.group.id === "offline" ? "Çevrimdışı" : g?.roles?.[it.group.id]?.name || "Rol";
      frag.append(h("div", "m-group", `${esc(name)} — ${it.group.count ?? ""}`));
      continue;
    }
    const m = it.member; if (!m?.user) continue;
    const st = m.presence?.status || "offline";
    const col = topRoleColor(g, m.roles);
    const act = activityText(m.presence);
    const row = h("div", "m-row" + (st === "offline" ? " offline" : "")); row.dataset.pop = m.user.id;
    row.innerHTML = `<div class="m-av"><img loading="lazy" src="${avatarUrl(m.user, 64)}"><span class="st ${st}"></span></div>
      <div class="m-name"><b${col ? ` style="color:${col}"` : ""}>${esc(m.nick || dname(m.user))}${m.user.bot ? ' <span class="bot" style="background:var(--accent);color:#fff;font-size:9px;padding:0 4px;border-radius:3px">BOT</span>' : ""}</b>${act ? `<small>${esc(act)}</small>` : ""}</div>`;
    frag.append(row);
  }
  const keep = box.scrollTop;
  box.textContent = ""; box.append(frag);
  box.scrollTop = keep;
}
let memberTimer = null;
listen("member-list", (e) => {
  const d = e.payload;
  if (d.guild_id !== S.members.guild) return;
  let items = S.members.items;
  for (const op of d.ops || []) {
    if (op.op === "SYNC") { const a = op.range[0]; items = items.slice(0, a).concat(op.items || [], items.slice(a + (op.items || []).length)); }
    else if (op.op === "INSERT") items.splice(op.index, 0, op.item);
    else if (op.op === "UPDATE") items[op.index] = op.item;
    else if (op.op === "DELETE") items.splice(op.index, 1);
  }
  S.members.items = items.slice(0, 200);
  clearTimeout(memberTimer); memberTimer = setTimeout(renderMembers, 150);
});

/* ---------- Forum kanallari ---------- */
async function showForumView(c) {
  const v = $("#forum-view"); v.classList.remove("hidden");
  v.innerHTML = `<div class="forum-top"><input id="forum-q" placeholder="Gönderilerde ara…"><button class="btn primary" id="new-post">＋ Yeni gönderi</button></div><div id="post-list"><div class="muted">Yükleniyor…</div></div>`;
  if (c.can_send === false) $("#new-post").classList.add("hidden");
  let posts = [], firsts = new Map(), offset = 0, more = false;
  const list = $("#post-list");
  const render = () => {
    const q = $("#forum-q").value.toLowerCase();
    list.textContent = "";
    const shown = posts.filter((p) => !q || p.name.toLowerCase().includes(q));
    if (!shown.length) list.append(h("div", "muted", "Gönderi yok"));
    for (const p of shown) {
      const fm = firsts.get(p.id);
      const b = h("button", "post");
      b.innerHTML = `<h3>${p.thread_metadata?.locked ? "🔒 " : ""}${esc(p.name)}</h3>
        ${fm?.content ? `<div class="muted" style="margin-bottom:6px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(fm.content.slice(0, 240))}</div>` : ""}
        <div class="meta">${fm?.author ? `<span>👤 ${esc(dname(fm.author))}</span>` : ""}<span>💬 ${p.message_count ?? 0}</span>
        <span>🕒 ${fmtTime(snowTime(p.last_message_id || p.id))}</span>${p.thread_metadata?.archived ? '<span class="tag">arşiv</span>' : ""}</div>`;
      b.onclick = () => openChannel({ ...p, guild_id: c.guild_id, can_send: c.can_send && !p.thread_metadata?.locked, hidden: false, parent_name: c.name });
      list.append(b);
    }
    if (more) { const m = h("button", "btn", "Daha fazla yükle"); m.style.marginTop = "6px"; m.onclick = load; list.append(m); }
  };
  async function load() {
    try {
      const r = await invoke("forum_threads", { channelId: c.id, offset });
      if (S.channel?.id !== c.id) return;
      posts = posts.concat(r.threads || []); offset += (r.threads || []).length; more = !!r.has_more;
      for (const m of r.first_messages || []) firsts.set(m.id, m);
      render();
    } catch (e) { list.innerHTML = `<div class="muted">Gönderiler alınamadı: ${esc(e)}</div>`; }
  }
  $("#forum-q").oninput = render;
  $("#new-post").onclick = () => {
    const box = h("div", "new-post", `<input id="np-title" placeholder="Başlık" maxlength="100"><textarea id="np-body" rows="6" placeholder="İlk mesaj"></textarea>`);
    const ok = h("button", "btn primary", "Gönder");
    ok.onclick = async () => {
      const title = $("#np-title").value.trim(), body = $("#np-body").value.trim();
      if (!title || !body) return toast("Başlık ve mesaj gerekli");
      try {
        const t = await invoke("create_forum_post", { channelId: c.id, title, content: body });
        closeModal();
        openChannel({ ...t, guild_id: c.guild_id, can_send: true, hidden: false, parent_name: c.name });
      } catch (e) { toast("Oluşturulamadı: " + e); }
    };
    box.append(ok);
    openModal("Yeni gönderi — " + c.name, box);
  };
  load();
}

function startEdit(el, m) {
  const c = el.querySelector(".content"); if (!c) return;
  const ta = h("textarea", "edit-box"); ta.value = m.content; ta.rows = Math.min(10, m.content.split("\n").length + 1);
  c.replaceWith(ta); ta.focus();
  ta.onkeydown = async (e) => {
    if (e.key === "Escape") return replaceMsg(m);
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = ta.value.trim();
      if (!v || v === m.content) return replaceMsg(m);
      try { await invoke("edit_message", { channelId: S.channel.id, messageId: m.id, content: v }); }
      catch (err) { toast("Düzenlenemedi: " + err); replaceMsg(m); }
    }
  };
}

async function delMsg(m) {
  try { await invoke("delete_message", { channelId: S.channel.id, messageId: m.id }); }
  catch (e) { toast("Silinemedi: " + e); }
}

function autoGrow() { const i = $("#input"); i.style.height = "auto"; i.style.height = Math.min(i.scrollHeight, innerHeight * 0.4) + "px"; }
$("#input").addEventListener("input", autoGrow);
$("#input").addEventListener("keydown", (e) => {
  if (slashKey(e)) return;
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  if (e.key === "Escape" && S.replyTo) $("#reply-cancel").click();
  if (e.key === "ArrowUp" && !e.target.value) {
    const mine = [...S.msgs].reverse().find((m) => m.author?.id === S.me?.id && !m._deleted);
    const el = mine && $(`#messages .msg[data-id="${mine.id}"]`);
    if (el) { e.preventDefault(); startEdit(el, mine); }
  }
});
$("#messages").addEventListener("scroll", (e) => { if (e.target.scrollTop < 200) loadOlder(); }, { passive: true });

// Linkler varsayilan tarayicida, spoiler'lar tiklayinca acilir
document.addEventListener("click", (e) => {
  const sp = e.target.closest(".spoiler"); if (sp) { sp.classList.add("shown"); return; }
  const a = e.target.closest("a[href]");
  if (a && /^https?:/.test(a.href)) { e.preventDefault(); window.__TAURI__.opener.openUrl(a.href); }
});

/* ------------------------------------------------------------------ */
/* Modallar: ayarlar + silinen mesajlar                                */
/* ------------------------------------------------------------------ */
function openModal(title, node) {
  $("#modal-title").textContent = title;
  const b = $("#modal-body"); b.textContent = ""; b.append(node);
  $("#modal").classList.remove("hidden");
}
const closeModal = () => $("#modal").classList.add("hidden");
$("#modal-close").onclick = closeModal;
$("#modal").onclick = (e) => { if (e.target.id === "modal") closeModal(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal(); });

function settingsView() {
  const root = h("div");
  const sec = (title) => { const s = h("div", "set-section", `<h3>${title}</h3>`); root.append(s); return s; };

  const tSec = sec("Tema");
  const grid = h("div", "themes"); tSec.append(grid);
  for (const [id, name] of THEMES) {
    const card = h("button", "theme-card" + (cfg.theme === id ? " sel" : ""));
    card.setAttribute("data-theme", id);
    card.innerHTML = `<div class="prev"><i style="background:var(--bg-0)"></i><i style="background:var(--bg-1)"></i>
      <div class="c" style="background:var(--bg-2)"><b style="background:var(--accent);width:60%"></b><b style="background:var(--muted);width:85%;opacity:.5"></b><b style="background:var(--accent-2);width:40%"></b></div></div>
      <span style="color:var(--text);background:var(--bg-1)">${name}</span>`;
    card.onclick = () => { cfg.theme = id; saveCfg(); applyCfg(); grid.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); card.classList.add("sel"); };
    grid.append(card);
  }

  const look = sec("Görünüm");
  const accRow = h("div", "row", `<label>Vurgu rengi<small>Temanın ana rengini değiştir</small></label>`);
  const acc = h("input"); acc.type = "color"; acc.value = cfg.accent || getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c6cff";
  acc.oninput = () => { cfg.accent = acc.value; saveCfg(); applyCfg(); };
  const accReset = h("button", "btn", "Sıfırla"); accReset.onclick = () => { cfg.accent = ""; saveCfg(); applyCfg(); };
  accRow.append(acc, accReset); look.append(accRow);

  const fsRow = h("div", "row", `<label>Yazı boyutu <b id="fsv">${cfg.fontSize}px</b></label>`);
  const fs = h("input"); fs.type = "range"; fs.min = 12; fs.max = 20; fs.value = cfg.fontSize;
  fs.oninput = () => { cfg.fontSize = +fs.value; $("#fsv").textContent = fs.value + "px"; saveCfg(); applyCfg(); };
  fsRow.append(fs); look.append(fsRow);

  const toggle = (parent, key, label, hint, after) => {
    const r = h("div", "row", `<label>${label}<small>${hint}</small></label>`);
    const c = h("input", "switch"); c.type = "checkbox"; c.checked = cfg[key];
    c.onchange = () => { cfg[key] = c.checked; saveCfg(); applyCfg(); after?.(); };
    r.append(c); parent.append(r);
  };
  toggle(look, "compact", "Kompakt mod", "Daha sık mesaj düzeni", () => renderMessages());
  toggle(look, "noAnim", "Animasyonları kapat", "Düşük donanımda daha akıcı");

  const extra = sec("Ek özellikler");
  toggle(extra, "showHidden", "Gizli kanalları göster", "Görme iznin olmayan kanallar 🔒 ile listelenir", renderSidebar);
  toggle(extra, "logger", "Silinen mesajları tut", "Silinen mesajlar kırmızı olarak kalır ve kayda eklenir", () => { renderMessages(); renderRail(); });
  toggle(extra, "showEdits", "Düzenleme geçmişi", "Düzenlenen mesajların eski hallerini göster", () => renderMessages());
  toggle(extra, "notify", "Masaüstü bildirimleri", "Etiketlendiğinde, DM'de ve gelen aramada bildirim göster (Rahatsız Etmeyin'de kapalı)");
  const fr = h("div", "row", `<label>Sunucu klasörleri<small>Sunucuyu başka bir sunucunun üstüne sürükle = klasör. Sağ tık = düzenle/taşı.</small></label>`);
  const frb = h("button", "btn", "Sıfırla");
  frb.onclick = () => { cfg.rail = null; saveCfg(); renderRail(); toast("Klasörler sıfırlandı"); };
  fr.append(frb); extra.append(fr);
  const vbox = h("div"); root.append(vbox); voiceSettingsSection(vbox);
  extraSettings(root, sec, toggle);
  plusSettings(root, sec, toggle);

  const css = sec("Özel CSS");
  const ta = h("textarea", "css"); ta.value = cfg.customCss; ta.spellcheck = false;
  ta.placeholder = ":root { --accent: #ff8800; }\n.msg .author { color: var(--accent); }";
  ta.oninput = () => { cfg.customCss = ta.value; saveCfg(); applyCfg(); };
  css.append(ta);

  const acc2 = sec("Hesap");
  const pe = h("button", "btn primary", "✏️ Profili düzenle"); pe.onclick = () => { closeModal(); openProfileEditor(); };
  const ca = h("button", "btn", "🗂 Sunucuları kategorize et"); ca.onclick = () => { closeModal(); openCategorize(false); };
  pe.style.marginRight = ca.style.marginRight = "8px"; acc2.append(pe, ca);
  const out = h("button", "btn danger", "Çıkış yap");
  out.onclick = async () => { await invoke("logout"); location.reload(); };
  acc2.append(out);
  return root;
}

async function logView() {
  const root = h("div");
  const list = await invoke("deleted_log");
  const bar = h("div", "row", `<label class="muted">${list.length} silinen mesaj (kalıcı kayıt)</label>`);
  const clr = h("button", "btn", "Temizle");
  clr.onclick = async () => { await invoke("clear_deleted_log"); S.logCount = 0; renderRail(); closeModal(); };
  bar.append(clr); root.append(bar);
  if (!list.length) root.append(h("p", "muted", "Henüz silinen mesaj yakalanmadı. Mesajlar, bu uygulama açıkken silindiğinde burada görünür."));
  for (const it of list) {
    const m = it.message;
    const row = h("div", "log-item");
    row.innerHTML = `<div class="lh"><img src="${avatarUrl(m.author, 32)}"><b>${esc(dname(m.author))}</b>
      <span>${esc(it.guild_name)} › ${esc(it.channel_name)}</span><span style="margin-left:auto">silindi: ${fmtTime(it.deleted_at)}</span></div>
      <div class="lc">${md(m.content, m) || (m.attachments?.length ? "📎 " + m.attachments.map((a) => esc(a.filename)).join(", ") : "<i class='muted'>(içerik yok)</i>")}</div>`;
    row.onclick = () => {
      closeModal();
      const gid = it.guild_id;
      if (gid) {
        const g = S.guilds.find((x) => x.id === gid); const c = g?.channels.find((x) => x.id === m.channel_id);
        if (c) { openGuild(gid); openChannel({ ...c, guild_id: gid }).then(() => setTimeout(() => jumpTo(m.id), 50)); }
      } else {
        const d = S.dms.find((x) => x.id === m.channel_id);
        if (d) { S.view = "home"; renderRail(); renderSidebar(); openChannel({ id: d.id, guild_id: null, name: d.name || d.recipients.map(dname).join(", "), type: d.type, can_send: true }).then(() => setTimeout(() => jumpTo(m.id), 50)); }
      }
    };
    root.append(row);
  }
  return root;
}

$("#settings-btn").onclick = () => openModal("Ayarlar", settingsView());
$("#log-btn").onclick = async () => openModal("Silinen Mesajlar", await logView());
$("#home-btn").onclick = () => { S.view = "home"; renderRail(); renderSidebar(); if (!S.channel) showFriends(); };

/* ------------------------------------------------------------------ */
/* Gateway olaylari                                                    */
/* ------------------------------------------------------------------ */
let refreshTimer = null;
async function refreshState() {
  const st = await invoke("get_state");
  S.me = st.me; S.guilds = st.guilds; S.dms = st.dms; S.logCount = st.log_count; S.folders = st.folders;
  applySocial(st);
  // Sunuculardaki ses durumlarini yeniden kur (DM aramalari korunur)
  for (const [k, v] of S.vstates) if (v.guild_id) S.vstates.delete(k);
  for (const g of S.guilds) for (const v of g.voice_states || []) S.vstates.set(v.user_id, v);
  if (S.view !== "home" && !S.guilds.some((g) => g.id === S.view)) S.view = "home";
  // Acik kanalin izinleri degistiyse guncelle
  if (S.channel?.guild_id) {
    const c = S.guilds.find((g) => g.id === S.channel.guild_id)?.channels.find((x) => x.id === S.channel.id);
    if (c && c.hidden !== S.channel.hidden) openChannel({ ...c, guild_id: S.channel.guild_id });
  }
  renderRail(); renderSidebar(); renderMe();
}
const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshState, 250); };

listen("gw-ready", () => {
  refreshState();
  pushStatus(); // durum + ozel durum + oyun aktivitesi (yeniden baglantida da)
});
listen("guilds-changed", scheduleRefresh);
listen("gw-status", (e) => {
  const d = $("#gw-dot"); const s = String(e.payload);
  d.className = s === "connected" ? "ok" : s.startsWith("fatal") ? "bad" : "wait";
  d.title = { connected: "Bağlı", connecting: "Bağlanıyor…", reconnecting: "Yeniden bağlanıyor…" }[s] || s;
  if (s.startsWith("fatal")) toast("Bağlantı hatası: " + s.slice(6));
});
listen("msg-create", (e) => {
  const m = e.payload;
  if (m.channel_id !== S.channel?.id) return;
  if (S.msgs.some((x) => x.id === m.id)) return;
  if (S.typers.delete(m.author?.id)) renderTyping();
  appendMsg(m);
  ackActive();
});
listen("typing", (e) => {
  const { user_id, name } = e.payload;
  S.typers.set(user_id, { name, until: Date.now() + 10000 });
  renderTyping();
});
listen("msg-update", (e) => { if (e.payload.channel_id === S.channel?.id) replaceMsg(e.payload); });
listen("msg-delete", (e) => {
  const { id, channel_id } = e.payload;
  if (channel_id !== S.channel?.id) return;
  const i = S.msgs.findIndex((x) => x.id === id);
  if (i < 0) return;
  if (cfg.logger) { S.msgs[i] = { ...S.msgs[i], _deleted: true }; replaceMsg(S.msgs[i]); }
  else { S.msgs.splice(i, 1); $(`#messages .msg[data-id="${id}"]`)?.remove(); }
});
listen("unread", (e) => {
  const { channel_id, mention } = e.payload;
  const silenced = isMuted(channel_id, e.payload.guild_id);
  if (!silenced) S.unread.add(channel_id);
  if (mention) {
    S.mentions.set(channel_id, (S.mentions.get(channel_id) || 0) + 1);
    if (cfg.notify && cfg.status !== "dnd" && !S.mutedChannels.has(channel_id)) notify(`${e.payload.author} — ${e.payload.where}`, e.payload.content || "📎 ek");
  }
  // DM'ler en uste
  const di = S.dms.findIndex((d) => d.id === channel_id);
  if (di > 0) S.dms.unshift(S.dms.splice(di, 1)[0]);
  clearTimeout(listen._u); listen._u = setTimeout(() => { renderRail(); renderSidebar(); }, 120);
});
listen("log-added", (e) => { S.logCount = e.payload; renderRail(); });

/* ------------------------------------------------------------------ */
/* Giris                                                               */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Ses: kanallar, DM aramalari, panel                                  */
/* ------------------------------------------------------------------ */
function voiceUsers(channelId) {
  const frag = document.createDocumentFragment();
  for (const v of S.vstates.values()) {
    if (v.channel_id !== channelId) continue;
    const r = h("div", "vuser" + (S.vc.speaking.has(v.user_id) ? " speaking" : "")); r.dataset.pop = v.user_id;
    r.dataset.uid = v.user_id;
    const muted = v.mute || v.self_mute, deaf = v.deaf || v.self_deaf;
    r.innerHTML = `<img src="${avatarUrl(v.user, 32)}"><span class="name">${esc(v.nick || dname(v.user))}</span>
      <span class="vicons">${v.self_stream ? '<span class="live" title="Yayını izle">CANLI</span>' : ""}${v.self_video ? "📹" : ""}${muted ? SVG.micOff : ""}${deaf ? SVG.headOff : ""}</span>`;
    frag.append(r);
  }
  return frag;
}

function voiceChannelName(guildId, channelId) {
  if (guildId) {
    const g = S.guilds.find((x) => x.id === guildId);
    const c = g?.channels.find((x) => x.id === channelId);
    return { ch: c?.name ?? "Ses", where: g?.name ?? "" };
  }
  const d = S.dms.find((x) => x.id === channelId);
  return { ch: d ? d.name || d.recipients.map(dname).join(", ") : "Arama", where: "Direkt Mesaj" };
}

async function joinVoice(guildId, channelId) {
  if (S.vc.channel_id === channelId && S.vc.state !== "disconnected" && S.vc.state !== "error") return;
  S.vc = { ...S.vc, state: "connecting", guild_id: guildId, channel_id: channelId, e2ee: false, privacy: null };
  renderVoicePanel();
  try {
    await invoke("set_voice_settings", { input: cfg.inputDevice || null, output: cfg.outputDevice || null, threshold: cfg.threshold, volume: cfg.volume });
    await invoke("join_voice", { guildId, channelId });
  } catch (e) { toast("Sese bağlanılamadı: " + e); S.vc.state = "disconnected"; S.vc.channel_id = null; renderVoicePanel(); }
}
function leaveVoice() { invoke("leave_voice").catch(() => {}); }
function applyVoiceFlags() {
  saveCfg(); renderMe();
  invoke("set_voice_flags", { mute: cfg.muted || cfg.deafened, deaf: cfg.deafened }).catch(() => {});
}

function renderVoicePanel() {
  const p = $("#voice-panel");
  const vc = S.vc;
  if (!vc.channel_id || vc.state === "disconnected") { p.classList.add("hidden"); return; }
  p.classList.remove("hidden");
  const { ch, where } = voiceChannelName(vc.guild_id, vc.channel_id);
  const [label, cls] = vc.state === "connected" ? ["Ses Bağlı", ""] : vc.state === "error" ? ["Bağlantı hatası", "err"] : ["Bağlanıyor…", "wait"];
  p.innerHTML = `<div class="vp-top"><div class="info"><b class="${cls}">${label}</b><small>${esc(ch)} / ${esc(where)}</small></div></div>
    ${vc.state === "connected" ? `<div class="vp-e2ee" title="${vc.privacy ? "Gizlilik kodu: " + esc(vc.privacy) : ""}">${vc.e2ee ? "🔒 Uçtan uca şifreli" + (vc.privacy ? " · " + esc(vc.privacy.slice(0, 11)) + "…" : "") : "Taşıma şifreli"}${vc.mic === false ? " · ⚠ mikrofon yok" : ""}</div>` : ""}`;
  const hang = h("button", "icon-btn hang", SVG.hang); hang.title = "Bağlantıyı kes"; hang.onclick = leaveVoice;
  p.querySelector(".vp-top").append(hang);
  videoButtons(p);
}

function renderCallBar() {
  const bar = $("#call-bar");
  const c = S.channel;
  if (!c || c.guild_id) { bar.classList.add("hidden"); return; }
  const inCall = [...S.vstates.values()].filter((v) => v.channel_id === c.id);
  if (!inCall.length) { bar.classList.add("hidden"); return; }
  bar.classList.remove("hidden");
  const mine = S.vc.channel_id === c.id && S.vc.state !== "disconnected";
  bar.innerHTML = inCall.map((v) => `<img class="speaking-ring${S.vc.speaking.has(v.user_id) ? " speaking" : ""}" data-uid="${v.user_id}" src="${avatarUrl(v.user, 64)}" title="${esc(dname(v.user))}">`).join("") +
    `<span class="grow">${inCall.length} kişi aramada</span>`;
  const b = h("button", "btn " + (mine ? "danger" : "ok"), mine ? "Ayrıl" : "Aramaya katıl");
  b.onclick = () => (mine ? leaveVoice() : joinVoice(null, c.id));
  bar.append(b);
}

$("#call-btn").onclick = async () => {
  const c = S.channel; if (!c || c.guild_id) return;
  await joinVoice(null, c.id);
  invoke("ring_call", { channelId: c.id }).catch(() => {});
};

async function notify(title, body) {
  try {
    const n = window.__TAURI__.notification;
    if (!(await n.isPermissionGranted()) && (await n.requestPermission()) !== "granted") return;
    n.sendNotification({ title, body });
  } catch {}
}

let voiceRender = null;
const scheduleVoiceRender = () => { clearTimeout(voiceRender); voiceRender = setTimeout(() => { renderSidebar(); renderCallBar(); }, 80); };

listen("voice-status", (e) => {
  const { state, detail } = e.payload;
  if (state === "disconnected") { S.vc = { ...S.vc, state, channel_id: null, guild_id: null, speaking: new Set() }; }
  else if (state === "error") { S.vc.state = "error"; toast("Ses: " + detail); }
  else {
    S.vc.state = state;
    if (state === "connected" && detail) { S.vc.e2ee = !!detail.e2ee; S.vc.mic = detail.mic; if (detail.mic === false) toast("Mikrofon bulunamadı — sadece dinleme modu"); }
  }
  renderVoicePanel(); renderCallBar();
});
listen("voice-moved", (e) => { S.vc.channel_id = e.payload.channel_id; renderVoicePanel(); });
listen("voice-privacy", (e) => { S.vc.privacy = e.payload; if (e.payload) S.vc.e2ee = true; renderVoicePanel(); });
listen("voice-state", (e) => {
  const v = e.payload;
  if (v.channel_id) S.vstates.set(v.user_id, v); else S.vstates.delete(v.user_id);
  if (v.user_id === S.me?.id && !v.channel_id && S.vc.state === "connected") { S.vc.state = "disconnected"; S.vc.channel_id = null; renderVoicePanel(); }
  if ((v.guild_id && v.guild_id === S.view) || !v.guild_id) scheduleVoiceRender();
});
listen("voice-speaking", (e) => {
  S.vc.speaking = new Set(e.payload);
  document.querySelectorAll(".vuser, .speaking-ring").forEach((el) => el.classList.toggle("speaking", S.vc.speaking.has(el.dataset.uid)));
});

/* Gelen arama */
let ringingChannel = null;
listen("incoming-call", (e) => {
  const { channel_id, name } = e.payload;
  if (S.vc.channel_id === channel_id) return;
  ringingChannel = channel_id;
  const card = $("#call-card");
  card.innerHTML = `<div style="font-size:30px">📞</div><b>${esc(name)}</b><div class="muted">seni arıyor…</div><div class="row2"><button class="btn danger" id="cc-no">Reddet</button><button class="btn ok" id="cc-yes">Katıl</button></div>`;
  card.classList.remove("hidden");
  $("#cc-yes").onclick = () => { card.classList.add("hidden"); ringingChannel = null; joinVoice(null, channel_id); };
  $("#cc-no").onclick = () => { card.classList.add("hidden"); ringingChannel = null; invoke("stop_ringing", { channelId: channel_id }).catch(() => {}); };
  if (cfg.notify && cfg.status !== "dnd") notify("Gelen arama", name + " seni arıyor");
});
listen("call-stop-ringing", (e) => {
  if (ringingChannel && e.payload.channel_id === ringingChannel) { $("#call-card").classList.add("hidden"); ringingChannel = null; }
});

/* Klasorden cikarmak icin bos ray alanina birakma */
$("#guild-list").addEventListener("dragover", (e) => { if (dragItem && e.target.id === "guild-list") e.preventDefault(); });
$("#guild-list").addEventListener("drop", (e) => {
  if (!dragItem || e.target.id !== "guild-list") return;
  e.preventDefault();
  const last = cfg.rail[cfg.rail.length - 1];
  if (last) railMove(dragItem, last.type === "f" ? { type: "f", id: last.id } : { type: "g", id: last.id }, "after");
  dragItem = null;
});

/* Ayarlar: ses + bildirim bolumu */
async function voiceSettingsSection(root) {
  const s = h("div", "set-section", "<h3>Ses ve görüntü</h3>");
  let dev = { inputs: [], outputs: [] };
  try { dev = await invoke("voice_devices"); } catch {}
  const sel = (label, list, key) => {
    const r = h("div", "row", `<label>${label}</label>`);
    const x = h("select", "inp"); x.style.maxWidth = "320px";
    x.innerHTML = `<option value="">Varsayılan</option>` + list.map((d) => `<option ${cfg[key] === d ? "selected" : ""}>${esc(d)}</option>`).join("");
    x.onchange = () => { cfg[key] = x.value; saveCfg(); pushVoiceSettings(); };
    r.append(x); s.append(r);
  };
  sel("Mikrofon", dev.inputs, "inputDevice");
  sel("Hoparlör", dev.outputs, "outputDevice");
  const slider = (label, hint, key, min, max, step, fmt) => {
    const r = h("div", "row", `<label>${label} <b>${fmt(cfg[key])}</b><small>${hint}</small></label>`);
    const x = h("input"); x.type = "range"; x.min = min; x.max = max; x.step = step; x.value = cfg[key];
    x.oninput = () => { cfg[key] = +x.value; r.querySelector("b").textContent = fmt(cfg[key]); saveCfg(); pushVoiceSettings(); };
    r.append(x); s.append(r);
  };
  slider("Mikrofon hassasiyeti", "Düşük = daha hassas (fısıltıyı da alır)", "threshold", 0.002, 0.08, 0.001, (v) => Math.round(20 * Math.log10(v)) + " dB");
  slider("Çıkış sesi", "Diğer kişilerin ses seviyesi", "volume", 0, 2, 0.05, (v) => Math.round(v * 100) + "%");
  s.append(h("p", "muted", "<small>Cihaz değişiklikleri bir sonraki bağlantıda uygulanır.</small>"));
  root.append(s);
}
function pushVoiceSettings() {
  invoke("set_voice_settings", { input: cfg.inputDevice || null, output: cfg.outputDevice || null, threshold: cfg.threshold, volume: cfg.volume }).catch(() => {});
}

async function doLogin(token, remember) {
  showSplash(true); const btn = $("#login-btn"); btn.disabled = true; btn.textContent = "Bağlanıyor…"; $("#login-err").textContent = "";
  try {
    S.me = await invoke("login", { token, remember });
    $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
    renderMe(); renderRail(); renderSidebar();
    $("#messages").innerHTML = '<div class="empty">Sunucular yükleniyor…</div>';
  } catch (e) {
    $("#login-err").textContent = String(e); showSplash(false);
  } finally { btn.disabled = false; btn.textContent = "Giriş yap"; }
}
$("#login-btn").onclick = () => doLogin($("#token").value, $("#remember").checked);
$("#token").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#login-btn").click(); });

// Tum betikler (extras.js dahil) yuklendikten sonra otomatik giris
window.addEventListener("DOMContentLoaded", async () => {
  const t = await invoke("saved_token");
  if (t) doLogin(t, true);
});
