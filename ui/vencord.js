"use strict";
/* Shion — Vencord tarzı eklentiler: kod renklendirme, mesaj bağlantısı önizlemesi, tepki verenler, ham mesaj,
   metin değiştirme, şablonlar, zaman damgası, önizleme, engellenenleri gizleme, kullanıcı adı gösterme,
   cihaz göstergesi, sesteki kanal, sunucu bilgisi, ilişki bildirimleri, sabit DM'ler, zaman aşımı,
   arama süresi, sesli okuma, ses yükseltme, küçük pencere, dosya adı gizleme, bağlantı temizleme,
   özel etkinlik, sık kullanılan emojiler, favori GIF'ler, emoji kopyalama, kanal listesinde "yazıyor". */

const VC_DEFAULTS = { codeHl: true, linkEmbeds: true, hideBlocked: true, showUsername: true, msgPreview: false, textReplace: [], tags: {},
  relNotify: true, pinnedDms: [], vcNarrator: false, anonFiles: false, clearUrls: true, customRpc: null, emojiUse: {}, favGifs: [], typingInList: true };
for (const [k, v] of Object.entries(VC_DEFAULTS)) if (cfg[k] === undefined) cfg[k] = v;

/* ================================================================== */
/* DALGA 1 — Mesajlar                                                 */
/* ================================================================== */

/* ---- Kod renklendirme ---- */
const HL_KW = {
  js: "async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield",
  py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self print",
  rs: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Some None Ok Err",
  c: "auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected namespace using new delete true false nullptr template typename virtual include define",
  lua: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while",
  java: "abstract boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static super switch this throw throws true false try void while var",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false",
  sql: "select from where insert into values update set delete create table drop alter join left right inner outer on and or not null as order by group having limit primary key",
  sh: "if then else fi for in do done while case esac function return export echo local",
};
const HL_ALIAS = { javascript: "js", ts: "js", typescript: "js", jsx: "js", tsx: "js", json: "js", python: "py", rust: "rs", cpp: "c", "c++": "c", cs: "c", csharp: "c", kotlin: "java", golang: "go", bash: "sh", shell: "sh", powershell: "sh", ps1: "sh" };
const hlSets = {};
function hlCode(code, lang) {
  const l = HL_ALIAS[(lang || "").toLowerCase()] || (lang || "").toLowerCase();
  if (!cfg.codeHl || !HL_KW[l]) return esc(code);
  const kw = (hlSets[l] ||= new Set(HL_KW[l].split(" ")));
  const cm = l === "py" || l === "sh" ? "#[^\\n]*" : l === "lua" || l === "sql" ? "--[^\\n]*" : "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/";
  const re = new RegExp(`(${cm})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b\\d[\\d_.xXa-fA-F]*\\b)|([A-Za-z_][\\w]*)`, "g");
  let out = "", last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index)); last = re.lastIndex;
    const [t] = m;
    if (m[1]) out += `<span class="hl-c">${esc(t)}</span>`;
    else if (m[2]) out += `<span class="hl-s">${esc(t)}</span>`;
    else if (m[3]) out += `<span class="hl-n">${esc(t)}</span>`;
    else if (kw.has(t)) out += `<span class="hl-k">${esc(t)}</span>`;
    else if (code[re.lastIndex] === "(") out += `<span class="hl-f">${esc(t)}</span>`;
    else out += esc(t);
  }
  return out + esc(code.slice(last));
}

/* ---- Göreli zaman ("3 saat önce", "2 gün sonra") ---- */
const RTF = new Intl.RelativeTimeFormat("tr", { numeric: "auto" });
function relTime(ms) {
  const s = (ms - Date.now()) / 1000, a = Math.abs(s);
  const [v, u] = a < 60 ? [s, "second"] : a < 3600 ? [s / 60, "minute"] : a < 86400 ? [s / 3600, "hour"] : a < 2592000 ? [s / 86400, "day"] : a < 31536000 ? [s / 2592000, "month"] : [s / 31536000, "year"];
  return RTF.format(Math.round(v), u);
}
/* ---- Zaman damgası biçimleri (<t:…:R> vb.) ---- */
function fmtStamp(sec, f) {
  const d = new Date(sec * 1000);
  const o = { t: { timeStyle: "short" }, T: { timeStyle: "medium" }, d: { dateStyle: "short" }, D: { dateStyle: "long" }, F: { dateStyle: "full", timeStyle: "short" } }[f];
  if (f === "R") return relTime(d.getTime());
  return o ? d.toLocaleString("tr-TR", o) : d.toLocaleString("tr-TR", { dateStyle: "long", timeStyle: "short" });
}

/* ---- Mesaj son işleme: kullanıcı adı, engellenen, bağlantı önizleme ---- */
const blockedIds = () => new Set((S.friends || []).filter((f) => f.type === 2).map((f) => f.id));
function vcPost(el, m) {
  if (cfg.showUsername && m.author) {
    const a = el.querySelector(".head .author");
    const shown = dname(m.author);
    if (a && m.author.username && shown !== m.author.username) a.after(h("span", "uname", "@" + esc(m.author.username)));
  }
  if (cfg.hideBlocked && m.author && blockedIds().has(m.author.id)) {
    el.classList.add("blocked-msg");
    const t = h("div", "blocked-note", "🚫 Engellediğin kişinin mesajı — göster");
    t.onclick = () => el.classList.remove("blocked-msg");
    el.prepend(t);
  }
  if (cfg.linkEmbeds && m.content && !m._deleted) {
    const links = [...m.content.matchAll(/https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)/g)].slice(0, 2);
    for (const [, , cid, mid] of links) {
      const box = h("div", "link-embed muted", "Mesaj yükleniyor…");
      el.querySelector(".body")?.append(box);
      linkedMessage(cid, mid).then((lm) => {
        if (!lm) { box.textContent = "🔗 Mesaja erişilemiyor"; return; }
        const w = whereOf(cid);
        box.classList.remove("muted");
        box.innerHTML = `<div class="le-head"><img src="${avatarUrl(lm.author, 32)}"><b>${esc(dname(lm.author))}</b><span class="muted">${esc(w.where === "?" ? "" : w.where)} · ${fmtTime(lm.timestamp)}</span></div>
          <div class="le-body">${md(lm.content, lm) || (lm.attachments?.length ? "📎 " + lm.attachments.map((x) => esc(x.filename)).join(", ") : lm.embeds?.length ? "<i>(gömülü içerik)</i>" : "")}</div>`;
        const img = lm.attachments?.find((x) => (x.content_type || "").startsWith("image/"));
        if (img) { const i = h("img"); i.src = img.proxy_url || img.url; i.loading = "lazy"; box.append(i); }
        box.onclick = () => jumpToMessage(cid, mid, w.guild_id);
      });
    }
  }
}
const linkCache = new Map();
function linkedMessage(cid, mid) {
  const k = cid + "/" + mid;
  if (!linkCache.has(k)) {
    const local = S.channel?.id === cid && S.msgs.find((x) => x.id === mid);
    linkCache.set(k, local ? Promise.resolve(local) : invoke("fetch_message", { channelId: cid, messageId: mid }).catch(() => null));
    if (linkCache.size > 200) linkCache.delete(linkCache.keys().next().value);
  }
  return linkCache.get(k);
}

/* ---- Tepki verenler ---- */
async function showReactors(e, m, r) {
  const pop = h("div", "menu reactors", `<div class="muted" style="padding:6px 10px">${emojiHtml(r.emoji, 32)} yükleniyor…</div>`);
  document.querySelector(".menu")?.remove();
  document.body.append(pop);
  pop.style.left = Math.min(e.clientX, innerWidth - 240) + "px"; pop.style.top = Math.min(e.clientY, innerHeight - 320) + "px";
  setTimeout(() => document.addEventListener("mousedown", function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener("mousedown", off); } }), 0);
  try {
    const list = await invoke("reaction_users", { channelId: m.channel_id, messageId: m.id, emoji: emojiKey(r.emoji) });
    pop.innerHTML = `<div class="rx-head">${emojiHtml(r.emoji, 32)} <b>${r.count}</b> kişi</div>` +
      list.map((u) => `<div class="rx-user" data-pop="${u.id}"><img src="${avatarUrl(u, 32)}"><span>${esc(dname(u))}</span></div>`).join("") +
      (r.count > list.length ? `<div class="muted" style="padding:4px 10px">+${r.count - list.length} kişi daha</div>` : "");
  } catch (err) { pop.innerHTML = `<div class="err" style="padding:8px">${esc(err)}</div>`; }
}

/* ---- Ham mesaj ---- */
function viewRaw(m) {
  const clean = { ...m }; for (const k of Object.keys(clean)) if (k.startsWith("_")) delete clean[k];
  const txt = JSON.stringify(clean, null, 2);
  const root = h("div", "raw-view");
  const c1 = h("button", "btn", "İçeriği kopyala"); c1.onclick = () => { navigator.clipboard.writeText(m.content || ""); toast("Kopyalandı"); };
  const c2 = h("button", "btn", "JSON kopyala"); c2.onclick = () => { navigator.clipboard.writeText(txt); toast("Kopyalandı"); };
  const bar = h("div", "row2"); bar.append(c1, c2);
  root.append(h("pre", "raw-content", esc(m.content || "(içerik yok)")), bar, h("pre", "raw-json", hlCode(txt, "json")));
  openModal("Ham mesaj", root);
}
function vencordActions(btn, m) {
  btn("{ }", "Ham mesajı gör", () => viewRaw(m));
}

/* ---- Giden metin dönüşümleri: şablonlar, metin değiştirme, zaman, bağlantı temizleme ---- */
const TRACK_PARAMS = /^(utm_\w+|fbclid|gclid|dclid|msclkid|igshid|igsh|si|mc_cid|mc_eid|_hsenc|_hsmi|ref_src|ref_url|yclid|twclid|ttclid|spm|vero_id|wickedid|oly_\w+|__s)$/i;
function cleanUrl(u) {
  try {
    const url = new URL(u);
    let changed = false;
    for (const k of [...url.searchParams.keys()]) if (TRACK_PARAMS.test(k)) { url.searchParams.delete(k); changed = true; }
    return changed ? url.toString().replace(/\?$/, "") : u;
  } catch { return u; }
}
function parseWhen(s) {
  const m = s.trim().match(/^(?:(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s+)?(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;
  const now = new Date();
  const d = new Date(m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear(), m[2] ? m[2] - 1 : now.getMonth(), m[1] ? +m[1] : now.getDate(), +m[4], +m[5]);
  if (!m[1] && d < now) d.setDate(d.getDate() + 1); // sadece saat verildiyse ve geçtiyse: yarın
  return Math.floor(d.getTime() / 1000);
}
function outgoingTransform(text) {
  if (!text) return text;
  // Şablonlar: ;;ad
  text = text.replace(/;;([\wçğıöşüÇĞİÖŞÜ-]+)/g, (all, n) => cfg.tags[n.toLowerCase()] ?? all);
  // Metin değiştirme kuralları
  for (const r of cfg.textReplace || []) {
    if (!r.find) continue;
    try { text = r.regex ? text.replace(new RegExp(r.find, "g"), r.replace ?? "") : text.split(r.find).join(r.replace ?? ""); } catch {}
  }
  // Zaman damgası: {saat 20:30} {tarih 25.12 18:00} {kalan 20:30}
  text = text.replace(/\{(saat|tarih|kalan)\s+([^}]+)\}/gi, (all, k, v) => {
    const t = parseWhen(v); if (!t) return all;
    return `<t:${t}:${{ saat: "t", tarih: "f", kalan: "R" }[k.toLowerCase()]}>`;
  });
  if (cfg.clearUrls) text = text.replace(/https?:\/\/[^\s<>]+/g, cleanUrl);
  return text;
}
function outgoingFiles(files) {
  if (!cfg.anonFiles) return files;
  return files.map((f) => {
    const ext = (f.name.match(/\.[a-z0-9]{1,8}$/i) || [""])[0];
    const rnd = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
    return { ...f, name: (f.name.startsWith("SPOILER_") ? "SPOILER_" : "") + rnd + ext };
  });
}

/* ---- Mesaj önizleme ---- */
{
  const pv = h("div", "md-preview hidden"); pv.id = "md-preview";
  $("#input").closest("#composer")?.before(pv);
  const upd = () => {
    const t = $("#input").value;
    const show = cfg.msgPreview && /[*_~`|#>\[]|<t:|^-# |\{(saat|tarih|kalan) /m.test(t);
    pv.classList.toggle("hidden", !show);
    if (show) pv.innerHTML = `<small class="muted">Önizleme</small>${md(outgoingTransform(t), { mentions: [] })}`;
  };
  $("#input").addEventListener("input", upd);
  $("#input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) setTimeout(upd, 0); });
}

/* ================================================================== */
/* DALGA 2 — Kişi ve sunucu                                           */
/* ================================================================== */
const PLATFORM = { desktop: "🖥 Masaüstü", mobile: "📱 Mobil", web: "🌐 Web", embedded: "🎮 Konsol" };
function vencordProfile(pop, u, prof) {
  const body = pop.querySelector(".pc-body"); if (!body) return;
  const rows = [];
  const pres = (S.friends || []).find((f) => f.id === u.id)?.presence;
  const cs = pres?.client_status;
  if (cs && Object.keys(cs).length) rows.push(`<div class="kv"><span>Cihaz</span><b>${Object.entries(cs).map(([k, v]) => `${PLATFORM[k] || k} <i class="st-dot" style="background:${STATUS[v]?.[1] || "#80848e"}"></i>`).join(" · ")}</b></div>`);
  const vs = S.vstates.get(u.id);
  if (vs?.channel_id) {
    const g = S.guilds.find((x) => x.id === vs.guild_id);
    const c = g?.channels.find((x) => x.id === vs.channel_id);
    const r = h("div", "kv vc-where", `<span>Seste</span><b>🔊 ${esc(c?.name || "arama")}${g ? " · " + esc(g.name) : ""}</b>`);
    if (c && !c.hidden) { r.style.cursor = "pointer"; r.title = "Kanala katıl"; r.onclick = () => joinVoice(g.id, c.id); }
    body.prepend(r);
  }
  const to = prof?.guild_member?.communication_disabled_until;
  if (to && Date.parse(to) > Date.now()) rows.push(`<div class="kv"><span>Zaman aşımı</span><b>⏳ ${esc(fmtFull(Date.parse(to)))} (${relTime(Date.parse(to))})</b></div>`);
  if (rows.length) body.prepend(h("div", "pc-sec", rows.join("")));
}

/* ---- Sunucu bilgisi ---- */
const FEATURE_TR = { COMMUNITY: "Topluluk", PARTNERED: "Partner", VERIFIED: "Doğrulanmış", DISCOVERABLE: "Keşfette", VANITY_URL: "Özel bağlantı", ANIMATED_ICON: "Hareketli simge", BANNER: "Afiş", INVITE_SPLASH: "Davet arka planı", NEWS: "Duyuru kanalları", WELCOME_SCREEN_ENABLED: "Karşılama ekranı", MEMBER_VERIFICATION_GATE_ENABLED: "Üyelik doğrulaması", ROLE_ICONS: "Rol simgeleri", GUILD_ONBOARDING: "Katılım rehberi", SOUNDBOARD: "Ses tahtası", AUTO_MODERATION: "Otomatik moderasyon" };
function openServerInfo(g) {
  const m = g.meta || {};
  const created = snowTime(g.id);
  const owner = userById?.(String(g.owner_id || ""));
  const rows = [
    ["Oluşturulma", `${fmtFull(created)} · ${ago(created)}`],
    m.joined_at && ["Katıldığın tarih", `${fmtFull(Date.parse(m.joined_at))} · ${ago(Date.parse(m.joined_at))}`],
    m.member_count != null && ["Üye sayısı", Number(m.member_count).toLocaleString("tr-TR") + (m.max_members ? ` / ${Number(m.max_members).toLocaleString("tr-TR")}` : "")],
    ["Kanal", `${g.channels.filter((c) => c.type !== 4).length} (${g.channels.filter((c) => c.hidden).length} gizli)`],
    ["Rol", Object.keys(g.roles || {}).length],
    ["Emoji / çıkartma", `${(g.emojis || []).length} / ${(g.stickers || []).length}`],
    m.boosts != null && ["Takviye", `💎 ${m.boosts} takviye · Seviye ${m.premium_tier ?? 0}`],
    m.vanity && ["Özel davet", "discord.gg/" + m.vanity],
    ["Doğrulama seviyesi", ["Yok", "Düşük", "Orta", "Yüksek", "En yüksek"][m.verification_level] ?? "?"],
    m.locale && ["Dil", m.locale],
    ["Sunucu ID", g.id],
  ].filter(Boolean);
  const root = h("div", "srv-info");
  if (m.banner) { const b = h("img", "srv-banner"); b.src = `${CDN}/banners/${g.id}/${m.banner}.webp?size=600`; root.append(b); }
  root.append(h("div", "srv-head", `${guildIcon(g, 64) ? `<img src="${guildIcon(g, 64)}">` : ""}<div><h3>${esc(g.name)}</h3>${m.description ? `<div class="muted">${esc(m.description)}</div>` : ""}</div>`));
  root.append(h("div", "diag-grid", rows.map(([k, v]) => `<span>${esc(k)}</span><b>${esc(String(v))}</b>`).join("")));
  const feats = (m.features || []).map((f) => FEATURE_TR[f]).filter(Boolean);
  if (feats.length) root.append(h("div", "chips", feats.map((f) => `<span class="chip">${esc(f)}</span>`).join("")));
  if (owner?.id || g.owner) root.append(h("p", "muted", g.owner ? "👑 Sunucunun sahibi sensin" : `👑 Sahip: <span data-pop="${esc(owner.id)}" style="cursor:pointer;text-decoration:underline">${esc(dname(owner))}</span>`));
  const cp = h("button", "btn", "ID kopyala"); cp.onclick = () => { navigator.clipboard.writeText(g.id); toast("Kopyalandı"); };
  root.append(cp);
  openModal("Sunucu bilgisi", root);
}
function vencordGuildItems(g) {
  return [{ label: "ℹ Sunucu bilgisi", fn: () => openServerInfo(g) }];
}

/* ---- İlişki bildirimleri ---- */
let leavingGuild = null;
listen("rel-removed", (e) => {
  if (!cfg.relNotify) return;
  const r = e.payload, n = r.user ? dname(r.user) : r.id;
  const what = { 1: "seni arkadaşlıktan çıkardı (ya da sen çıkardın)", 3: "arkadaşlık isteğini geri çekti", 4: "arkadaşlık isteğini reddetti" }[r.type];
  if (!what) return;
  toast(`👋 ${n} ${what}`); notify("Shion", `${n} ${what}`);
  VC_LOG_REL.unshift({ t: Date.now(), text: `${n} ${what}` }); lsSet("shion.relLog", VC_LOG_REL.slice(0, 100));
});
listen("guild-removed", (e) => {
  if (!cfg.relNotify) return;
  const { id, name } = e.payload;
  if (leavingGuild === id) { leavingGuild = null; return; }
  const text = `🚪 "${name}" sunucusundan çıkarıldın ya da sunucu silindi`;
  toast(text); notify("Shion", text);
  VC_LOG_REL.unshift({ t: Date.now(), text }); lsSet("shion.relLog", VC_LOG_REL.slice(0, 100));
});
const VC_LOG_REL = lsGet("shion.relLog", []);
function openRelLog() {
  const root = h("div", "res-list");
  root.innerHTML = VC_LOG_REL.length ? VC_LOG_REL.map((x) => `<div class="vcl-row"><span class="muted">${esc(fmtFull(x.t))}</span> ${esc(x.text)}</div>`).join("") : '<div class="empty">Kayıt yok</div>';
  openModal("İlişki kaydı", root);
}

/* ---- Sabit DM'ler ---- */
const isPinnedDm = (id) => cfg.pinnedDms.includes(id);
function sortDms(list) {
  if (!cfg.pinnedDms.length) return list;
  return [...list.filter((d) => isPinnedDm(d.id)).sort((a, b) => cfg.pinnedDms.indexOf(a.id) - cfg.pinnedDms.indexOf(b.id)), ...list.filter((d) => !isPinnedDm(d.id))];
}
function vencordChannelItems(c, gid) {
  if (gid) return [];
  const p = isPinnedDm(c.id);
  return [{ label: p ? "📌 Sabitlemeyi kaldır" : "📌 Üste sabitle", fn: () => { cfg.pinnedDms = p ? cfg.pinnedDms.filter((x) => x !== c.id) : [...cfg.pinnedDms, c.id]; saveCfg(); renderSidebar(); } }];
}

/* ================================================================== */
/* DALGA 3 — Ses ve medya                                             */
/* ================================================================== */
let vcSince = 0;
function vcPanelExtras(p) {
  if (S.vc.state !== "connected") { vcSince = 0; return; }
  if (!vcSince) vcSince = Date.now();
  const t = h("span", "vc-timer"); p.querySelector(".info small")?.after(t);
  const tick = () => {
    if (!t.isConnected) return clearInterval(iv);
    const s = Math.floor((Date.now() - vcSince) / 1000);
    t.textContent = "⏱ " + (s >= 3600 ? Math.floor(s / 3600) + ":" : "") + String(Math.floor(s / 60) % 60).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  const iv = setInterval(tick, 1000); tick();
}
listen("voice-status", (e) => { if (e.payload?.state === "disconnected") vcSince = 0; });

/* Sesli okuma */
function speak(text) {
  if (!cfg.vcNarrator || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = "tr-TR"; u.rate = 1.1; u.volume = Math.min(1, cfg.volume ?? 1);
  const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith("tr")); if (v) u.voice = v;
  speechSynthesis.speak(u);
}
listen("voice-state", (e) => {
  const v = e.payload, my = S.vc.channel_id;
  if (!my || S.vc.state !== "connected" || v.user_id === S.me?.id) return;
  const from = v.prev_channel_id || null, to = v.channel_id || null;
  if (from === to) return;
  const n = v.nick || dname(v.user);
  if (to === my) speak(`${n} katıldı`); else if (from === my) speak(`${n} ayrıldı`);
});

/* Küçük pencere (resim içinde resim) */
async function pipCanvas(canvas) {
  try {
    const v = h("video"); v.muted = true; v.srcObject = canvas.captureStream(30);
    await v.play(); await v.requestPictureInPicture();
    v.addEventListener("leavepictureinpicture", () => { v.srcObject?.getTracks().forEach((t) => t.stop()); }, { once: true });
  } catch (e) { toast("Küçük pencere açılamadı: " + e); }
}
document.addEventListener("contextmenu", (e) => {
  const c = e.target.closest(".vtile canvas, .vtile video");
  if (!c) return;
  e.preventDefault();
  showMenu(e, [{ label: "🗗 Küçük pencerede aç", fn: () => (c.tagName === "VIDEO" ? c.requestPictureInPicture().catch((x) => toast(String(x))) : pipCanvas(c)) }]);
});

/* ================================================================== */
/* DALGA 4 — Kişiselleştirme                                          */
/* ================================================================== */
/* Özel etkinlik */
function pushRpc() { invoke("set_custom_rpc", { activity: cfg.customRpc?.on ? cfg.customRpc : null }).catch((e) => toast("Etkinlik: " + e)); }
listen("gw-ready", () => { if (cfg.customRpc?.on) setTimeout(pushRpc, 1500); });
function rpcSection(sec) {
  const s = sec("Özel etkinlik (oynuyor / dinliyor)");
  const r = cfg.customRpc || { on: false, type: 0, name: "", details: "", state: "" };
  const row = h("div", "row col", `<label>Profilinde görünecek etkinlik<small>Örn. "Oynuyor: Satranç" ya da "Dinliyor: Lo-fi". Oyun algılamayla birlikte de çalışır.</small></label>`);
  const box = h("div", "rpc-form");
  box.innerHTML = `<select class="inp"><option value="0">Oynuyor</option><option value="2">Dinliyor</option><option value="3">İzliyor</option><option value="5">Yarışıyor</option></select>
    <input class="inp" maxlength="128" placeholder="Ad (zorunlu)"><input class="inp" maxlength="128" placeholder="Ayrıntı (isteğe bağlı)"><input class="inp" maxlength="128" placeholder="Durum (isteğe bağlı)">`;
  const [ty, nm, de, stt] = box.querySelectorAll("select, input");
  ty.value = r.type; nm.value = r.name || ""; de.value = r.details || ""; stt.value = r.state || "";
  const on = h("button", "btn ok", "Göster"), off = h("button", "btn", "Kaldır");
  on.onclick = () => { if (!nm.value.trim()) return toast("Bir ad yaz"); cfg.customRpc = { on: true, type: +ty.value, name: nm.value, details: de.value, state: stt.value }; saveCfg(); pushRpc(); toast("Etkinlik ayarlandı"); };
  off.onclick = () => { cfg.customRpc = { ...(cfg.customRpc || r), on: false }; saveCfg(); pushRpc(); toast("Etkinlik kaldırıldı"); };
  box.append(on, off); row.append(box); s.append(row);
}

/* Sık kullanılan emojiler */
const emojiKeyOf = (e) => e.id ? e.id : e.name;
function noteEmoji(e) {
  const k = emojiKeyOf(e); if (!k) return;
  const cur = cfg.emojiUse[k] || { n: 0, e: { id: e.id || null, name: e.name, animated: !!e.animated } };
  cur.n++; cfg.emojiUse[k] = cur;
  const keys = Object.keys(cfg.emojiUse); if (keys.length > 80) { keys.sort((a, b) => cfg.emojiUse[a].n - cfg.emojiUse[b].n).slice(0, keys.length - 80).forEach((x) => delete cfg.emojiUse[x]); }
  saveCfg();
}
function frequentEmojiRow(grid, onPick) {
  const top = Object.values(cfg.emojiUse).sort((a, b) => b.n - a.n).slice(0, 16).map((x) => x.e).filter((e) => !e.id || emojiOwner(e.id) || hasNitro() || cfg.fakeNitro);
  if (!top.length) return;
  grid.append(h("h5", null, "⭐ Sık kullanılanlar"));
  for (const e of top) {
    const b = h("button", null, e.id ? emojiHtml(e) : e.name); b.title = ":" + e.name + ":";
    b.onclick = () => { onPick(e); closeEmojiPop(); }; grid.append(b);
  }
}

/* Favori GIF'ler */
const favGifList = () => cfg.favGifs.map((g) => ({ ...g, fav: true }));
function toggleFavGif(g) {
  const i = cfg.favGifs.findIndex((x) => x.url === g.url);
  if (i >= 0) { cfg.favGifs.splice(i, 1); toast("Favorilerden çıkarıldı"); }
  else { cfg.favGifs.unshift({ url: g.url, src: g.src }); cfg.favGifs = cfg.favGifs.slice(0, 60); toast("⭐ Favorilere eklendi"); }
  saveCfg();
}

/* Emoji kopyalama */
const canManageExpr = (g) => { try { const p = BigInt(g.perms || "0"); return g.owner || (p & 8n) !== 0n || (p & (1n << 30n)) !== 0n; } catch { return false; } };
function emojiCloneItems(img) {
  const m = (img.src || "").match(/\/emojis\/(\d+)\.(\w+)/);
  if (!m) return [];
  const targets = S.guilds.filter(canManageExpr);
  if (!targets.length) return [];
  const name = (img.alt || img.title || "emoji").replace(/:/g, "").replace(/[^\w]/g, "_").slice(0, 32) || "emoji";
  return [{ label: "📋 Emojiyi sunucuma kopyala", fn: () => openEmojiClone(m[1], m[2] === "gif", name, targets) }];
}
function openEmojiClone(id, animated, name, targets) {
  const root = h("div", "fwd");
  const prev = h("div", "srv-head", `<img src="${CDN}/emojis/${id}.${animated ? "gif" : "png"}?size=96" style="width:64px;height:64px;border-radius:0">`);
  const nm = h("input", "inp"); nm.value = name; nm.maxLength = 32;
  const list = h("div", "fwd-list");
  for (const g of targets) {
    const b = h("button", "fwd-item", `${guildIcon(g, 32) ? `<img src="${guildIcon(g, 32)}">` : '<span class="mini">#</span>'}<span>${esc(g.name)}</span>`);
    b.onclick = async () => {
      b.disabled = true;
      try { await invoke("clone_emoji", { guildId: g.id, name: nm.value, url: `${CDN}/emojis/${id}.${animated ? "gif" : "png"}?size=128` }); toast(`✅ :${nm.value}: ${g.name} sunucusuna eklendi`); closeModal(); }
      catch (e) { toast("Kopyalanamadı: " + e); b.disabled = false; }
    };
    list.append(b);
  }
  root.append(prev, h("small", "muted", "Emoji adı"), nm, h("small", "muted", "Hedef sunucu (Emoji yönetme iznin olanlar)"), list);
  openModal("Emojiyi kopyala", root);
}

/* Kanal listesinde "yazıyor" */
const typingTimers = new Map();
listen("typing-any", (e) => {
  if (!cfg.typingInList) return;
  const { channel_id } = e.payload;
  const set = () => document.querySelectorAll(`#channel-list .ch[data-id="${channel_id}"]`).forEach((r) => r.classList.add("typing"));
  set();
  clearTimeout(typingTimers.get(channel_id));
  typingTimers.set(channel_id, setTimeout(() => { typingTimers.delete(channel_id); document.querySelectorAll(`#channel-list .ch[data-id="${channel_id}"]`).forEach((r) => r.classList.remove("typing")); }, 10000));
});
const isTypingIn = (id) => typingTimers.has(id);

/* ================================================================== */
/* Ayarlar                                                            */
/* ================================================================== */
function vencordSettings(root, sec, toggle) {
  const s = sec("Mesaj eklentileri");
  toggle(s, "codeHl", "Kod renklendirme", "```js gibi dil belirtilen kod bloklarını renklendirir", () => renderMessages());
  toggle(s, "linkEmbeds", "Mesaj bağlantısı önizlemesi", "discord.com/channels/… bağlantılarının içeriğini mesajın altında gösterir", () => renderMessages());
  toggle(s, "showUsername", "Kullanıcı adını da göster", "Takma adın yanında @kullanıcıadı görünür", () => renderMessages());
  toggle(s, "hideBlocked", "Engellenenlerin mesajlarını gizle", "Tıklayınca açılır", () => renderMessages());
  toggle(s, "msgPreview", "Yazarken önizleme", "Biçimlendirme içeren mesajın nasıl görüneceğini gösterir");
  toggle(s, "clearUrls", "Bağlantıları temizle", "Gönderdiğin bağlantılardan utm_, fbclid, si gibi izleme parametrelerini siler");
  toggle(s, "anonFiles", "Dosya adlarını gizle", "Yüklediğin dosyaların adı rastgele yapılır (ekran_goruntusu_ahmet.png → x7k2p9.png)");
  toggle(s, "typingInList", "Kanal listesinde \"yazıyor\"", "Birinin yazdığı kanalın yanında ⌨ görünür");

  const tr = h("div", "row col", `<label>Metin değiştirme<small>Gönderirken otomatik değiştirilir. Her satır: <code>bul => yerine</code> (düzenli ifade için <code>/desen/ => yerine</code>)</small></label>`);
  const ta = h("textarea", "inp"); ta.rows = 3; ta.placeholder = "slm => selam\n/\\bnbr\\b/ => naber";
  ta.value = (cfg.textReplace || []).map((r) => (r.regex ? `/${r.find}/` : r.find) + " => " + (r.replace ?? "")).join("\n");
  ta.onchange = () => {
    cfg.textReplace = ta.value.split("\n").map((l) => l.split(" => ")).filter((p) => p.length >= 2 && p[0]).map(([f, ...r]) => {
      const re = /^\/(.+)\/$/.exec(f); return { find: re ? re[1] : f, replace: r.join(" => "), regex: !!re };
    });
    saveCfg(); toast(`${cfg.textReplace.length} kural kaydedildi`);
  };
  tr.append(ta); s.append(tr);

  const tg = h("div", "row col", `<label>Mesaj şablonları<small>Mesajda <code>;;ad</code> yazınca şablonla değişir. Her satır: <code>ad = metin</code> (satır içi yeni satır için \\n)</small></label>`);
  const tt = h("textarea", "inp"); tt.rows = 3; tt.placeholder = "kurallar = Lütfen #kurallar kanalını oku 🙏\nip = play.sunucum.com";
  tt.value = Object.entries(cfg.tags).map(([k, v]) => `${k} = ${v.replace(/\n/g, "\\n")}`).join("\n");
  tt.onchange = () => {
    cfg.tags = {};
    for (const l of tt.value.split("\n")) { const i = l.indexOf("="); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(); if (k) cfg.tags[k] = l.slice(i + 1).trim().replace(/\\n/g, "\n"); } }
    saveCfg(); toast(`${Object.keys(cfg.tags).length} şablon kaydedildi`);
  };
  tg.append(tt); s.append(tg);
  s.append(h("div", "row col", `<label>Zaman damgası<small>Mesaja <code>{saat 20:30}</code>, <code>{tarih 25.12 18:00}</code> ya da <code>{kalan 21:00}</code> yaz — herkes kendi saat diliminde görür</small></label>`));

  const s2 = sec("Kişi ve ses eklentileri");
  toggle(s2, "relNotify", "İlişki bildirimleri", "Biri seni arkadaşlıktan çıkarınca ya da sunucudan atılınca haber ver");
  const rl = h("div", "row", `<label>İlişki kaydı<small>${VC_LOG_REL.length} olay</small></label>`); const rb = h("button", "btn", "Göster"); rb.onclick = openRelLog; rl.append(rb); s2.append(rl);
  toggle(s2, "vcNarrator", "Ses kanalını sesli oku", "Bulunduğun kanala giren/çıkanı Türkçe sesle söyler");
  rpcSection(sec);
}
