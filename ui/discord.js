"use strict";
/* Shion — Discord'daki eksikler: bahsetmeler kutusu, mesaj iletme, okunmadı işaretleme, ses tahtası,
   etkinlikler, kullanıcı notları, ortak arkadaşlar, otomatik boşta, yanıt bildirimi, kısayollar,
   gizli kanal düzeni, teşhis ekranı ve hızlı açılış önbelleği. plus.js'ten sonra yüklenir. */

const DC_DEFAULTS = { hideRedacted: false, groupRedacted: true, autoIdle: true, autoIdleMin: 10, replyPing: true, soundboard: true, sbVolume: 0.6, fastStart: true };
for (const [k, v] of Object.entries(DC_DEFAULTS)) if (cfg[k] === undefined) cfg[k] = v;

/* ------------------------------------------------------------------ */
/* Gizli kanal düzeni                                                  */
/* ------------------------------------------------------------------ */
const openRedacted = new Set();
const hasVoiceUsers = (c) => [...S.vstates.values()].some((v) => v.channel_id === c.id);
/** Discord adını sildiği kanalları gizle (içinde biri olan ses kanalları hariç). */
function redactedFilter(c) {
  return !(cfg.hideRedacted && c.redacted && c.name === "gizli-kanal" && !hasVoiceUsers(c));
}
/** Arka arkaya gelen adsız gizli kanalları tek satırda topla. */
function appendChannels(list, kids, g) {
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const key = run[0].id;
    if (run.length < 3 || !cfg.groupRedacted || openRedacted.has(key)) {
      run.forEach((c) => list.append(rowWithThreads(c, g)));
      if (run.length >= 3 && cfg.groupRedacted) {
        const r = h("div", "ch redacted-group open", `<span class="ico">🔒</span><span class="name">${run.length} gizli kanalı daralt</span>`);
        r.onclick = () => { openRedacted.delete(key); renderSidebar(); };
        list.append(r);
      }
    } else {
      const r = h("div", "ch redacted-group", `<span class="ico">🔒</span><span class="name">${run.length} gizli kanal</span>`);
      r.title = "Discord bu kanalların adlarını gizliyor — tıkla ve listele";
      r.onclick = () => { openRedacted.add(key); renderSidebar(); };
      list.append(r);
    }
    run = [];
  };
  for (const c of kids) {
    const anon = c.redacted && c.name === "gizli-kanal" && !hasVoiceUsers(c) && c.id !== S.channel?.id;
    if (anon) { run.push(c); continue; }
    flush();
    list.append(rowWithThreads(c, g));
  }
  flush();
}

/* ------------------------------------------------------------------ */
/* Teşhis                                                              */
/* ------------------------------------------------------------------ */
async function openDiagnostics() {
  const box = h("div", "diag", '<div class="muted">Kontrol ediliyor…</div>');
  openModal("Discord bağlantı teşhisi", box);
  let d;
  try { d = await invoke("diagnostics"); } catch (e) { box.textContent = "Alınamadı: " + e; return; }
  const r = d.ready || {};
  const issues = [];
  if (!d.gateway) issues.push(["bad", "Gateway bağlantısı yok"]);
  if (r.missing?.length) issues.push(["bad", "Discord'un göndermediği beklenen alanlar: " + r.missing.join(", ") + " — Discord bir şeyi değiştirmiş olabilir"]);
  if (d.voice_unknown) issues.push(["warn", `${d.voice_unknown} ses kullanıcısının bilgisi henüz gelmedi (birkaç saniye içinde istenir)`]);
  if (d.guilds_without_roles) issues.push(["warn", `${d.guilds_without_roles} sunucuda rol bilgin yok — gizli kanal hesabı eksik olabilir`]);
  if (r.legacy_users === false) issues.push(["info", "READY yeni biçimde (kullanıcılar sunucu üye listesinde) — Shion bunu destekliyor"]);
  if (d.redacted) issues.push(["info", `${d.redacted} kanalın adı Discord tarafından gizleniyor; ${d.redacted_named} tanesinin eski adı kayıtlı`]);
  if (!issues.some((x) => x[0] !== "info")) issues.unshift(["ok", "Her şey yolunda görünüyor"]);
  const rows = [["Sürüm", d.version], ["Sunucu", d.guilds], ["Kanal", d.channels], ["Ses kanalındaki kişi", d.voice_users], ["Önbellekteki kullanıcı", d.users_cached],
    ["DM", d.dms], ["Arkadaş / ilişki", d.friends], ["Kayıtlı kanal adı", d.known_names], ["Not", d.notes], ["API sürümü", r.api_version ?? "?"], ["READY alan sayısı", r.keys ?? "?"]];
  const icon = { ok: "✅", bad: "⛔", warn: "⚠️", info: "ℹ️" };
  box.innerHTML = `<div class="diag-issues">${issues.map(([k, t]) => `<div class="diag-${k}">${icon[k]} ${esc(t)}</div>`).join("")}</div>
    <div class="diag-grid">${rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(String(v))}</b>`).join("")}</div>`;
  const cp = h("button", "btn", "Raporu kopyala");
  cp.onclick = () => { navigator.clipboard.writeText(JSON.stringify(d, null, 2)); toast("Kopyalandı (token içermez)"); };
  box.append(cp);
}

/* ------------------------------------------------------------------ */
/* Hızlı açılış önbelleği                                              */
/* ------------------------------------------------------------------ */
let CACHE = null;
const recentChannels = () => lsGet("shion.recentCh", []);
function noteRecent(id) { lsSet("shion.recentCh", [id, ...recentChannels().filter((x) => x !== id)].slice(0, 20)); }
const cachedMsgs = (id) => CACHE?.messages?.[id] || null;
async function applyCache() {
  if (!cfg.fastStart || !S.me || S.guilds.length) return;
  let c = null;
  try { c = await invoke("load_cache", { userId: S.me.id }); } catch {}
  if (!c || S.guilds.length) return;
  CACHE = c;
  S.guilds = (c.guilds || []).map((g) => ({ ...g, voice_states: [] }));
  S.dms = c.dms || []; S.folders = c.folders;
  try { applySocial(c); } catch {}
  renderRail(); renderSidebar(); renderMe(); showSplash(false);
  $("#messages").innerHTML = '<div class="empty">Bağlanıyor… (son kayıttan gösteriliyor)</div>';
}
function saveCache() {
  if (!cfg.fastStart || !S.me || !S.guilds.length) return;
  const ch = recentChannels(); if (S.channel && !ch.includes(S.channel.id)) ch.unshift(S.channel.id);
  invoke("save_cache", { channels: ch }).catch(() => {});
}
listen("gw-ready", () => setTimeout(saveCache, 20000));
setInterval(saveCache, 180000);
document.addEventListener("visibilitychange", () => { if (document.hidden) saveCache(); });

/* ------------------------------------------------------------------ */
/* Bahsetmeler kutusu                                                  */
/* ------------------------------------------------------------------ */
async function openInbox() {
  const root = h("div", "inbox");
  const bar = h("div", "inbox-bar");
  const ev = h("label", "muted", `<input type="checkbox" ${cfg.inboxEveryone !== false ? "checked" : ""}> @everyone / @here dahil`);
  const kw = h("button", "btn", "🔔 Anahtar kelime eşleşmeleri"); kw.onclick = () => openKeywordHits();
  bar.append(ev, kw);
  const list = h("div", "res-list");
  const more = h("button", "btn", "Daha fazla"); more.style.display = "none";
  root.append(bar, list, more);
  openModal("Bahsetmeler", root);
  let before = null;
  const load = async () => {
    more.disabled = true;
    try {
      const msgs = await invoke("mentions_inbox", { before, everyone: cfg.inboxEveryone !== false });
      if (!before) list.textContent = "";
      for (const m of msgs) {
        const w = whereOf(m.channel_id);
        const it = miniMsg(m, `<span class="muted" style="margin-left:6px">${esc(w.where === "?" ? "" : w.where)}</span>`);
        it.onclick = () => jumpToMessage(m.channel_id, m.id, m.guild_id || w.guild_id);
        list.append(it);
      }
      if (!before && !msgs.length) list.innerHTML = '<div class="empty">Seni etiketleyen mesaj yok 🎉</div>';
      before = msgs.length ? msgs[msgs.length - 1].id : before;
      more.style.display = msgs.length >= 25 ? "" : "none";
    } catch (e) { list.innerHTML = `<div class="empty">Alınamadı: ${esc(e)}</div>`; }
    more.disabled = false;
  };
  ev.querySelector("input").onchange = (e) => { cfg.inboxEveryone = e.target.checked; saveCfg(); before = null; load(); };
  more.onclick = load;
  list.innerHTML = '<div class="empty">Yükleniyor…</div>';
  load();
}
{
  const b = h("button", "hdr-btn", '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 5 18.7l-1-1.7A8 8 0 1 1 20 12v1.5a1.5 1.5 0 0 1-3 0V12a5 5 0 1 0-1.5 3.5A3.5 3.5 0 0 0 22 13.5V12A10 10 0 0 0 12 2zm0 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6z" fill="currentColor"/></svg>');
  b.id = "inbox-btn"; b.title = "Bahsetmeler (Ctrl+I)"; b.onclick = openInbox;
  $("#bookmarks-btn").before(b);
}

/* ------------------------------------------------------------------ */
/* Mesaj eylemleri: ilet, okunmadı işaretle                            */
/* ------------------------------------------------------------------ */
function discordActions(btn, m) {
  if (m._deleted || SYSTEM[m.type]) return;
  btn("➦", "İlet", () => openForward(m));
  btn("◉", "Buradan itibaren okunmadı işaretle", () => markUnreadFrom(m));
}

function channelTargets() {
  const out = [];
  for (const d of S.dms) out.push({ id: d.id, label: "@" + (d.name || d.recipients.map(dname).join(", ")), icon: d.recipients?.[0] ? avatarUrl(d.recipients[0], 32) : null, gid: null });
  for (const g of S.guilds) for (const c of g.channels) if (TEXTLIKE.has(c.type) && !c.hidden && c.can_send !== false) out.push({ id: c.id, label: `#${c.name}`, sub: g.name, gid: g.id, icon: guildIcon(g, 32) });
  return out;
}
function openForward(m) {
  const root = h("div", "fwd");
  const prev = miniMsg(m); prev.classList.add("fwd-prev");
  const q = h("input", "inp"); q.placeholder = "Kanal ya da kişi ara…";
  const list = h("div", "fwd-list");
  const note = h("input", "inp"); note.placeholder = "İsteğe bağlı mesaj ekle";
  const go = h("button", "btn ok", "Gönder");
  const picked = new Set();
  const all = channelTargets();
  const draw = () => {
    const t = q.value.toLowerCase().trim();
    const shown = all.filter((x) => !t || x.label.toLowerCase().includes(t) || x.sub?.toLowerCase().includes(t)).slice(0, 60);
    list.innerHTML = "";
    for (const x of shown) {
      const r = h("label", "fwd-item", `<input type="checkbox" ${picked.has(x.id) ? "checked" : ""}>${x.icon ? `<img src="${x.icon}">` : '<span class="mini">#</span>'}<span>${esc(x.label)}</span>${x.sub ? `<small class="muted">${esc(x.sub)}</small>` : ""}`);
      r.querySelector("input").onchange = (e) => { e.target.checked ? picked.add(x.id) : picked.delete(x.id); go.textContent = picked.size ? `Gönder (${picked.size})` : "Gönder"; };
      list.append(r);
    }
  };
  q.oninput = draw; draw();
  go.onclick = async () => {
    if (!picked.size) return toast("Bir hedef seç");
    if (picked.size > 5) return toast("En fazla 5 yere iletebilirsin");
    go.disabled = true;
    let ok = 0;
    for (const target of picked) {
      try { await invoke("forward_message", { channelId: m.channel_id, messageId: m.id, guildId: S.channel?.guild_id || null, target, note: note.value || null }); ok++; }
      catch (e) { toast("İletilemedi: " + e); }
    }
    if (ok) { toast(`➦ ${ok} yere iletildi`); closeModal(); } else go.disabled = false;
  };
  root.append(prev, q, list, note, go);
  openModal("Mesajı ilet", root);
  setTimeout(() => q.focus(), 30);
}

async function markUnreadFrom(m) {
  const i = S.msgs.findIndex((x) => x.id === m.id);
  const before = i > 0 ? S.msgs[i - 1].id : (BigInt(m.id) - 1n).toString();
  try {
    await invoke("mark_unread", { channelId: m.channel_id, beforeId: before });
    S.readStates[m.channel_id] = { last: before, mentions: 0 };
    S.channel = null; // açık kanal tekrar okundu sayılmasın
    S.unread.add(m.channel_id);
    renderRail(); renderSidebar();
    $("#messages").innerHTML = '<div class="empty">◉ Okunmadı olarak işaretlendi</div>';
    $("#composer").classList.add("hidden");
    toast("Okunmadı olarak işaretlendi");
  } catch (e) { toast("İşaretlenemedi: " + e); }
}

/* İletilmiş mesajların içeriği (message_snapshots) */
function renderForward(m) {
  const box = h("div", "fwd-box");
  for (const s of m.message_snapshots || []) {
    const sm = s.message || {};
    box.append(h("div", "fwd-head muted", "➦ İletildi"));
    if (sm.content) box.append(h("div", "content", md(sm.content, sm)));
    for (const a of sm.attachments || []) {
      if ((a.content_type || "").startsWith("image/")) { const img = h("img"); img.loading = "lazy"; img.src = a.proxy_url || a.url; img.onclick = () => lightbox(a.url); box.append(img); }
      else { const f = h("a", "file", `📄 <span>${esc(a.filename)}</span>`); f.href = a.url; box.append(f); }
    }
    for (const e of sm.embeds || []) box.append(renderEmbed(e));
    for (const st of sm.sticker_items || []) { const i = h("img", "sticker"); i.src = `https://media.discordapp.net/stickers/${st.id}.webp?size=160`; box.append(i); }
  }
  const ref = m.message_reference;
  if (ref?.channel_id && ref?.message_id) {
    const w = whereOf(ref.channel_id);
    const src = h("div", "fwd-src muted", `${esc(w.where === "?" ? "başka bir kanal" : w.where)} · ${fmtTime(snowTime(ref.message_id))} ›`);
    src.onclick = () => jumpToMessage(ref.channel_id, ref.message_id, ref.guild_id || w.guild_id);
    box.append(src);
  }
  return box;
}

/* ------------------------------------------------------------------ */
/* Yanıtta bildirim (@ açık/kapalı)                                    */
/* ------------------------------------------------------------------ */
S.replyPing = cfg.replyPing;
function replyPingButton(bar) {
  let b = bar.querySelector(".ping-toggle");
  if (!b) { b = h("button", "ping-toggle"); bar.querySelector("span").after(b); }
  S.replyPing = cfg.replyPing;
  const draw = () => { b.textContent = S.replyPing ? "@ AÇIK" : "@ KAPALI"; b.classList.toggle("off", !S.replyPing); b.title = "Yanıtladığın kişiye bildirim gitsin mi?"; };
  b.onclick = () => { S.replyPing = !S.replyPing; cfg.replyPing = S.replyPing; saveCfg(); draw(); };
  draw();
}

/* ------------------------------------------------------------------ */
/* Ses tahtası                                                         */
/* ------------------------------------------------------------------ */
let defaultSounds = null;
const soundUrl = (id) => `https://cdn.discordapp.com/soundboard-sounds/${id}`;
function soundboardButton(p) {
  if (!cfg.soundboard || S.vc.state !== "connected") return;
  const b = h("button", "btn sb-btn", "🔊 Ses tahtası");
  b.onclick = (e) => openSoundboard(e.currentTarget);
  p.append(b);
}
async function openSoundboard(anchor) {
  document.querySelector(".sb-pop")?.remove();
  const pop = h("div", "sb-pop emoji-pop");
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, r.left) + "px"; pop.style.bottom = innerHeight - r.top + 6 + "px";
  document.body.append(pop);
  setTimeout(() => document.addEventListener("mousedown", function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener("mousedown", off); } }), 0);
  const groups = [];
  const cur = S.guilds.find((g) => g.id === S.vc.guild_id);
  if (cur?.sounds?.length) groups.push([cur.name, cur.sounds.map((s) => ({ ...s, gid: cur.id }))]);
  for (const g of S.guilds) if (g !== cur && g.sounds?.length) groups.push([g.name, g.sounds.map((s) => ({ ...s, gid: g.id }))]);
  if (!defaultSounds) { pop.innerHTML = '<div class="muted" style="padding:10px">Yükleniyor…</div>'; defaultSounds = await invoke("default_sounds").catch(() => []); }
  groups.push(["Varsayılan", (defaultSounds || []).map((s) => ({ ...s, gid: null }))]);
  pop.innerHTML = "";
  const tip = h("div", "muted sb-tip", "Sol tık: kanalda çal · Sağ tık: sadece kendine önizle"); pop.append(tip);
  for (const [name, list] of groups) {
    if (!list.length) continue;
    pop.append(h("div", "sb-group", esc(name)));
    const grid = h("div", "sb-grid");
    for (const s of list) {
      const emo = s.emoji_id ? `<img src="${CDN}/emojis/${s.emoji_id}.webp?size=32">` : esc(s.emoji_name || "🔉");
      const it = h("button", "sb-item", `<span>${emo}</span><small>${esc(s.name)}</small>`);
      it.onclick = async () => {
        try { await invoke("send_sound", { channelId: S.vc.channel_id, soundId: String(s.sound_id), sourceGuildId: s.gid }); }
        catch (e) { toast("Çalınamadı: " + e + (s.gid && s.gid !== S.vc.guild_id ? " (başka sunucu sesleri Nitro ister)" : "")); }
      };
      it.oncontextmenu = (e) => { e.preventDefault(); playSound(s.sound_id, s.volume ?? 1); };
      grid.append(it);
    }
    pop.append(grid);
  }
}
function playSound(id, vol) {
  const a = new Audio(soundUrl(id));
  a.volume = Math.max(0, Math.min(1, (vol ?? 1) * cfg.sbVolume * (cfg.volume ?? 1)));
  if (cfg.outputDevice && a.setSinkId) a.setSinkId(cfg.outputDevice).catch(() => {});
  a.play().catch(() => {});
}
listen("voice-effect", (e) => {
  const d = e.payload;
  if (!cfg.soundboard || cfg.deafened || d.channel_id !== S.vc.channel_id || S.vc.state !== "connected") return;
  if (d.sound_id) playSound(d.sound_id, d.sound_volume);
  else if (d.emoji?.name || d.emoji?.id) {
    const v = S.vstates.get(d.user_id);
    toast(`${v ? v.nick || dname(v.user) : "Biri"}: ${d.emoji.name || "emoji"}`);
  }
});

/* ------------------------------------------------------------------ */
/* Etkinlikler                                                         */
/* ------------------------------------------------------------------ */
async function openEvents(g) {
  const list = await invoke("guild_events", { guildId: g.id }).catch(() => []);
  const root = h("div", "res-list");
  if (!list.length) root.innerHTML = '<div class="empty">Planlanmış etkinlik yok</div>';
  const ST = { 1: "Planlandı", 2: "🔴 Şu an sürüyor", 3: "Bitti", 4: "İptal" };
  for (const ev of list) {
    const start = Date.parse(ev.scheduled_start_time);
    const loc = ev.entity_metadata?.location || (ev.channel_id ? "🔊 " + (g.channels.find((c) => c.id === ev.channel_id)?.name || "ses kanalı") : "");
    const it = h("div", "res-item event");
    it.innerHTML = `${ev.image ? `<img class="ev-img" src="${CDN}/guild-events/${ev.id}/${ev.image}.webp?size=512">` : ""}
      <div class="lh"><b>${esc(ev.name)}</b><span class="chip">${ST[ev.status] || ""}</span></div>
      <div class="muted">📅 ${esc(new Date(start).toLocaleString("tr-TR", { dateStyle: "full", timeStyle: "short" }))} · ${relTime(start)}${loc ? " · " + esc(loc) : ""}${ev.user_count ? ` · ⭐ ${ev.user_count} ilgili` : ""}</div>
      ${ev.description ? `<div class="lc">${md(ev.description)}</div>` : ""}`;
    if (ev.channel_id) it.onclick = () => { const c = g.channels.find((x) => x.id === ev.channel_id); if (c && !c.hidden) { closeModal(); openChannel({ ...c, guild_id: g.id }); } };
    root.append(it);
  }
  openModal(`${g.name} — Etkinlikler`, root);
}
function discordGuildItems(g) {
  return g.events ? [{ label: `📅 Etkinlikler (${g.events})`, fn: () => openEvents(g) }] : [];
}

/* ------------------------------------------------------------------ */
/* Profil: not + ortak arkadaşlar                                      */
/* ------------------------------------------------------------------ */
async function discordProfile(pop, u, prof) {
  const body = pop.querySelector(".pc-body"); if (!body || u.id === S.me?.id) return;
  const mf = prof?.mutual_friends || [];
  if (mf.length) {
    const sec = h("div", "pc-sec", `<h5>Ortak arkadaşlar · ${mf.length}</h5><div class="pc-mutual">${mf.slice(0, 10).map((f) => `<img data-pop="${f.id}" title="${esc(dname(f))}" src="${avatarUrl(f, 32)}">`).join("")}</div>`);
    body.append(sec);
  }
  const sec = h("div", "pc-sec", "<h5>Not (sadece sen görürsün)</h5>");
  const ta = h("textarea", "inp pc-note"); ta.rows = 2; ta.maxLength = 256; ta.placeholder = "Not eklemek için tıkla";
  ta.value = await invoke("get_note", { userId: u.id }).catch(() => "");
  let last = ta.value;
  const save = () => { if (ta.value === last) return; last = ta.value; invoke("set_note", { userId: u.id, note: ta.value }).then(() => toast("Not kaydedildi")).catch((e) => toast("Not kaydedilemedi: " + e)); };
  ta.onblur = save; ta.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ta.blur(); } };
  sec.append(ta); body.append(sec);
}

/* ------------------------------------------------------------------ */
/* Otomatik boşta                                                      */
/* ------------------------------------------------------------------ */
let lastInput = Date.now(), idleNow = false;
const markActive = () => {
  lastInput = Date.now();
  if (idleNow) { idleNow = false; invoke("set_auto_idle", { idle: false }).catch(() => {}); }
};
for (const ev of ["mousemove", "keydown", "mousedown", "wheel"]) document.addEventListener(ev, markActive, { passive: true });
setInterval(() => {
  if (!cfg.autoIdle || idleNow || !S.me) return;
  if (S.vc.state === "connected") return; // seste konuşuyorsa boşta sayma
  if (Date.now() - lastInput > cfg.autoIdleMin * 60000) { idleNow = true; invoke("set_auto_idle", { idle: true }).catch(() => {}); }
}, 30000);

/* ------------------------------------------------------------------ */
/* Kısayollar                                                          */
/* ------------------------------------------------------------------ */
function sidebarChannelIds() {
  return [...document.querySelectorAll("#channel-list .ch[data-id]")].map((el) => el.dataset.id);
}
function goChannel(delta, unreadOnly) {
  const ids = sidebarChannelIds(); if (!ids.length) return;
  let i = ids.indexOf(S.channel?.id);
  for (let n = 0; n < ids.length; n++) {
    i = (i + delta + ids.length) % ids.length;
    const id = ids[i];
    if (unreadOnly && !S.unread.has(id)) continue;
    const c = channelObj(id); if (!c || c.type === 2 || c.type === 13 || c.hidden) continue;
    return openChannel(c);
  }
}
document.addEventListener("keydown", (e) => {
  if ($("#app").classList.contains("hidden")) return;
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) { e.preventDefault(); goChannel(e.key === "ArrowUp" ? -1 : 1, e.shiftKey); }
  else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === "i") { e.preventDefault(); openInbox(); }
  else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "m") { e.preventDefault(); cfg.muted = !cfg.muted; applyVoiceFlags(); toast(cfg.muted ? "🎙 Mikrofon kapalı" : "🎙 Mikrofon açık"); }
  else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); cfg.deafened = !cfg.deafened; applyVoiceFlags(); toast(cfg.deafened ? "🔇 Sağırlaştırıldı" : "🔈 Ses açık"); }
  else if (e.shiftKey && e.key === "Escape" && S.view !== "home") { const g = S.guilds.find((x) => x.id === S.view); if (g) { markGuildRead(g); toast("Sunucu okundu işaretlendi"); } }
});

/* ------------------------------------------------------------------ */
/* Ayarlar                                                             */
/* ------------------------------------------------------------------ */
function discordSettings(root, sec, toggle) {
  const s = sec("Discord ekstraları");
  toggle(s, "groupRedacted", "Adsız gizli kanalları grupla", "Discord'un adını sildiği art arda kanallar tek satırda \"🔒 N gizli kanal\" olarak görünür", renderSidebar);
  toggle(s, "hideRedacted", "Adsız gizli kanalları hiç gösterme", "İçinde biri olan gizli ses kanalları yine görünür", renderSidebar);
  toggle(s, "fastStart", "Hızlı açılış", "Sunucu listesi ve son mesajlar diskte saklanır; uygulama Discord'a bağlanmayı beklemeden açılır");
  toggle(s, "autoIdle", "Otomatik boşta", `${cfg.autoIdleMin} dakika işlem yapmazsan durumun "Boşta" görünür (seste değilken)`, () => { if (!cfg.autoIdle) markActive(); });
  toggle(s, "soundboard", "Ses tahtası", "Ses panelinde ses tahtası düğmesi; kanaldaki ses tahtası seslerini duy");
  const vr = h("div", "row", `<label>Ses tahtası seviyesi<small>Başkalarının çaldığı sesler</small></label>`);
  const vs = h("input"); vs.type = "range"; vs.min = 0; vs.max = 1; vs.step = 0.05; vs.value = cfg.sbVolume;
  vs.oninput = () => { cfg.sbVolume = +vs.value; saveCfg(); };
  vr.append(vs); s.append(vr);
  const dr = h("div", "row", `<label>Teşhis<small>Discord'dan gelen veriyi kontrol et — bir şey bozulursa sebebini hızlıca gösterir</small></label>`);
  const db = h("button", "btn", "Kontrol et"); db.onclick = openDiagnostics;
  dr.append(db); s.append(dr);
  const kr = h("div", "row col", `<label>Kısayollar<small>Ctrl+K hızlı geçiş · Ctrl+I bahsetmeler · Ctrl+F arama · Alt+↑/↓ kanal değiştir · Alt+Shift+↑/↓ okunmamış kanala git · Ctrl+Shift+M mikrofon · Ctrl+Shift+D sağırlaştır · Shift+Esc sunucuyu okundu işaretle · Ctrl+Shift+T görünüm stüdyosu</small></label>`);
  s.append(kr);
}
