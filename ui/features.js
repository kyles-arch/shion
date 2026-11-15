"use strict";
/* Shion — okunmamışlar, arkadaşlar, arama, sabitler, sessize alma, yer imleri,
   takma adlar, çeviri, GIF, bas-konuş, tepsi. app.js + extras.js'ten sonra yüklenir. */

/* ------------------------------------------------------------------ */
/* Okunmamış durumlar + sessize alma                                   */
/* ------------------------------------------------------------------ */
const isMuted = (cid, gid) => S.mutedChannels.has(cid) || (!!gid && S.mutedGuilds.has(gid));
const bigGt = (a, b) => { try { return BigInt(a || 0) > BigInt(b || 0); } catch { return false; } };

function applySocial(st) {
  S.readStates = st.read_states || {};
  S.friends = st.friends || [];
  S.mutedGuilds = new Set(st.muted_guilds || []);
  S.mutedChannels = new Set(st.muted_channels || []);
  S.unread.clear(); S.mentions.clear();
  const check = (id, last, gid) => {
    const rs = S.readStates[id];
    if (!rs || id === S.channel?.id) return;
    if (rs.mentions) S.mentions.set(id, rs.mentions);
    if (last && !isMuted(id, gid) && bigGt(last, rs.last)) S.unread.add(id);
  };
  for (const g of S.guilds) {
    for (const c of g.channels) if ((c.type === 0 || c.type === 5) && !c.hidden) check(c.id, c.last_message_id, g.id);
    for (const t of g.threads || []) check(t.id, t.last_message_id, g.id);
  }
  for (const d of S.dms) check(d.id, d.last_message_id, null);
}

let ackTimer = null;
function ackActive(force) {
  clearTimeout(ackTimer);
  ackTimer = setTimeout(() => {
    const c = S.channel;
    if (!c || S.detached || (!force && !document.hasFocus())) return;
    const last = [...S.msgs].reverse().find((m) => !m._deleted && !m.id.startsWith?.("tmp"));
    if (!last) return;
    const rs = S.readStates[c.id];
    if (rs && !bigGt(last.id, rs.last) && !rs.mentions) return;
    S.readStates[c.id] = { last: last.id, mentions: 0 };
    invoke("ack", { channelId: c.id, messageId: last.id }).catch(() => {});
  }, 700);
}
window.addEventListener("focus", () => ackActive(true));

function ackChannel(id, lastId) {
  S.unread.delete(id); S.mentions.delete(id);
  if (!lastId) return;
  S.readStates[id] = { last: lastId, mentions: 0 };
  invoke("ack", { channelId: id, messageId: lastId }).catch(() => {});
}
function ackGuild(g) {
  const list = [...g.channels, ...(g.threads || [])].filter((c) => c.last_message_id && bigGt(c.last_message_id, S.readStates[c.id]?.last));
  list.slice(0, 25).forEach((c, i) => setTimeout(() => ackChannel(c.id, c.last_message_id), i * 250));
}

async function toggleMute(gid, cid) {
  const set = cid ? S.mutedChannels : S.mutedGuilds;
  const key = cid || gid;
  const muted = !set.has(key);
  muted ? set.add(key) : set.delete(key);
  if (muted && cid) S.unread.delete(cid);
  if (muted && !cid) S.guilds.find((g) => g.id === gid)?.channels.forEach((c) => S.unread.delete(c.id));
  renderRail(); renderSidebar();
  toast(muted ? "🔕 Sessize alındı" : "🔔 Bildirimler açık");
  try { await invoke("set_mute", { guildId: gid || null, channelId: cid || null, muted }); }
  catch (e) { toast("Discord'a kaydedilemedi (yerelde uygulandı): " + e); }
}

function channelMenu(e, c, gid) {
  const last = c.last_message_id || S.dms.find((d) => d.id === c.id)?.last_message_id;
  showMenu(e, [
    { label: "Okundu olarak işaretle", fn: () => { ackChannel(c.id, last); renderRail(); renderSidebar(); } },
    { label: S.mutedChannels.has(c.id) ? "🔔 Sesi aç" : "🔕 Sessize al", fn: () => toggleMute(gid, c.id) },
    "-",
    { label: "Kanal ID'sini kopyala", fn: () => { navigator.clipboard.writeText(c.id); toast("Kopyalandı"); } },
  ]);
}

listen("ack", (e) => {
  const { channel_id, message_id } = e.payload;
  S.readStates[channel_id] = { last: message_id, mentions: 0 };
  S.unread.delete(channel_id); S.mentions.delete(channel_id);
  clearTimeout(listen._a); listen._a = setTimeout(() => { renderRail(); renderSidebar(); }, 150);
});
listen("mutes", (e) => {
  S.mutedGuilds = new Set(e.payload.guilds || []); S.mutedChannels = new Set(e.payload.channels || []);
  renderRail(); renderSidebar();
});

/* ------------------------------------------------------------------ */
/* Arkadaşlar                                                          */
/* ------------------------------------------------------------------ */
const REL = { FRIEND: 1, BLOCKED: 2, INCOMING: 3, OUTGOING: 4 };
const presenceOf = (f) => f.presence?.status || "offline";
function activityText(p) {
  const acts = p?.activities || [];
  const custom = acts.find((a) => a.type === 4);
  if (custom?.state) return (custom.emoji?.name && !custom.emoji.id ? custom.emoji.name + " " : "") + custom.state;
  const a = acts.find((x) => x.type !== 4);
  if (!a) return "";
  return ({ 0: "Oynuyor: ", 1: "Yayında: ", 2: "Dinliyor: ", 3: "İzliyor: ", 5: "Yarışıyor: " }[a.type] || "") + (a.type === 2 && a.details ? a.details : a.name);
}

function friendsRow() {
  const r = h("div", "ch dm friends-row" + (!S.channel && !$("#friends-view").classList.contains("hidden") ? " active" : ""),
    `<span class="fr-ico">👥</span><span class="name">Arkadaşlar</span>`);
  const pend = S.friends.filter((f) => f.type === REL.INCOMING).length;
  if (pend) r.append(h("span", "mbadge", pend));
  r.onclick = showFriends;
  return r;
}

let friendsTab = "online";
function showFriends() {
  S.channel = null; S.detached = false; hideJumpPresent();
  invoke("set_active_channel", { channelId: "" }).catch(() => {});
  for (const id of ["#messages", "#composer", "#hidden-view", "#forum-view", "#members", "#call-bar"]) $(id).classList.add("hidden");
  for (const id of ["#call-btn", "#members-btn", "#search-btn", "#pins-btn"]) $(id).classList.add("hidden");
  $("#friends-view").classList.remove("hidden");
  $("#ch-icon").textContent = "👥"; $("#ch-name").textContent = "Arkadaşlar"; $("#ch-topic").textContent = "";
  renderFriends(); renderSidebar();
}

async function openDmWith(u) {
  try {
    const d = await invoke("open_dm", { userId: u.id });
    if (!S.dms.some((x) => x.id === d.id)) S.dms.unshift({ id: d.id, type: d.type, name: d.name, icon: d.icon, recipients: d.recipients || [u], last_message_id: d.last_message_id });
    S.view = "home"; renderRail(); renderSidebar();
    openChannel({ id: d.id, guild_id: null, name: dname(u), type: 1, can_send: true });
  } catch (e) { toast("DM açılamadı: " + e); }
}

function renderFriends() {
  const v = $("#friends-view"); v.textContent = "";
  const counts = {
    online: S.friends.filter((f) => f.type === REL.FRIEND && !["offline", "invisible"].includes(presenceOf(f))).length,
    all: S.friends.filter((f) => f.type === REL.FRIEND).length,
    pending: S.friends.filter((f) => f.type === REL.INCOMING || f.type === REL.OUTGOING).length,
    blocked: S.friends.filter((f) => f.type === REL.BLOCKED).length,
  };
  const tabs = h("div", "fr-tabs");
  for (const [k, label] of [["online", "Çevrimiçi"], ["all", "Tümü"], ["pending", "Bekleyen"], ["blocked", "Engellenen"], ["add", "Arkadaş ekle"]]) {
    const b = h("button", "fr-tab" + (friendsTab === k ? " sel" : "") + (k === "add" ? " add" : ""), esc(label) + (counts[k] ? ` <small>${counts[k]}</small>` : ""));
    b.onclick = () => { friendsTab = k; renderFriends(); };
    tabs.append(b);
  }
  v.append(tabs);
  if (friendsTab === "add") {
    const box = h("div", "fr-add", `<h3>Arkadaş ekle</h3><p class="muted">Discord kullanıcı adıyla arkadaşlık isteği gönder.</p>`);
    const row = h("div", "fr-add-row");
    const inp = h("input", "inp"); inp.placeholder = "kullanıcı adı"; inp.spellcheck = false;
    const go = h("button", "btn primary", "İstek gönder");
    const sendReq = async () => {
      if (!inp.value.trim()) return;
      go.disabled = true;
      try { await invoke("add_friend", { username: inp.value }); toast("✅ İstek gönderildi: " + inp.value.trim()); inp.value = ""; }
      catch (e) { toast("Gönderilemedi: " + e); }
      finally { go.disabled = false; }
    };
    go.onclick = sendReq; inp.onkeydown = (e) => { if (e.key === "Enter") sendReq(); };
    row.append(inp, go); box.append(row); v.append(box);
    setTimeout(() => inp.focus(), 0);
    return;
  }
  const want = {
    online: (f) => f.type === REL.FRIEND && !["offline", "invisible"].includes(presenceOf(f)),
    all: (f) => f.type === REL.FRIEND,
    pending: (f) => f.type === REL.INCOMING || f.type === REL.OUTGOING,
    blocked: (f) => f.type === REL.BLOCKED,
  }[friendsTab];
  const list = S.friends.filter(want);
  const q = h("input", "inp fr-search"); q.placeholder = "Ara";
  const box = h("div", "fr-list");
  v.append(q, h("div", "fr-count muted", `${list.length} kişi`), box);
  const draw = () => {
    box.textContent = "";
    const s = q.value.toLowerCase();
    for (const f of list) {
      const u = f.user;
      if (s && !dname(u).toLowerCase().includes(s) && !(u.username || "").toLowerCase().includes(s)) continue;
      const st = presenceOf(f);
      const sub = f.type === REL.INCOMING ? "Gelen arkadaşlık isteği" : f.type === REL.OUTGOING ? "Giden arkadaşlık isteği" : f.type === REL.BLOCKED ? "Engellendi" : activityText(f.presence) || STATUS[st]?.[0] || "Çevrimdışı";
      const r = h("div", "fr-row");
      r.innerHTML = `<div class="fr-av" data-pop="${u.id}"><img src="${avatarUrl(u, 64)}"><span class="st ${st}"></span></div>
        <div class="fr-who"><b>${esc(dname(u))}</b> <span class="muted">@${esc(u.username || "")}</span><small>${esc(sub)}</small></div>`;
      const acts = h("div", "fr-acts");
      const ab = (ico, title, fn, cls = "") => { const b = h("button", "fr-btn " + cls, ico); b.title = title; b.onclick = (e) => { e.stopPropagation(); fn(); }; acts.append(b); };
      const rel = async (action, okMsg) => {
        try { await invoke("relationship_action", { userId: u.id, action }); toast(okMsg); }
        catch (e) { toast("Hata: " + e); }
      };
      if (f.type === REL.FRIEND) {
        ab("💬", "Mesaj gönder", () => openDmWith(u));
        ab("⋯", "Daha fazla", () => {
          const rc = r.getBoundingClientRect();
          showMenu({ clientX: rc.right - 180, clientY: rc.bottom }, [
            { label: "🏷 Yerel takma ad", fn: () => setNickname(u) },
            { label: "Arkadaşlıktan çıkar", danger: true, fn: () => confirm(`${dname(u)} arkadaşlıktan çıkarılsın mı?`) && rel("remove", "Arkadaşlıktan çıkarıldı") },
            { label: "Engelle", danger: true, fn: () => confirm(`${dname(u)} engellensin mi?`) && rel("block", "Engellendi") },
          ]);
        });
      } else if (f.type === REL.INCOMING) {
        ab("✓", "Kabul et", () => rel("accept", "✅ Arkadaş eklendi"), "ok");
        ab("✕", "Reddet", () => rel("remove", "Reddedildi"), "no");
      } else if (f.type === REL.OUTGOING) {
        ab("✕", "İsteği iptal et", () => rel("remove", "İstek iptal edildi"), "no");
      } else if (f.type === REL.BLOCKED) {
        ab("🔓", "Engeli kaldır", () => rel("remove", "Engel kaldırıldı"));
      }
      r.append(acts);
      if (f.type === REL.FRIEND) r.ondblclick = () => openDmWith(u);
      box.append(r);
    }
    if (!box.children.length) box.append(h("div", "fr-empty", friendsTab === "online" ? "🌙 Şu an kimse çevrimiçi değil" : friendsTab === "pending" ? "📭 Bekleyen istek yok" : "Kimse yok"));
  };
  q.oninput = draw; draw();
}

const friendsVisible = () => !$("#friends-view").classList.contains("hidden");
listen("friends", (e) => {
  const prevIn = new Set(S.friends.filter((f) => f.type === REL.INCOMING).map((f) => f.id));
  S.friends = e.payload || [];
  const fresh = S.friends.find((f) => f.type === REL.INCOMING && !prevIn.has(f.id));
  if (fresh && cfg.notify && cfg.status !== "dnd") notify("Arkadaşlık isteği", dname(fresh.user) + " seni eklemek istiyor");
  if (friendsVisible()) renderFriends();
  if (S.view === "home") renderSidebar();
});
listen("presence", (e) => {
  const f = S.friends.find((x) => x.id === e.payload.user_id);
  if (!f) return;
  f.presence = { status: e.payload.status, activities: e.payload.activities };
  if (friendsVisible()) { clearTimeout(listen._p); listen._p = setTimeout(renderFriends, 300); }
});

/* ------------------------------------------------------------------ */
/* Mesaj eylemleri: yer imi + çeviri                                   */
/* ------------------------------------------------------------------ */
const isBookmarked = (id) => cfg.bookmarks.some((b) => b.id === id);
function extraActions(btn, m, el) {
  if (m._deleted || SYSTEM[m.type]) return;
  if (m.content) btn("🌐", "Çevir", () => translateMsg(m, el));
  btn(isBookmarked(m.id) ? "🔖" : "🏷", isBookmarked(m.id) ? "Yer iminden çıkar" : "Yer imi ekle", (e) => {
    toggleBookmark(m);
    e.currentTarget.textContent = isBookmarked(m.id) ? "🔖" : "🏷";
    e.currentTarget.title = isBookmarked(m.id) ? "Yer iminden çıkar" : "Yer imi ekle";
  }, isBookmarked(m.id) ? "on" : "");
}

function whereOf(cid) {
  for (const g of S.guilds) {
    const c = g.channels.find((x) => x.id === cid) || (g.threads || []).find((x) => x.id === cid);
    if (c) return { guild_id: g.id, where: `${g.name} › #${c.name}` };
  }
  const d = S.dms.find((x) => x.id === cid);
  return { guild_id: null, where: d ? "@" + (d.name || d.recipients.map(dname).join(", ")) : "?" };
}

function toggleBookmark(m) {
  const i = cfg.bookmarks.findIndex((b) => b.id === m.id);
  if (i >= 0) { cfg.bookmarks.splice(i, 1); toast("Yer imi kaldırıldı"); }
  else {
    const a = m.author || {};
    cfg.bookmarks.unshift({
      id: m.id, channel_id: m.channel_id, ...whereOf(m.channel_id),
      author: { id: a.id, username: a.username, global_name: a.global_name, avatar: a.avatar },
      content: (m.content || "").slice(0, 500), atts: (m.attachments || []).length, timestamp: m.timestamp, saved_at: Date.now(),
    });
    cfg.bookmarks = cfg.bookmarks.slice(0, 500);
    toast("🔖 Yer imlerine eklendi");
  }
  saveCfg();
}

async function translateMsg(m, el) {
  const c = el.querySelector(".content");
  const old = el.querySelector(".translation");
  if (old) return old.remove();
  const t = h("div", "translation", "🌐 Çevriliyor…");
  c?.after(t);
  try {
    const r = await invoke("translate", { text: m.content, target: cfg.translateTo || "tr" });
    t.innerHTML = `<small>🌐 ${esc((r.from || "?").toUpperCase())} → ${esc((cfg.translateTo || "tr").toUpperCase())}</small>${md(r.text, m)}`;
  } catch (e) { t.textContent = "Çeviri başarısız: " + e; }
}

/* ------------------------------------------------------------------ */
/* Mesaja atlama (arama, sabit, yer imi)                               */
/* ------------------------------------------------------------------ */
function showJumpPresent() { $("#jump-present").classList.remove("hidden"); }
function hideJumpPresent() { $("#jump-present").classList.add("hidden"); }
$("#jump-present").onclick = () => { const c = S.channel; if (c) openChannel(c); };

function channelObj(cid) {
  for (const g of S.guilds) {
    const c = g.channels.find((x) => x.id === cid);
    if (c) return { ...c, guild_id: g.id };
    const t = (g.threads || []).find((x) => x.id === cid);
    if (t) { const p = g.channels.find((x) => x.id === t.parent_id); return { ...t, guild_id: g.id, can_send: p?.can_send ?? true, hidden: false, parent_name: p?.name }; }
  }
  const d = S.dms.find((x) => x.id === cid);
  if (d) return { id: d.id, guild_id: null, name: d.name || d.recipients.map(dname).join(", "), type: d.type, can_send: true, hidden: false };
  return null;
}

async function jumpToMessage(cid, mid, gidHint) {
  closeModal();
  if (S.channel?.id !== cid) {
    const c = channelObj(cid) || { id: cid, guild_id: gidHint || null, name: "kanal", type: 0, can_send: true, hidden: false };
    if (c.guild_id) { S.view = c.guild_id; } else S.view = "home";
    await openChannel({ ...c, textOnly: true });
  }
  if (S.channel?.id !== cid) return;
  if ($(`#messages .msg[data-id="${mid}"]`)) return jumpTo(mid);
  try {
    const list = await invoke("get_messages", { channelId: cid, before: null, around: mid });
    if (S.channel?.id !== cid) return;
    S.msgs = list; S.noMore = false; S.detached = true;
    renderMessages(); jumpTo(mid); showJumpPresent();
  } catch (e) { toast("Mesaja gidilemedi: " + e); }
}

function miniMsg(m, extra = "") {
  const r = h("div", "res-item");
  r.innerHTML = `<div class="lh"><img src="${avatarUrl(m.author, 32)}"><b>${esc(dname(m.author))}</b>${extra}<span style="margin-left:auto">${fmtTime(m.timestamp)}</span></div>
    <div class="lc">${md(m.content, m) || (m.attachments?.length ? "📎 " + m.attachments.map((a) => esc(a.filename)).join(", ") : "<i class='muted'>(içerik yok)</i>")}</div>`;
  return r;
}

/* ---------- Arama ---------- */
function openSearch(initial = "") {
  const c = S.channel; if (!c) return;
  const root = h("div", "search-box");
  const row = h("div", "fr-add-row");
  const q = h("input", "inp"); q.placeholder = c.guild_id ? "Sunucuda ara…" : "Bu sohbette ara…"; q.value = initial;
  const go = h("button", "btn primary", "Ara");
  row.append(q, go); root.append(row);
  let only = null;
  if (c.guild_id) {
    const l = h("label", "check", ""); only = h("input"); only.type = "checkbox";
    l.append(only, document.createTextNode(" Sadece #" + c.name)); root.append(l);
  }
  const res = h("div", "search-res"); root.append(res);
  let offset = 0;
  const run = async (more) => {
    if (!q.value.trim()) return;
    if (!more) { offset = 0; res.innerHTML = '<p class="muted">Aranıyor…</p>'; }
    try {
      const r = await invoke("search", { guildId: c.guild_id || null, channelId: !c.guild_id || only?.checked ? c.id : null, query: q.value.trim(), offset });
      if (!more) res.textContent = "";
      res.querySelector(".more")?.remove();
      if (!more) res.append(h("div", "muted fr-count", `${r.total_results ?? 0} sonuç`));
      for (const group of r.messages || []) {
        const m = group.find?.((x) => x.hit) || group[0] || group;
        const ch = channelObj(m.channel_id);
        const item = miniMsg(m, ch && c.guild_id ? `<span>#${esc(ch.name)}</span>` : "");
        item.onclick = () => jumpToMessage(m.channel_id, m.id, c.guild_id);
        res.append(item);
      }
      offset += (r.messages || []).length;
      if (offset < (r.total_results || 0) && (r.messages || []).length) {
        const mb = h("button", "btn more", "Daha fazla"); mb.onclick = () => run(true); res.append(mb);
      }
    } catch (e) { res.innerHTML = `<p class="err">${esc(e)}</p>`; }
  };
  go.onclick = () => run(false);
  q.onkeydown = (e) => { if (e.key === "Enter") run(false); };
  openModal("🔍 Ara", root); q.focus();
  if (initial) run(false);
}
$("#search-btn").onclick = () => openSearch();
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "f" && S.channel && !S.channel.hidden) { e.preventDefault(); openSearch(); }
});

/* ---------- Sabitler ---------- */
$("#pins-btn").onclick = async () => {
  const c = S.channel; if (!c) return;
  const root = h("div", "search-res", '<p class="muted">Yükleniyor…</p>');
  openModal("📌 Sabitlenmiş mesajlar", root);
  try {
    const list = await invoke("pins", { channelId: c.id });
    root.textContent = "";
    if (!list?.length) return root.append(h("div", "fr-empty", "📌 Bu kanalda sabitlenmiş mesaj yok"));
    for (const m of list) { const it = miniMsg(m); it.onclick = () => jumpToMessage(c.id, m.id, c.guild_id); root.append(it); }
  } catch (e) { root.innerHTML = `<p class="err">${esc(e)}</p>`; }
};

/* ---------- Yer imleri ---------- */
function bookmarksView() {
  const root = h("div", "search-res");
  if (!cfg.bookmarks.length) { root.append(h("div", "fr-empty", "🔖 Henüz yer imi yok — bir mesajın üstüne gelip 🏷 düğmesine bas.")); return root; }
  for (const b of cfg.bookmarks) {
    const it = miniMsg({ ...b, attachments: b.atts ? [{ filename: b.atts + " ek" }] : [] }, `<span>${esc(b.where)}</span>`);
    const x = h("button", "bm-x", "✕"); x.title = "Kaldır";
    x.onclick = (e) => { e.stopPropagation(); cfg.bookmarks = cfg.bookmarks.filter((y) => y.id !== b.id); saveCfg(); it.remove(); };
    it.querySelector(".lh").append(x);
    it.onclick = () => jumpToMessage(b.channel_id, b.id, b.guild_id);
    root.append(it);
  }
  return root;
}
$("#bookmarks-btn").onclick = () => openModal(`🔖 Yer imleri (${cfg.bookmarks.length})`, bookmarksView());

/* ------------------------------------------------------------------ */
/* Yerel takma adlar                                                   */
/* ------------------------------------------------------------------ */
function setNickname(u) {
  const box = h("div", "new-post");
  box.append(h("p", "muted", `<b>${esc(u.global_name || u.username)}</b> için sadece senin göreceğin bir ad.`));
  const inp = h("input", "inp"); inp.placeholder = "Takma ad (boş = kaldır)"; inp.maxLength = 32; inp.value = cfg.nicknames[u.id] || "";
  const ok = h("button", "btn primary", "Kaydet");
  const save = () => {
    const v = inp.value.trim();
    if (v) cfg.nicknames[u.id] = v; else delete cfg.nicknames[u.id];
    saveCfg(); closeModal();
    renderMessages(true); renderSidebar(); renderMe();
    if (friendsVisible()) renderFriends();
    toast(v ? "🏷 Takma ad kaydedildi" : "Takma ad kaldırıldı");
  };
  ok.onclick = save; inp.onkeydown = (e) => { if (e.key === "Enter") save(); };
  box.append(inp, ok);
  openModal("🏷 Yerel takma ad", box); inp.focus();
}

/* ------------------------------------------------------------------ */
/* GIF seçici                                                          */
/* ------------------------------------------------------------------ */
function openGifPicker(anchor) {
  closeEmojiPop();
  const pop = h("div", "emoji-pop gif-pop");
  const q = h("input"); q.placeholder = "Tenor'da GIF ara…";
  const grid = h("div", "gif-grid scroll");
  pop.append(q, grid);
  let seq = 0;
  const load = async () => {
    const my = ++seq;
    grid.innerHTML = '<p class="muted" style="padding:10px">Yükleniyor…</p>';
    try {
      const r = await invoke("gifs", { query: q.value });
      if (my !== seq) return;
      const list = Array.isArray(r) ? r : r?.gifs || [];
      grid.textContent = "";
      if (!list.length) grid.innerHTML = '<p class="muted" style="padding:10px">Sonuç yok</p>';
      for (const g of list.slice(0, 40)) {
        const b = h("button", "gif");
        const v = h("video"); v.src = g.src; v.autoplay = v.loop = v.muted = true; v.playsInline = true; v.preload = "metadata";
        b.append(v); b.title = g.url;
        b.onclick = async () => {
          closeEmojiPop();
          const reply = S.replyTo?.id ?? null; S.replyTo = null; $("#reply-bar").classList.add("hidden");
          try { await invoke("send_message", { channelId: S.channel.id, content: g.url, replyTo: reply, files: [] }); }
          catch (e) { toast("GIF gönderilemedi: " + e); }
        };
        grid.append(b);
      }
    } catch (e) { if (my === seq) grid.innerHTML = `<p class="err" style="padding:10px">${esc(e)}</p>`; }
  };
  let t = null;
  q.oninput = () => { clearTimeout(t); t = setTimeout(load, 400); };
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.right - 400, innerWidth - 408)) + "px";
  pop.style.top = Math.max(8, r.top - 446) + "px";
  emojiPop = pop; q.focus(); load();
}
$("#gif-btn").onclick = (e) => { if (!S.channel || $("#input").disabled) return; openGifPicker(e.currentTarget); };

/* ------------------------------------------------------------------ */
/* Bas-konuş, tepsi, otomatik başlatma                                 */
/* ------------------------------------------------------------------ */
let pttActive = false;
function syncPtt() {
  const want = !!(cfg.ptt && cfg.pttKey && S.vc.channel_id && S.vc.state !== "disconnected");
  if (want === pttActive && !syncPtt.force) return;
  syncPtt.force = false;
  pttActive = want;
  invoke("set_ptt", { enabled: want, shortcut: want ? cfg.pttKey : null }).catch((e) => { pttActive = false; toast("Bas-konuş: " + e); });
}
listen("voice-status", () => setTimeout(syncPtt, 0));
listen("ptt", (e) => { document.body.classList.toggle("ptt-down", !!e.payload); });
invoke("set_tray", { enabled: !!cfg.tray }).catch(() => {});

function keyName(e) {
  if (["ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(e.code)) return null;
  return (e.ctrlKey ? "Ctrl+" : "") + (e.shiftKey ? "Shift+" : "") + (e.altKey ? "Alt+" : "") + e.code;
}
const prettyKey = (k) => (k || "").replace(/Key([A-Z])/, "$1").replace(/Digit(\d)/, "$1");

const LANGS = [["tr", "Türkçe"], ["en", "English"], ["de", "Deutsch"], ["fr", "Français"], ["es", "Español"], ["ru", "Русский"], ["ar", "العربية"], ["ja", "日本語"], ["ko", "한국어"], ["az", "Azərbaycanca"]];

function extraSettings(root, sec, toggle) {
  const priv = sec("Gizlilik ve sohbet");
  toggle(priv, "ghostTyping", "Hayalet yazma 👻", "Yazarken karşı taraf \"yazıyor…\" görmez");
  const lr = h("div", "row", `<label>Çeviri dili<small>Mesajlardaki 🌐 düğmesi bu dile çevirir</small></label>`);
  const sel = h("select", "inp"); sel.style.maxWidth = "180px";
  for (const [k, n] of LANGS) { const o = h("option", null, n); o.value = k; o.selected = cfg.translateTo === k; sel.append(o); }
  sel.onchange = () => { cfg.translateTo = sel.value; saveCfg(); };
  lr.append(sel); priv.append(lr);
  const nk = Object.keys(cfg.nicknames).length;
  const nr = h("div", "row", `<label>Yerel takma adlar<small>${nk} kişiye takma ad verdin (profil kartından)</small></label>`);
  const nb = h("button", "btn", "Hepsini sil"); nb.disabled = !nk;
  nb.onclick = () => { cfg.nicknames = {}; saveCfg(); nb.disabled = true; renderMessages(true); renderSidebar(); toast("Takma adlar silindi"); };
  nr.append(nb); priv.append(nr);

  const v = sec("Bas-konuş");
  toggle(v, "ptt", "Bas-konuş modu", "Mikrofon sadece tuş basılıyken iletilir (oyun içindeyken de çalışır)", () => { syncPtt.force = true; syncPtt(); });
  const kr = h("div", "row", `<label>Kısayol<small>Tıkla ve bir tuşa bas (Ctrl/Shift/Alt ile birlikte olabilir)</small></label>`);
  const kb = h("button", "btn key-btn", cfg.pttKey ? prettyKey(cfg.pttKey) : "Tuş seç");
  kb.onclick = () => {
    kb.textContent = "Bir tuşa bas…"; kb.classList.add("listening");
    const on = (e) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === "Escape") { done(); return; }
      const k = keyName(e); if (!k) return;
      cfg.pttKey = k; saveCfg(); done(); syncPtt.force = true; syncPtt();
    };
    const done = () => { document.removeEventListener("keydown", on, true); kb.classList.remove("listening"); kb.textContent = cfg.pttKey ? prettyKey(cfg.pttKey) : "Tuş seç"; };
    document.addEventListener("keydown", on, true);
  };
  kr.append(kb); v.append(kr);

  const d = sec("Masaüstü");
  toggle(d, "tray", "Kapatınca tepsiye küçült", "Pencereyi kapatınca Shion arka planda çalışmaya devam eder (sağ alttaki simge)", () => invoke("set_tray", { enabled: cfg.tray }).catch(() => {}));
  const ar = h("div", "row", `<label>Windows ile başlat<small>Açılışta tepside küçültülmüş başlar</small></label>`);
  const ac = h("input", "switch"); ac.type = "checkbox"; ac.disabled = true;
  invoke("get_autostart").then((x) => { ac.checked = !!x; ac.disabled = false; }).catch(() => {});
  ac.onchange = async () => {
    try { ac.checked = !!(await invoke("set_autostart", { enabled: ac.checked })); toast(ac.checked ? "Windows ile başlayacak" : "Otomatik başlatma kapalı"); }
    catch (e) { toast("Ayarlanamadı: " + e); ac.checked = !ac.checked; }
  };
  ar.append(ac); d.append(ar);
}

listen("gw-ready", () => setTimeout(() => { if (!S.channel && S.view === "home") showFriends(); }, 400));
