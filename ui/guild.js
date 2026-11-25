"use strict";
/* Shion — sunucu katmanı: rol renkleri (gradyanlı roller dahil), mesaj yazarı rol rengi,
   sunucu profili (takma ad / sunucu avatarı / afiş / biyografi), roller ve yetkiler,
   ve açılır pencerelerin ekrana sığdırılması. rich.js'ten sonra yüklenir. */

/* ================================================================== */
/* Rol renkleri                                                        */
/* ================================================================== */
function roleColorSet(r) {
  if (!r) return null;
  const c = r.colors || {};
  const p = c.primary_color || r.color || 0;
  if (!p) return null;
  return { p: intColor(p), s: c.secondary_color ? intColor(c.secondary_color) : null, t: c.tertiary_color ? intColor(c.tertiary_color) : null };
}
/** Rengi olan en üst rol (Discord'daki gibi pozisyona göre; eşitlikte id'ye göre). */
function topColorRole(g, roles) {
  let best = null;
  for (const id of roles || []) {
    const r = g?.roles?.[id];
    if (!roleColorSet(r)) continue;
    if (!best || (r.position ?? 0) > (best.position ?? 0) || ((r.position ?? 0) === (best.position ?? 0) && BigInt(id) < BigInt(best.id))) best = { ...r, id };
  }
  return best;
}
topRoleColor = function (g, roles) { return roleColorSet(topColorRole(g, roles))?.p || null; };
/** Ada uygulanacak stil: düz renk ya da gradyan (Discord'un gradyan/holografik rolleri). */
function roleNameStyle(g, roles) {
  const c = roleColorSet(topColorRole(g, roles)); if (!c) return null;
  if (c.s) return { color: c.p, gradient: `linear-gradient(90deg, ${[c.p, c.s, c.t].filter(Boolean).join(", ")})` };
  return { color: c.p, gradient: null };
}
function paintName(el, st) {
  if (!el) return;
  el.classList.remove("role-grad"); el.style.removeProperty("--rg"); el.style.removeProperty("--rc");
  if (!st) { el.style.color = ""; return; }
  el.style.setProperty("--rc", st.color);
  if (st.gradient) { el.classList.add("role-grad"); el.style.setProperty("--rg", st.gradient); el.style.color = ""; }
  else el.style.color = st.color;
}

/* Üye rolleri önbelleği: guild id -> Map(user id -> rol id'leri) */
const memberRoles = new Map();
const rolesOf = (gid, uid) => memberRoles.get(gid)?.get(uid) || null;
function rememberRoles(gid, uid, roles) {
  if (!gid || !uid || !Array.isArray(roles)) return;
  if (!memberRoles.has(gid)) memberRoles.set(gid, new Map());
  memberRoles.get(gid).set(uid, roles);
}
function colorAuthor(el, gid, uid) {
  const a = el.querySelector(".head .author"); if (!a || a.classList.contains("styled-name")) return;
  const g = S.guilds.find((x) => x.id === gid);
  paintName(a, roleNameStyle(g, rolesOf(gid, uid)));
}
function recolorAuthors(gid, ids) {
  if (S.channel?.guild_id !== gid) return;
  for (const el of document.querySelectorAll("#messages .msg[data-uid]")) if (!ids || ids.has(el.dataset.uid)) colorAuthor(el, gid, el.dataset.uid);
}
let pendingRoles = new Set(), pendingTimer = 0;
function wantRoles(gid, uid) {
  pendingRoles.add(uid);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(async () => {
    const ids = [...pendingRoles]; pendingRoles = new Set();
    if (!ids.length || S.channel?.guild_id !== gid) return;
    try {
      const known = await invoke("member_roles", { guildId: gid, userIds: ids });
      for (const [uid, r] of Object.entries(known || {})) rememberRoles(gid, uid, r);
      recolorAuthors(gid, new Set(Object.keys(known || {})));
    } catch {}
  }, 60);
}
{
  const base = vcPost;
  vcPost = function (el, m) {
    base(el, m);
    const gid = S.channel?.guild_id || m.guild_id, uid = m.author?.id;
    if (!gid || !uid || m.webhook_id) return;
    if (m.member?.roles) rememberRoles(gid, uid, m.member.roles);
    if (rolesOf(gid, uid)) colorAuthor(el, gid, uid);
    else wantRoles(gid, uid);
  };
}
listen("member-roles", (e) => {
  const { guild_id: gid, members } = e.payload || {};
  if (!gid || !members) return;
  for (const [uid, r] of Object.entries(members)) rememberRoles(gid, uid, r);
  recolorAuthors(gid, new Set(Object.keys(members)));
});
listen("guilds-changed", () => { if (S.channel?.guild_id) setTimeout(() => recolorAuthors(S.channel.guild_id), 800); });
/* Üye listesi: gradyanlı rol adları + önbelleği doldur */
{
  const base = renderMembers;
  renderMembers = function () {
    base();
    const g = S.guilds.find((x) => x.id === S.members.guild); if (!g) return;
    const byId = new Map();
    for (const it of S.members.items) if (it?.member?.user) { byId.set(it.member.user.id, it.member); rememberRoles(g.id, it.member.user.id, it.member.roles); }
    for (const row of document.querySelectorAll("#members .m-row[data-pop]")) {
      const m = byId.get(row.dataset.pop); if (!m) continue;
      const st = roleNameStyle(g, m.roles); const b = row.querySelector(".m-name b");
      if (st?.gradient && b) paintName(b, st);
    }
  };
}

/* ================================================================== */
/* Sunucu profili: takma ad, sunucu avatarı/afişi/biyografisi, roller, yetkiler */
/* ================================================================== */
const PERM_LIST = [
  ["ADMINISTRATOR", 3n, "👑 Yönetici (bütün yetkiler)", 1],
  ["MANAGE_GUILD", 5n, "Sunucuyu yönet", 1], ["MANAGE_ROLES", 28n, "Rolleri yönet", 1], ["MANAGE_CHANNELS", 4n, "Kanalları yönet", 1],
  ["KICK_MEMBERS", 1n, "Üyeleri at", 1], ["BAN_MEMBERS", 2n, "Üyeleri yasakla", 1], ["MODERATE_MEMBERS", 40n, "Zaman aşımı uygula", 1],
  ["MANAGE_MESSAGES", 13n, "Mesajları yönet", 1], ["MANAGE_NICKNAMES", 27n, "Takma adları yönet", 1], ["MANAGE_WEBHOOKS", 29n, "Webhook'ları yönet", 1],
  ["MANAGE_EXPRESSIONS", 30n, "İfadeleri yönet", 1], ["MANAGE_EVENTS", 33n, "Etkinlikleri yönet", 1], ["MANAGE_THREADS", 34n, "Alt başlıkları yönet", 1],
  ["VIEW_AUDIT_LOG", 7n, "Denetim kaydını gör", 1], ["MENTION_EVERYONE", 17n, "@everyone bahset", 1],
  ["MUTE_MEMBERS", 22n, "Üyeleri sustur", 1], ["DEAFEN_MEMBERS", 23n, "Üyeleri sağırlaştır", 1], ["MOVE_MEMBERS", 24n, "Üyeleri taşı", 1],
  ["VIEW_CHANNEL", 10n, "Kanalları görüntüle", 0], ["SEND_MESSAGES", 11n, "Mesaj gönder", 0], ["READ_HISTORY", 16n, "Mesaj geçmişini oku", 0],
  ["EMBED_LINKS", 14n, "Bağlantı yerleştir", 0], ["ATTACH_FILES", 15n, "Dosya ekle", 0], ["ADD_REACTIONS", 6n, "Tepki ekle", 0],
  ["EXTERNAL_EMOJIS", 18n, "Harici emoji", 0], ["SEND_VOICE", 46n, "Sesli mesaj", 0], ["SEND_POLLS", 49n, "Anket oluştur", 0],
  ["CREATE_INVITE", 0n, "Davet oluştur", 0], ["CHANGE_NICKNAME", 26n, "Takma adını değiştir", 0], ["USE_COMMANDS", 31n, "Uygulama komutları", 0],
  ["CONNECT", 20n, "Sese bağlan", 0], ["SPEAK", 21n, "Konuş", 0], ["STREAM", 9n, "Yayın / kamera", 0], ["USE_VAD", 25n, "Ses etkinliği", 0], ["PRIORITY_SPEAKER", 8n, "Öncelikli konuşmacı", 0],
];
function memberPerms(g, uid, roles) {
  if (g.owner_id && g.owner_id === uid) return { all: true, bits: -1n, owner: true };
  let bits = BigInt(g.roles?.[g.id]?.permissions || 0);
  for (const id of roles || []) bits |= BigInt(g.roles?.[id]?.permissions || 0);
  return { all: (bits & (1n << 3n)) !== 0n, bits, owner: false };
}
const assetExt = (hash, still) => (hash?.startsWith("a_") && !still ? "gif" : "webp");
function guildAvatarUrl(gid, uid, hash, size = 128) { return `${CDN}/guilds/${gid}/users/${uid}/avatars/${hash}.${assetExt(hash)}?size=${size}`; }
function guildBannerUrl(gid, uid, hash) { return `${CDN}/guilds/${gid}/users/${uid}/banners/${hash}.${assetExt(hash)}?size=600`; }
function roleChip(g, id) {
  const r = g.roles?.[id]; if (!r) return "";
  const c = roleColorSet(r), dot = c ? (c.s ? `background:linear-gradient(135deg,${[c.p, c.s, c.t].filter(Boolean).join(",")})` : `background:${c.p}`) : "background:var(--muted)";
  const icon = r.icon ? `<img class="role-ic" alt="" src="${CDN}/role-icons/${id}/${r.icon}.webp?size=32">` : r.unicode_emoji ? `<span class="role-ic">${esc(r.unicode_emoji)}</span>` : "";
  return `<span class="role-chip" title="${esc(r.name)}" style="--rcol:${c?.p || "var(--muted)"}"><i style="${dot}"></i>${icon}${esc(r.name)}</span>`;
}
function serverSection(g, u, prof, roles) {
  const gm = prof?.guild_member || {};
  const sorted = [...new Set(roles || [])].filter((id) => g.roles?.[id] && id !== g.id).sort((a, b) => (g.roles[b].position ?? 0) - (g.roles[a].position ?? 0));
  const p = memberPerms(g, u.id, sorted);
  const has = (bit) => p.all || (p.bits & (1n << bit)) !== 0n;
  const key = PERM_LIST.filter(([, , , k]) => k === 1).filter(([, b]) => has(b)), basic = PERM_LIST.filter(([, , , k]) => k === 0).filter(([, b]) => has(b));
  const wrap = h("div", "pc-server");
  const head = p.owner ? `<span class="srv-tag owner">👑 Sunucu sahibi</span>` : p.all ? `<span class="srv-tag admin">🛡 Yönetici</span>` : key.length ? `<span class="srv-tag mod">🔧 Yetkili</span>` : "";
  wrap.innerHTML = `<div class="pc-sec"><h5>${esc(g.name)} ${head}</h5>
      ${sorted.length ? `<div class="role-chips">${sorted.map((id) => roleChip(g, id)).join("")}</div>` : `<div class="muted">Bu sunucuda rolü yok</div>`}
    <details class="pc-perms"><summary>Yetkiler · ${p.owner || p.all ? "hepsi" : key.length + basic.length}</summary>
      ${p.owner || p.all ? `<div class="perm-note">${p.owner ? "Sunucu sahibi bütün yetkilere sahiptir." : "Yönetici yetkisi bütün yetkileri kapsar."}</div>` : ""}
      ${key.length ? `<div class="perm-grp"><b>Yönetim</b>${key.map(([, , n]) => `<span class="perm key">${esc(n)}</span>`).join("")}</div>` : ""}
      ${!p.all && basic.length ? `<div class="perm-grp"><b>Genel</b>${basic.map(([, , n]) => `<span class="perm">${esc(n)}</span>`).join("")}</div>` : ""}
      <small class="muted">Kanal izinleri bunları kanal bazında değiştirebilir.</small>
    </details></div>`;
  if (sorted.length > 12) {
    const chips = wrap.querySelector(".role-chips"); chips.classList.add("clamped");
    const more = h("button", "role-more", `+${sorted.length - 12} rol daha`);
    more.onclick = () => { chips.classList.remove("clamped"); more.remove(); placePopout(); };
    chips.after(more);
  }
  wrap.querySelector("details").addEventListener("toggle", () => placePopout());
  return wrap;
}
function applyServerProfile(pop, u, prof, g) {
  const pc = pop.querySelector(".pc"); if (!pc) return;
  const gm = prof?.guild_member || {}, gp = prof?.guild_member_profile || {};
  const nameEl = pc.querySelector(".pc-name"), avEl = pc.querySelector(".pc-av img"), banEl = pc.querySelector(".pc-banner");
  const bioSec = [...pc.querySelectorAll(".pc-sec")].find((s) => s.querySelector(".pc-bio"));
  const global = { name: nameEl?.textContent, av: avEl?.src, ban: banEl?.style.backgroundImage, bio: bioSec?.querySelector(".pc-bio").innerHTML || "" };
  const server = {
    name: gm.nick || null,
    av: gm.avatar ? guildAvatarUrl(g.id, u.id, gm.avatar) : null,
    ban: gm.banner || gp.banner ? `url('${guildBannerUrl(g.id, u.id, gm.banner || gp.banner)}')` : null,
    bio: gp.bio ? md(gp.bio) : null,
  };
  const differs = server.name || server.av || server.ban || server.bio;
  const st = roleNameStyle(g, gm.roles || rolesOf(g.id, u.id));
  const show = (srv) => {
    if (nameEl) { nameEl.textContent = (srv && server.name) || global.name; paintName(nameEl, srv ? st : null); }
    if (avEl) avEl.src = (srv && server.av) || global.av;
    if (banEl && (server.ban || !srv)) banEl.style.backgroundImage = (srv && server.ban) || global.ban;
    if (bioSec || server.bio) {
      let sec = bioSec || pc.querySelector(".pc-sbio");
      if (!sec) { sec = h("div", "pc-sec pc-sbio", `<h5>Hakkımda</h5><div class="pc-bio"></div>`); pc.querySelector(".pc-user")?.after(sec); }
      sec.querySelector(".pc-bio").innerHTML = (srv && server.bio) || global.bio;
      sec.style.display = sec.querySelector(".pc-bio").innerHTML.trim() ? "" : "none";
    }
    pc.classList.toggle("srv-view", !!srv);
    tog && (tog.innerHTML = srv ? "🌐 Genel profili göster" : `🏠 ${esc(g.name)} profilini göster`);
  };
  let tog = null, srv = true;
  if (differs) {
    tog = h("button", "srv-toggle");
    tog.onclick = (e) => { e.stopPropagation(); srv = !srv; show(srv); placePopout(); };
    pc.querySelector(".pc-user")?.after(tog);
  }
  show(true);
  const roles = gm.roles || rolesOf(g.id, u.id);
  if (gm.roles) rememberRoles(g.id, u.id, gm.roles);
  if (roles) {
    const sec = serverSection(g, u, prof, roles);
    const anchor = pc.querySelector(".pc-hidden") || pc.querySelector(".pc-dm");
    if (anchor) anchor.before(sec); else pc.querySelector(".pc-body")?.append(sec);
  }
}
/** Profil kartının hangi sunucu bağlamında açıldığı: açık kanalın sunucusu, yoksa seçili sunucu. */
const profileGuildId = () => S.channel?.guild_id || (S.view && S.view !== "home" ? S.view : null);
{
  const base = fetchProfile;
  fetchProfile = function (userId, guildId) { return base(userId, guildId || profileGuildId()); };
}
{
  const base = visualProfile;
  visualProfile = function (pop, u, prof) {
    base(pop, u, prof);
    const gid = profileGuildId();
    const g = gid && S.guilds.find((x) => x.id === gid);
    if (g && !pop.querySelector(".pc-server") && (prof?.guild_member || rolesOf(g.id, u.id))) applyServerProfile(pop, u, prof, g);
    placePopout();
  };
}

/* ================================================================== */
/* Ekrana sığdırma: açılır kartlar, menüler, seçiciler                  */
/* ================================================================== */
const FLOATERS = ".popout, .menu, .emoji-pop, .gif-pop, .sticker-pop, .sb-pop";
function fitFloater(el) {
  if (!el?.isConnected) return;
  const m = 8, vw = innerWidth, vh = innerHeight;
  el.style.maxHeight = vh - m * 2 + "px"; el.style.maxWidth = vw - m * 2 + "px";
  const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
  let dx = 0, dy = 0;
  if (r.right > vw - m) dx = vw - m - r.right;
  if (r.left + dx < m) dx = m - r.left;
  if (r.bottom > vh - m) dy = vh - m - r.bottom;
  if (r.top + dy < m) dy = m - r.top;
  if (!dx && !dy) return;
  const cs = getComputedStyle(el);
  if (cs.position !== "fixed" && cs.position !== "absolute") return;
  if (dx) { if (el.style.right && el.style.right !== "auto" && !el.style.left) el.style.right = parseFloat(cs.right) - dx + "px"; else el.style.left = r.left + dx + "px"; }
  if (dy) {
    if (el.style.bottom && el.style.bottom !== "auto" && !el.style.top) el.style.bottom = parseFloat(cs.bottom) - dy + "px";
    else { el.style.top = r.top + dy + "px"; if (cs.bottom !== "auto" && !el.style.bottom) el.style.bottom = "auto"; }
  }
}
function placePopout() { requestAnimationFrame(() => document.querySelectorAll(".popout").forEach(fitFloater)); }
const fitRO = new ResizeObserver((entries) => { for (const e of entries) fitFloater(e.target); });
new MutationObserver((muts) => {
  for (const mu of muts) for (const n of mu.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.matches?.(FLOATERS)) { fitRO.observe(n); requestAnimationFrame(() => fitFloater(n)); }
    if (n.matches?.(".popout")) n.addEventListener("load", () => fitFloater(n), true);
  }
}).observe(document.body, { childList: true });
addEventListener("resize", () => document.querySelectorAll(FLOATERS).forEach(fitFloater));

WHATS_NEW.unshift(
  ["🎨", "0.4.1 · Rol renkleri ve sunucu profili", "Sohbette isimler rol renginde (gradyanlı roller dahil). Sunucudayken profil kartında sunucu takma adı/avatarı/biyografisi, roller ve yetkiler", null],
  ["📐", "Her şey ekrana sığıyor", "Profil kartı, menüler, seçiciler ve pencereler küçük ekranda taşmıyor; içerik kısılmadan kayıyor", null],
);
