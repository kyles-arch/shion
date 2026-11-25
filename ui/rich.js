"use strict";
/* Shion — zengin görsel katman (0.4.0)
   Performans seviyeleri (Sade / Dengeli / Şölen), sohbet animasyonları, Shion yazı efektleri, ekran efekti komutları,
   holografik profil kartı, Spotify/oyun kartları, sahne görünümü, video duvar kağıdı, sunucuya özel tema, mevsim modu,
   imleç izi, açılış ekranı, tema kodu/galerisi/yedeği, simge paketleri, Shion Wrapped ve başarımlar. visual.js'ten sonra yüklenir. */

const RICH_DEFAULTS = {
  perf: "solen", perfAuto: true, perfMeter: false,
  msgAnim: "kayma", reactBurst: true, userColors: {}, codeTheme: "onedark", embedGlow: true,
  holoCard: true, cardTheme: "", statusAnim: true, voicePulse: false,
  wallVideo: false, seasonal: true, cursorTrail: "", parallax: true, timeTint: false, splash: true, guildThemes: {},
  chanDeco: {}, iconPack: "", toastStyle: "", toastPos: "alt", scrollStyle: "", cursorStyle: "", cbFilter: "", autoContrast: true,
  achievements: true,
};
for (const [k, v] of Object.entries(RICH_DEFAULTS)) if (cfg[k] === undefined) cfg[k] = structuredClone(v);

const PERF_LEVELS = [["sade", "🍃", "Sade", "Her şey durağan ve hafif"], ["dengeli", "⚖", "Dengeli", "Hafif animasyonlar açık, ağır efektler kapalı"], ["solen", "✨", "Şölen", "Bütün görsel zenginlik açık"]];
const PERF_RANK = { sade: 0, dengeli: 1, solen: 2 };
const isSolen = () => effPerf() === "solen" && !cfg.noAnim;

/* Görünüm değişikliklerini dairesel bir renk dalgasıyla geçir (View Transitions API). */
let morphAt = null;
document.addEventListener("pointerdown", (e) => { morphAt = [e.clientX, e.clientY]; }, { capture: true, passive: true });
function morph(fn) {
  if (!document.startViewTransition || lowMotion() || document.hidden) return fn();
  const [x, y] = morphAt || [innerWidth / 2, innerHeight / 2];
  document.documentElement.style.setProperty("--vt-x", x + "px"); document.documentElement.style.setProperty("--vt-y", y + "px");
  try { document.startViewTransition(fn); } catch { fn(); }
}

/* ================================================================== */
/* ⚡ Performans: seviyeler, otomatik geçiş, uyarlanabilir kalite      */
/* ================================================================== */
let perfReason = "", batteryLow = false, fpsLow = false;
const reduceMQ = matchMedia("(prefers-reduced-motion: reduce)");
function setPerf(lvl) {
  cfg.perf = lvl; fpsLow = false; saveCfg();
  recomputePerf(true);
  const [, ico, name, desc] = PERF_LEVELS.find((x) => x[0] === lvl);
  toast(`${ico} ${name} — ${desc}${window.__perfOverride ? ` (şu an ${perfReason} yüzünden ${PERF_LEVELS.find((x) => x[0] === window.__perfOverride)[2]})` : ""}`);
}
function cyclePerf() { const i = PERF_LEVELS.findIndex((x) => x[0] === (cfg.perf || "solen")); setPerf(PERF_LEVELS[(i + 1) % 3][0]); }
function recomputePerf(force) {
  let o = null, why = "";
  if (cfg.perfAuto) {
    if (S.game) { o = "sade"; why = "oyun (" + S.game + ")"; }
    else if (fpsLow) { o = "dengeli"; why = "düşük FPS"; }
    else if (batteryLow) { o = "dengeli"; why = "düşük pil"; }
    else if (reduceMQ.matches) { o = "dengeli"; why = "Windows hareketi azalt"; }
  }
  if (o && PERF_RANK[o] >= PERF_RANK[cfg.perf || "solen"]) o = null;
  const changed = (window.__perfOverride || null) !== o;
  window.__perfOverride = o; perfReason = o ? why : "";
  if (changed || force) { morph(() => applyCfg()); renderMe(); }
}
listen("game", () => setTimeout(() => recomputePerf(), 0));
reduceMQ.addEventListener?.("change", () => recomputePerf());
navigator.getBattery?.().then((b) => {
  const chk = () => { const low = !b.charging && b.level <= 0.2; if (low !== batteryLow) { batteryLow = low; recomputePerf(); } };
  b.addEventListener("levelchange", chk); b.addEventListener("chargingchange", chk); chk();
}).catch(() => {});

/* FPS örnekleyici: yalnızca Şölen'de ağır bir şey çalışırken ya da ölçer açıkken döner. */
const perfStat = { fps: 60, frames: 0, t0: 0, lowRuns: 0, raf: 0 };
function heavyRunning() { return !!(fxState || $("#wall-video") || cfg.cursorTrail || $(".pfx")); }
function fpsLoop(t) {
  perfStat.raf = 0;
  if (document.hidden) { perfStat.t0 = 0; return scheduleFps(); }
  if (!perfStat.t0) { perfStat.t0 = t; perfStat.frames = 0; }
  perfStat.frames++;
  if (t - perfStat.t0 >= 2000) {
    perfStat.fps = Math.round((perfStat.frames * 1000) / (t - perfStat.t0)); perfStat.t0 = t; perfStat.frames = 0;
    if (isSolen() && heavyRunning() && cfg.perfAuto && perfStat.fps < 28) { if (++perfStat.lowRuns >= 3 && !fpsLow) { fpsLow = true; recomputePerf(); toast("⚖ Akıcılık için efektler kısıldı (FPS " + perfStat.fps + ")"); } }
    else perfStat.lowRuns = 0;
    updateMeter();
  }
  scheduleFps();
}
function scheduleFps() { if (!perfStat.raf && (cfg.perfMeter || (isSolen() && heavyRunning()))) perfStat.raf = requestAnimationFrame(fpsLoop); }
setInterval(scheduleFps, 3000);
function updateMeter() {
  let m = $("#perf-meter");
  if (!cfg.perfMeter) { m?.remove(); return; }
  if (!m) { m = h("div"); m.id = "perf-meter"; m.title = "Performans ölçer — kapatmak için tıkla"; m.onclick = () => { cfg.perfMeter = false; saveCfg(); updateMeter(); }; document.body.append(m); }
  const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + " MB" : "—";
  const lvl = PERF_LEVELS.find((x) => x[0] === effPerf());
  m.innerHTML = `<b>${perfStat.fps}</b> FPS · ${mem} · ${document.getElementsByTagName("*").length} öğe · ${lvl[1]} ${lvl[2]}${perfReason ? ` <small>(${esc(perfReason)})</small>` : ""}`;
}
/* Arka planda bellek temizliği */
setInterval(() => {
  if (!document.hidden) return;
  profileCache.clear();
  if (typeof animHost !== "undefined" && animHost) { playAnims(animHost, false); animHost = null; }
}, 5 * 60000);

/* Alt panelde ⚡ düğmesi */
{
  const base = renderMe;
  renderMe = function () {
    base();
    const who = $(".me-av")?.parentElement?.querySelector(".who"); if (!who || who.parentElement.querySelector(".perf-btn")) return;
    const lvl = PERF_LEVELS.find((x) => x[0] === effPerf());
    const b = h("button", "perf-btn perf-" + lvl[0], lvl[1]);
    b.title = `Performans: ${lvl[2]}${perfReason ? " (otomatik: " + perfReason + ")" : ""} — tıkla: değiştir (Ctrl+Shift+P)`;
    b.onclick = (e) => { e.stopPropagation(); cyclePerf(); };
    who.after(b);
  };
}
/* Çoklu sınıf/öznitelikleri her uygulamada güncelle */
{
  const base = applyVisual;
  applyVisual = function () {
    base();
    const r = document.documentElement, solen = isSolen();
    r.dataset.msgAnim = lowMotion() ? "" : cfg.msgAnim || "";
    r.dataset.codeTheme = cfg.codeTheme || "";
    r.dataset.cardTheme = cfg.cardTheme || "";
    r.dataset.iconPack = cfg.iconPack || "";
    r.dataset.toastStyle = cfg.toastStyle || ""; r.dataset.toastPos = cfg.toastPos || "alt";
    r.dataset.scroll = cfg.scrollStyle || "";
    r.classList.toggle("status-anim", solen && cfg.statusAnim);
    r.classList.toggle("embed-glow", !lowMotion() && cfg.embedGlow);
    r.classList.toggle("holo-on", solen && cfg.holoCard);
    applyVideoWall(); applyTimeTint(); applyCursorStyle(); applyCbFilter(); renderUserColors(); trailSetup();
    if (cfg.autoContrast) fixContrast();
    scheduleFps(); updateMeter();
  };
}

/* ================================================================== */
/* 💬 Sohbet                                                           */
/* ================================================================== */
MSG_STYLES.push(["telefon", "📱 Telefon"]);
const MSG_ANIMS = [["", "Yok"], ["kayma", "Kayma"], ["ziplama", "Zıplama"], ["solma", "Solma"], ["buyume", "Büyüme"]];
const CODE_THEMES = [["onedark", "One Dark"], ["dracula", "Dracula"], ["github", "GitHub Koyu"], ["monokai", "Monokai"], ["nord", "Nord"]];

/* Görünmez etiket kodları: "SX?" yazı efekti, "SE?" ekran efekti (biyografideki "S1" süsleme koduyla aynı yöntem) */
const tagStr = (s) => [...s].map((c) => String.fromCodePoint(0xe0000 + c.charCodeAt(0))).join("");
const readTags = (text) => ((text || "").match(/[\u{E0020}-\u{E007E}]+/gu) || []).map((x) => [...x].map((c) => String.fromCharCode(c.codePointAt(0) - 0xe0000)).join(""));
const TEXT_FX = [["", "Yok"], ["r", "🌈 Gökkuşağı"], ["w", "〰 Dalga"], ["s", "💥 Titreşim"], ["g", "✨ Parıltı"], ["t", "⌨ Daktilo"]];
const SCREEN_FX = { kar: ["k", "❄️", "kar"], konfeti: ["c", "🎉", "konfeti"], kalp: ["h", "❤️", "kalp"], havaifisek: ["f", "🎆", "fisek"], yildiz: ["y", "🌠", "yildiz"] };
const SCREEN_BY_CODE = Object.fromEntries(Object.values(SCREEN_FX).map(([c, , b]) => [c, b]));
let nextTfx = "";
{
  const base = runSlash;
  runSlash = async function (text) { return /^\/(kar|konfeti|kalp|havaifisek|yildiz)\b/i.test(text) ? false : base(text); };
}
{
  const base = outgoingTransform;
  outgoingTransform = function (text) {
    let t = base(text);
    const m = t.match(/^\/(kar|konfeti|kalp|havaifisek|yildiz)\b\s*([\s\S]*)$/i);
    if (m) {
      const [code, emoji, b] = SCREEN_FX[m[1].toLowerCase()];
      t = (m[2].trim() || emoji) + tagStr("SE" + code);
      burstFx(b); bumpStat("effects");
    } else if (nextTfx && t.trim() && !/^```/.test(t)) t += tagStr("SX" + nextTfx);
    return t;
  };
}
function splitChars(root, max = 400) {
  let i = 0;
  const walk = (n) => {
    for (const ch of [...n.childNodes]) {
      if (i > max) return;
      if (ch.nodeType === 3) {
        const frag = document.createDocumentFragment();
        for (const c of ch.textContent) {
          if (/[\u{E0000}-\u{E007F}]/u.test(c)) continue;
          const s = document.createElement("span"); s.className = "tc"; s.style.setProperty("--i", i++); s.textContent = c; frag.append(s);
        }
        ch.replaceWith(frag);
      } else if (ch.nodeType === 1 && !["CODE", "PRE", "IMG", "A"].includes(ch.tagName) && !ch.classList.contains("edited")) walk(ch);
    }
  };
  walk(root);
}
function applyTextFx(c, k) {
  if (!c || !k || !TEXT_FX.some(([x]) => x === k)) return;
  c.classList.add("tfx", "tfx-" + k);
  if ("wst".includes(k) && (c.textContent || "").length <= 400) splitChars(c);
}
{
  const base = vcPost;
  vcPost = function (el, m) {
    base(el, m);
    if (m.author?.id) el.dataset.uid = m.author.id;
    for (const tag of readTags(m.content)) if (tag.startsWith("SX")) applyTextFx(el.querySelector(".content"), tag[2]);
    for (const pre of el.querySelectorAll(".content pre")) {
      if (pre.querySelector(".copy-code")) continue;
      const b = h("button", "copy-code", "Kopyala"); b.onclick = (e) => { e.stopPropagation(); navigator.clipboard.writeText(pre.querySelector("code")?.textContent || ""); b.textContent = "✓ Kopyalandı"; setTimeout(() => (b.textContent = "Kopyala"), 1400); };
      pre.append(b);
    }
  };
}
listen("msg-create", (e) => {
  const m = e.payload;
  if (m.author?.id === S.me?.id) recordOwnMessage(m);
  if (m.channel_id !== S.channel?.id) { setTimeout(() => bumpBadge(m.channel_id), 80); return; }
  if (document.hidden || m.author?.id === S.me?.id) return;
  for (const tag of readTags(m.content)) if (tag.startsWith("SE") && SCREEN_BY_CODE[tag[2]]) burstFx(SCREEN_BY_CODE[tag[2]]);
});
function bumpBadge(cid) {
  if (lowMotion()) return;
  for (const el of document.querySelectorAll(`#channel-list .ch[data-id="${cid}"] .mbadge, #channel-list .ch[data-id="${cid}"], #home-btn .badge`)) {
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  }
}
/* Composer: ✨ yazı efekti düğmesi */
function tfxButton() {
  const gif = $("#gif-btn"); if (!gif || $("#tfx-btn")) return;
  const b = h("button", "cmp-btn", "✨"); b.id = "tfx-btn"; b.title = "Shion yazı efekti — Discord'da düz yazı, Shion'da animasyonlu";
  b.onclick = (e) => {
    e.stopPropagation();
    showMenu({ clientX: e.clientX, clientY: e.clientY - 10 }, [...TEXT_FX.map(([k, label]) => ({ label: (nextTfx === k ? "● " : "") + label, fn: () => { nextTfx = k; b.classList.toggle("on", !!k); b.title = k ? "Sonraki mesajların efekti: " + label : "Shion yazı efekti"; } })), "-",
      ...Object.entries(SCREEN_FX).map(([k, [, emo]]) => ({ label: `${emo} /${k} — ekran efekti`, fn: () => { const i = $("#input"); i.value = "/" + k + " "; i.focus(); } }))]);
  };
  gif.before(b);
}
/* Avatarlı "yazıyor…" göstergesi */
{
  const base = renderTyping;
  renderTyping = function () {
    base();
    const t = $("#typing"); if (!S.typers.size || !t.innerHTML) return;
    const avs = [...S.typers.keys()].slice(0, 3).map((id) => {
      const u = S.msgs.find((m) => m.author?.id === id)?.author || S.members.items.find((x) => x?.member?.user?.id === id)?.member.user || { id };
      return `<img src="${avatarUrl(u, 32)}" alt="">`;
    }).join("");
    t.innerHTML = `<span class="ty-avs">${avs}</span><span class="ty-dots"><i></i><i></i><i></i></span>` + t.innerHTML;
  };
}
/* Tepki patlaması */
document.addEventListener("click", (e) => {
  const b = e.target.closest?.(".reactions .react"); if (!b) return;
  if (!b.classList.contains("me")) bumpStat("reactions");
  if (lowMotion() || !cfg.reactBurst) return;
  const r = b.getBoundingClientRect(), src = b.querySelector("img")?.src, txt = src ? "" : b.firstChild?.textContent || "✨";
  for (let i = 0; i < 9; i++) {
    const p = h("span", "rx-burst"); if (src) p.innerHTML = `<img src="${src}" alt="">`; else p.textContent = txt;
    const a = (i / 9) * 6.28 + Math.random() * 0.5, d = 40 + Math.random() * 40;
    p.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 20}px;--rot:${(Math.random() - 0.5) * 120}deg`;
    document.body.append(p); setTimeout(() => p.remove(), 800);
  }
  b.classList.remove("bump"); void b.offsetWidth; b.classList.add("bump");
}, true);

/* Kişiye özel mesaj rengi */
function renderUserColors() {
  let css = "";
  for (const [id, col] of Object.entries(cfg.userColors || {})) {
    if (!/^\d+$/.test(id) || !/^#[0-9a-f]{6}$/i.test(col)) continue;
    css += `.msg[data-uid="${id}"]{box-shadow:inset 3px 0 0 ${col};background:color-mix(in srgb,${col} 7%,transparent)}.msg[data-uid="${id}"] .author{color:${col}}\n`;
  }
  let s = $("#user-colors"); if (!s) { s = h("style"); s.id = "user-colors"; document.head.append(s); }
  if (s.textContent !== css) s.textContent = css;
}

/* Gün ayırıcıları ve "Yeni mesajlar" çizgisi */
const dayKey = (iso) => new Date(iso).toDateString();
function dayLabel(iso) {
  const d = new Date(iso), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === now.toDateString()) return "Bugün";
  if (d.toDateString() === y.toDateString()) return "Dün";
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric", weekday: "long" });
}
let unreadMark = null;
{
  const base = renderMessages;
  renderMessages = function (keepPos) {
    base(keepPos);
    const box = $("#messages"), byId = new Map(S.msgs.map((m) => [m.id, m]));
    let last = null, newDone = false;
    for (const el of box.querySelectorAll(":scope > .msg[data-id]")) {
      const m = byId.get(el.dataset.id); if (!m) continue;
      const k = dayKey(m.timestamp);
      if (k !== last) { el.before(h("div", "day-pill", `<span>${esc(dayLabel(m.timestamp))}</span>`)); last = k; }
      if (!newDone && unreadMark && unreadMark.cid === S.channel?.id && m.author?.id !== S.me?.id && BigInt(m.id) > BigInt(unreadMark.last)) {
        el.before(h("div", "new-line", "<span>Yeni mesajlar</span>")); newDone = true;
      }
    }
  };
}
{
  const base = appendMsg;
  appendMsg = function (m) {
    const prev = S.msgs[S.msgs.length - 1];
    base(m);
    if (prev && dayKey(prev.timestamp) !== dayKey(m.timestamp)) $(`#messages .msg[data-id="${m.id}"]`)?.before(h("div", "day-pill", `<span>${esc(dayLabel(m.timestamp))}</span>`));
  };
}
/* Kaydırırken üstte tek bir yüzen gün etiketi */
let dayRaf = 0;
function updateDayFloat() {
  dayRaf = 0;
  const box = $("#messages"); if (!box) return;
  let f = $("#day-float");
  if (!f) { f = h("div", "off", "<span></span>"); f.id = "day-float"; box.parentElement.append(f); }
  f.style.top = box.offsetTop + 8 + "px";
  let cur = null;
  for (const p of box.querySelectorAll(":scope > .day-pill")) { if (p.offsetTop - box.scrollTop <= 4) cur = p; else break; }
  const show = cur && box.scrollTop > 0 && cur.offsetTop - box.scrollTop < -cur.offsetHeight;
  f.classList.toggle("off", !show);
  if (cur) f.firstChild.textContent = cur.textContent;
}
document.addEventListener("scroll", (e) => { if (e.target.id === "messages" && !dayRaf) dayRaf = requestAnimationFrame(updateDayFloat); }, true);
/* Kanal açılırken iskelet yükleyici + okunmamış işareti */
{
  const base = openChannel;
  openChannel = async function (c) {
    const rs = S.readStates?.[c?.id];
    unreadMark = rs?.last && /^\d+$/.test(rs.last) ? { cid: c.id, last: rs.last } : null;
    const p = base(c);
    const e = $("#messages .empty");
    if (e && e.textContent === "Yükleniyor…") e.replaceWith(skeleton());
    const r = await p;
    if (S.channel?.id === c?.id) setTimeout(() => { if (unreadMark?.cid === c.id) unreadMark = null; }, 4000);
    return r;
  };
}
function skeleton() {
  const box = h("div", "skeleton");
  for (let i = 0; i < 7; i++) box.append(h("div", "sk-msg", `<i class="sk-av"></i><div><i class="sk-line" style="width:${18 + (i * 37) % 20}%"></i><i class="sk-line" style="width:${40 + (i * 53) % 45}%"></i></div>`));
  return box;
}
/* Galeri: küçük resimden büyüyerek açılan, oklarla gezilen ışık kutusu */
let lastThumb = null;
document.addEventListener("pointerdown", (e) => { if (e.target.tagName === "IMG") lastThumb = e.target; }, { capture: true, passive: true });
function galleryUrls() {
  const out = [];
  for (const m of S.msgs) {
    for (const a of m.attachments || []) if ((a.content_type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(a.filename || "")) out.push(a.url);
    for (const e of m.embeds || []) if ((e.type === "image" || e.image) && !e.video) { const u = e.type === "image" ? e.url || e.thumbnail?.proxy_url : e.image?.url; if (u) out.push(u); }
  }
  return [...new Set(out)];
}
{
  const base = lightbox;
  lightbox = function (url) {
    base(url);
    const lb = document.querySelector(".lightbox:last-of-type"); const img = lb?.querySelector("img"); if (!img) return;
    const list = galleryUrls(); let i = list.indexOf(url);
    if (lastThumb && lastThumb.isConnected && !lowMotion()) {
      const r = lastThumb.getBoundingClientRect();
      img.addEventListener("load", () => {
        const t = img.getBoundingClientRect(); if (!t.width) return;
        img.animate([{ transform: `translate(${r.left + r.width / 2 - (t.left + t.width / 2)}px,${r.top + r.height / 2 - (t.top + t.height / 2)}px) scale(${r.width / t.width})`, opacity: 0.6 }, { transform: "none", opacity: 1 }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
      }, { once: true });
    }
    if (i < 0 || list.length < 2) return;
    const count = h("div", "lb-count"); const go = (d) => { i = (i + d + list.length) % list.length; img.src = list[i]; count.textContent = `${i + 1} / ${list.length}`; };
    const prev = h("button", "lb-nav prev", "‹"), next = h("button", "lb-nav next", "›");
    prev.onclick = (e) => { e.stopPropagation(); go(-1); }; next.onclick = (e) => { e.stopPropagation(); go(1); };
    count.textContent = `${i + 1} / ${list.length}`; lb.append(prev, next, count);
    const key = (e) => { if (!lb.isConnected) return document.removeEventListener("keydown", key); if (e.key === "ArrowLeft") go(-1); else if (e.key === "ArrowRight") go(1); else if (e.key === "Escape") lb.remove(); };
    document.addEventListener("keydown", key);
  };
}
/* Bağlantı kartları: içerik rengine göre parlama */
const PROVIDER_COLORS = { YouTube: "#ff0033", Spotify: "#1ed760", Twitch: "#9146ff", "Twitter": "#1d9bf0", X: "#e7e9ea", Reddit: "#ff4500", GitHub: "#8b949e", SoundCloud: "#ff5500" };
{
  const base = renderEmbed;
  renderEmbed = function (e) {
    const el = base(e);
    if (el?.classList?.contains("embed")) {
      const col = e.color ? intColor(e.color) : PROVIDER_COLORS[e.provider?.name];
      if (col) el.style.setProperty("--ec", col);
      if (e.provider?.name) el.dataset.provider = e.provider.name;
    }
    return el;
  };
}

/* ================================================================== */
/* 👤 Profil: holografik kart, Spotify/oyun kartı, rozet vitrini        */
/* ================================================================== */
const CARD_THEMES = [["", "Varsayılan"], ["cam", "🫧 Cam"], ["neon", "💡 Neon"], ["kagit", "📜 Kağıt"], ["sinema", "🎬 Sinema"]];
document.addEventListener("mousemove", (e) => {
  if (!document.documentElement.classList.contains("holo-on")) return;
  const pc = e.target.closest?.(".popout .pc"); if (!pc) return;
  const r = pc.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  pc.classList.add("holo");
  pc.style.setProperty("--ry", ((x - 0.5) * 14).toFixed(2) + "deg"); pc.style.setProperty("--rx", ((0.5 - y) * 12).toFixed(2) + "deg");
  pc.style.setProperty("--mx", (x * 100).toFixed(1) + "%"); pc.style.setProperty("--my", (y * 100).toFixed(1) + "%");
}, { passive: true });
document.addEventListener("mouseout", (e) => { const pc = e.target.closest?.(".popout .pc"); if (pc && !pc.contains(e.relatedTarget)) { pc.style.setProperty("--rx", "0deg"); pc.style.setProperty("--ry", "0deg"); } }, { passive: true });

function presenceById(uid) {
  return S.friends.find((f) => f.id === uid)?.presence || S.members.items.find((x) => x?.member?.user?.id === uid)?.member.presence || null;
}
const fmtDur = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60; return (hh ? hh + ":" + String(mm).padStart(2, "0") : mm) + ":" + String(ss).padStart(2, "0"); };
function activityImage(a, key = "large_image") {
  const i = a.assets?.[key]; if (!i) return "";
  if (i.startsWith("spotify:")) return "https://i.scdn.co/image/" + i.slice(8).replace(/[^\w]/g, "");
  if (i.startsWith("mp:")) return "https://media.discordapp.net/" + i.slice(3).replace(/[^\w/.%-]/g, "");
  if (a.application_id && /^\d+$/.test(i)) return `${CDN}/app-assets/${a.application_id}/${i}.png?size=160`;
  return "";
}
function activityCards(uid) {
  const acts = presenceById(uid)?.activities || [];
  const out = [];
  for (const a of acts) {
    if (a.type === 2 && (a.name === "Spotify" || a.assets?.large_image?.startsWith("spotify:"))) {
      const card = h("div", "act-card spotify", `<img class="act-img" alt="" src="${esc(activityImage(a))}"><div class="act-info"><small>🎵 Spotify'da dinliyor</small><b>${esc(a.details || "")}</b><span>${esc(a.state || "")}</span>
        <div class="act-bar"><i></i></div><div class="act-times"><span class="a0"></span><span class="a1"></span></div></div>`);
      const { start, end } = a.timestamps || {};
      const tick = () => {
        if (!card.isConnected) return clearInterval(iv);
        if (!start || !end) return;
        const now = Date.now(), p = Math.min(1, (now - start) / (end - start));
        card.querySelector(".act-bar i").style.width = (p * 100).toFixed(1) + "%";
        card.querySelector(".a0").textContent = fmtDur(now - start); card.querySelector(".a1").textContent = fmtDur(end - start);
      };
      const iv = setInterval(tick, 1000); setTimeout(tick, 0);
      const img = card.querySelector(".act-img"); img.crossOrigin = "anonymous";
      img.addEventListener("load", () => { try { const p = paletteFromImage(img); card.style.setProperty("--ac1", p.accent); card.style.setProperty("--ac2", p.accent2); } catch {} }, { once: true });
      out.push(card);
    } else if (a.type === 0) {
      const src = activityImage(a);
      const card = h("div", "act-card game", `${src ? `<img class="act-img" alt="" src="${esc(src)}">` : `<span class="act-img act-emo">🎮</span>`}<div class="act-info"><small>🎮 Oynuyor</small><b>${esc(a.name || "")}</b>${a.details ? `<span>${esc(a.details)}</span>` : ""}${a.state ? `<span>${esc(a.state)}</span>` : ""}<span class="act-el"></span></div>`);
      const st = a.timestamps?.start;
      const tick = () => { if (!card.isConnected) return clearInterval(iv); if (st) card.querySelector(".act-el").textContent = "⏱ " + fmtDur(Date.now() - st) + " geçti"; };
      const iv = setInterval(tick, 1000); setTimeout(tick, 0);
      out.push(card);
    }
  }
  return out;
}
{
  const base = visualProfile;
  visualProfile = function (pop, u, prof) {
    base(pop, u, prof);
    const pc = pop.querySelector(".pc"); if (!pc) return;
    const anchor = pc.querySelector(".pc-custom") || pc.querySelector(".pc-user");
    if (anchor && !pc.querySelector(".act-card")) anchor.after(...activityCards(u.id));
    const mu = pc.querySelector(".pc-mutual");
    if (mu && mu.children.length >= 6 && !mu.querySelector(".mq-track") && !lowMotion()) { const tr = h("div", "mq-track"); tr.append(...mu.children); tr.append(...[...tr.children].map((x) => x.cloneNode(true))); mu.append(tr); mu.classList.add("marquee"); }
    if (u.id === S.me?.id && cfg.achievements) {
      const got = achList().filter((a) => stats.ach[a.id]);
      if (got.length && !pc.querySelector(".ach-row")) pc.querySelector(".pc-user")?.after(h("div", "ach-row", got.slice(-10).map((a) => `<span title="${esc(a.name)} — ${esc(a.desc)}">${a.ico}</span>`).join("")));
    }
    if (u.id !== S.me?.id) {
      const body = pc.querySelector(".pc-body"), col = cfg.userColors[u.id];
      const b = h("button", "btn pc-dm", col ? "🎨 Mesaj rengini değiştir" : "🎨 Mesajlarına renk ver");
      b.onclick = () => {
        const i = h("input"); i.type = "color"; i.value = col || "#7c6cff";
        i.onchange = () => { cfg.userColors = { ...cfg.userColors, [u.id]: i.value }; saveCfg(); renderUserColors(); toast("🎨 " + dname(u) + " için renk ayarlandı"); };
        if (col) showMenu({ clientX: b.getBoundingClientRect().left, clientY: b.getBoundingClientRect().top }, [{ label: "Rengi değiştir", fn: () => i.click() }, { label: "Rengi kaldır", fn: () => { const c = { ...cfg.userColors }; delete c[u.id]; cfg.userColors = c; saveCfg(); renderUserColors(); } }]);
        else i.click();
      };
      body?.querySelector(".pc-dm:last-of-type")?.after(b);
    }
    if (!lowMotion()) sparkle(pop, getComputedStyle(pc).getPropertyValue("--pc-accent") || "var(--accent)");
  };
}
function sparkle(host, color) {
  const r = host.getBoundingClientRect();
  for (let i = 0; i < 14; i++) {
    const s = h("i", "pc-spark"); const a = Math.random() * 6.28, d = 60 + Math.random() * 90;
    s.style.cssText = `left:${r.width / 2}px;top:70px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;background:${color}`;
    host.append(s); setTimeout(() => s.remove(), 900);
  }
}

/* ================================================================== */
/* 🎙 Ses: sahne görünümü, giriş animasyonu, soundboard dalgası        */
/* ================================================================== */
const seenVoice = new Set(); let voiceFirst = true;
{
  const base = renderSidebar;
  renderSidebar = function () {
    base();
    const now = new Set();
    for (const r of document.querySelectorAll("#channel-list .vuser[data-uid]")) {
      const k = r.dataset.uid; now.add(k);
      if (!voiceFirst && !seenVoice.has(k) && !lowMotion()) r.classList.add("vjoin");
    }
    seenVoice.clear(); for (const k of now) seenVoice.add(k); voiceFirst = false;
    decorateChannels();
  };
}
{
  const base = vcPanelExtras;
  vcPanelExtras = function (p) {
    base(p);
    if (p.querySelector(".stage-btn")) return;
    const b = h("button", "stage-btn", "🎭"); b.title = "Sahne görünümü"; b.onclick = openStage;
    (p.querySelector(".info") || p).append(b);
  };
}
function openStage() {
  const root = h("div", "stage");
  const draw = () => {
    if (!root.isConnected && root.dataset.drawn) return false;
    root.dataset.drawn = "1";
    const users = [...S.vstates.values()].filter((v) => v.channel_id && v.channel_id === S.vc.channel_id);
    root.textContent = "";
    if (!users.length) { root.append(h("div", "muted", "Ses kanalında değilsin.")); return true; }
    for (const v of users) {
      const sp = S.vc.speaking.has(v.user_id), muted = v.mute || v.self_mute, deaf = v.deaf || v.self_deaf;
      const c = h("div", "stage-card" + (sp ? " speaking" : ""), `<div class="st-av"><img src="${avatarUrl(v.user, 128)}" alt=""></div><b>${esc(v.nick || dname(v.user))}</b><small>${v.self_stream ? "🔴 CANLI " : ""}${v.self_video ? "📹 " : ""}${muted ? "🔇 " : ""}${deaf ? "🎧✕" : ""}</small>`);
      c.dataset.uid = v.user_id; c.dataset.pop = v.user_id;
      addAvDeco(c.querySelector("img"), v.user, isSolen());
      root.append(c);
    }
    return true;
  };
  draw();
  openModal("🎭 Sahne", root);
  const offs = [];
  const sub = async (ev, fn) => offs.push(await listen(ev, fn));
  sub("voice-speaking", () => { if (!root.isConnected) return offs.forEach((f) => f()); for (const c of root.querySelectorAll(".stage-card")) c.classList.toggle("speaking", S.vc.speaking.has(c.dataset.uid)); });
  sub("voice-state", () => { if (!root.isConnected) return offs.forEach((f) => f()); setTimeout(draw, 30); });
}
document.addEventListener("click", (e) => {
  const it = e.target.closest?.(".sb-item"); if (!it || lowMotion()) return;
  it.classList.remove("playing"); void it.offsetWidth; it.classList.add("playing"); setTimeout(() => it.classList.remove("playing"), 1500);
}, true);
listen("voice-speaking", (e) => {
  if (!cfg.voicePulse || !isSolen()) return;
  const others = (e.payload || []).some((id) => id !== S.me?.id);
  document.documentElement.classList.toggle("vpulse", others);
});

/* ================================================================== */
/* 🌌 Atmosfer                                                         */
/* ================================================================== */
/* Video / hareketli GIF duvar kağıdı — IndexedDB'de saklanır */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open("shion-media", 1); r.onupgradeneeded = () => r.result.createObjectStore("files"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function idbPut(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction("files", "readwrite"); t.objectStore("files").put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
async function idbGet(k) { const db = await idb(); return new Promise((res) => { const t = db.transaction("files").objectStore("files").get(k); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); }
let wallVideoUrl = null, wallVideoType = "";
async function loadWallVideo() {
  if (!cfg.wallVideo) return;
  const f = await idbGet("wall-video").catch(() => null);
  if (!f) { cfg.wallVideo = false; saveCfg(); return; }
  wallVideoUrl = URL.createObjectURL(f); wallVideoType = f.type || ""; applyVideoWall();
}
function applyVideoWall() {
  let box = $("#wall-video");
  if (!cfg.wallVideo || !wallVideoUrl) { box?.remove(); return; }
  if (!box) {
    box = h("div"); box.id = "wall-video"; document.body.prepend(box);
    if (wallVideoType.startsWith("video/")) { const v = h("video"); v.src = wallVideoUrl; v.muted = v.loop = v.autoplay = v.playsInline = true; box.append(v); }
    else box.style.backgroundImage = `url("${wallVideoUrl}")`;
  }
  box.style.setProperty("--dim", cfg.wallDim);
  box.style.filter = cfg.wallBlur && isSolen() ? `blur(${cfg.wallBlur}px)` : "";
  const v = box.querySelector("video");
  if (v) { if (lowMotion() || document.hidden) v.pause(); else v.play().catch(() => {}); }
}
document.addEventListener("visibilitychange", applyVideoWall);
function pickVideoWall(after) {
  const inp = h("input"); inp.type = "file"; inp.accept = "video/mp4,video/webm,image/gif,image/webp";
  inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    if (f.size > 150 * 1024 * 1024) return toast("Dosya en fazla 150 MB olabilir");
    try { await idbPut("wall-video", f); } catch (e) { return toast("Kaydedilemedi: " + e); }
    if (wallVideoUrl) URL.revokeObjectURL(wallVideoUrl);
    $("#wall-video")?.remove();
    wallVideoUrl = URL.createObjectURL(f); wallVideoType = f.type; cfg.wallVideo = true; saveCfg(); applyCfg(); after?.();
    toast("🎬 Hareketli duvar kağıdı ayarlandı");
  };
  inp.click();
}
function removeVideoWall() { cfg.wallVideo = false; saveCfg(); $("#wall-video")?.remove(); if (wallVideoUrl) URL.revokeObjectURL(wallVideoUrl); wallVideoUrl = null; idbPut("wall-video", null).catch(() => {}); applyCfg(); }

/* Cadılar bayramı efekti (mevsim modu için) */
FX.cadilar = {
  count: 26,
  make: (st, init) => ({ x: rnd(0, st.w), y: init ? rnd(0, st.h) : st.h + 30, v: rnd(18, 45), s: rnd(16, 30), p: rnd(0, 6.28), e: Math.random() < 0.5 ? "🦇" : Math.random() < 0.5 ? "🎃" : "👻" }),
  draw(st, dt, t) {
    const { ctx, w, h: H } = st; ctx.clearRect(0, 0, w, H);
    for (const p of st.parts) {
      p.y -= p.v * dt; p.x += Math.sin(t * 1.3 + p.p) * 25 * dt;
      if (p.y < -40) Object.assign(p, FX.cadilar.make(st, false));
      ctx.globalAlpha = 0.75; ctx.font = `${p.s}px "Segoe UI Emoji"`; ctx.fillText(p.e, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  },
};
FX_LIST.push(["cadilar", "🎃 Cadılar"]);
function seasonFx(d = new Date()) {
  const m = d.getMonth() + 1, day = d.getDate(), md = m * 100 + day;
  if (md >= 1024 && md <= 1101) return "cadilar";
  if (m === 12 || m <= 2) return "kar";
  if (md >= 320 && md <= 531) return "sakura";
  return "";
}
/* Geçici tema katmanı: sunucuya özel tema + mevsim modu (ayarları değiştirmeden uygulanır) */
function themeOverride() {
  const ov = {};
  if (cfg.seasonal && !cfg.fx) { const s = seasonFx(); if (s) ov.fx = s; }
  const gt = S.view && S.view !== "home" ? cfg.guildThemes?.[S.view] : null;
  if (gt) { if (gt.theme) ov.theme = gt.theme; if (gt.customTheme) ov.customTheme = gt.customTheme; if (gt.accent !== undefined) ov.accent = gt.accent; if (gt.fx !== undefined && gt.fx !== null) ov.fx = gt.fx; }
  return Object.keys(ov).length ? ov : null;
}
{
  const base = applyCfg;
  applyCfg = function () {
    const ov = themeOverride(); if (!ov) return base();
    const saved = {}; for (const k in ov) { saved[k] = cfg[k]; cfg[k] = ov[k]; }
    try { base(); } finally { for (const k in saved) cfg[k] = saved[k]; }
  };
}
let lastView = null;
{
  const base = renderRail;
  renderRail = function () {
    base();
    if (S.view !== lastView) {
      const had = !!(lastView && cfg.guildThemes?.[lastView]), has = !!cfg.guildThemes?.[S.view];
      lastView = S.view;
      if (had || has) morph(() => applyCfg());
    }
  };
}
function openGuildTheme(g) {
  const cur = cfg.guildThemes?.[g.id] || {};
  const st = { theme: cur.theme || "", accent: cur.accent || "", fx: cur.fx ?? null, customTheme: cur.customTheme || { ...cfg.customTheme } };
  const root = h("div", "studio");
  const sel = h("select", "inp"); sel.innerHTML = `<option value="">(genel temam)</option>` + THEMES.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join(""); sel.value = st.theme;
  const acc = h("input"); acc.type = "color"; acc.value = st.accent || "#7c6cff";
  const accOn = h("label", "st-tg", `<input type="checkbox" ${st.accent ? "checked" : ""}> Vurgu rengi`); accOn.append(acc);
  const fxSel = h("select", "inp"); fxSel.innerHTML = `<option value="__">(genel efektim)</option>` + FX_LIST.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join(""); fxSel.value = st.fx === null ? "__" : st.fx;
  if (g.icon) { const ic = h("button", "btn", "🎨 Simgeden renk al"); ic.onclick = () => { const im = new Image(); im.crossOrigin = "anonymous"; im.onload = () => { try { const p = paletteFromImage(im); acc.value = p.accent; accOn.querySelector("input").checked = true; sel.value = "ozel"; st.customTheme = p; } catch { toast("Renk alınamadı"); } }; im.src = guildIcon(g, 64); }; root.append(ic); }
  root.append(h("div", "pe-lbl", "Tema"), sel, accOn, h("div", "pe-lbl", "Hareketli arka plan"), fxSel);
  const act = h("div", "pe-actions");
  const rm = h("button", "btn", "Kaldır"); rm.onclick = () => { const t = { ...cfg.guildThemes }; delete t[g.id]; cfg.guildThemes = t; saveCfg(); morph(() => applyCfg()); closeModal(); };
  const ok = h("button", "btn primary", "Kaydet");
  ok.onclick = () => {
    const v = { theme: sel.value || undefined, accent: accOn.querySelector("input").checked ? acc.value : undefined, fx: fxSel.value === "__" ? undefined : fxSel.value };
    if (v.theme === "ozel") v.customTheme = st.customTheme;
    cfg.guildThemes = { ...cfg.guildThemes, [g.id]: JSON.parse(JSON.stringify(v)) }; saveCfg(); morph(() => applyCfg()); closeModal(); toast("🎨 " + g.name + " için tema kaydedildi");
  };
  act.append(rm, ok); root.append(act);
  openModal("Sunucu teması — " + g.name, root);
}
{
  const base = vencordGuildItems;
  vencordGuildItems = function (g) { return [...base(g), { label: "🎨 Sunucu teması", fn: () => openGuildTheme(g) }]; };
}
/* Yılbaşı gecesi havai fişek */
listen("gw-ready", () => {
  const d = new Date(), k = "shion.ny" + d.getFullYear();
  if (cfg.seasonal && ((d.getMonth() === 11 && d.getDate() === 31) || (d.getMonth() === 0 && d.getDate() === 1)) && !lsGet(k, false)) { lsSet(k, true); setTimeout(() => { burstFx("fisek"); toast("🎆 Mutlu yıllar!"); }, 2500); }
});

/* İmleç izi */
const TRAILS = [["", "Yok"], ["yildiz", "⭐ Yıldız"], ["kivilcim", "✨ Kıvılcım"], ["kalp", "💗 Kalp"], ["neon", "〰 Neon çizgi"]];
const trail = { cv: null, ctx: null, parts: [], pts: [], raf: 0, last: 0 };
function trailSetup() {
  const on = cfg.cursorTrail && !lowMotion();
  if (!on) { trail.cv?.remove(); trail.cv = null; trail.parts = []; trail.pts = []; return; }
  if (!trail.cv) { trail.cv = h("canvas"); trail.cv.id = "trail-canvas"; document.body.append(trail.cv); trail.ctx = trail.cv.getContext("2d"); }
  trail.cv.width = innerWidth; trail.cv.height = innerHeight;
}
addEventListener("resize", () => trail.cv && trailSetup());
document.addEventListener("mousemove", (e) => {
  if (!trail.cv) return;
  const now = performance.now(); if (now - trail.last < 16) return; trail.last = now;
  const k = cfg.cursorTrail, acc = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c6cff";
  if (k === "neon") trail.pts.push({ x: e.clientX, y: e.clientY, l: 1 });
  else trail.parts.push({ x: e.clientX, y: e.clientY, vx: rnd(-30, 30), vy: k === "kalp" ? rnd(-60, -20) : rnd(-20, 40), l: 1, s: rnd(4, 9), c: k === "kivilcim" ? acc : k === "kalp" ? "#ff5c9a" : "#ffe680", a: rnd(0, 6.28) });
  if (!trail.raf) trail.raf = requestAnimationFrame(trailLoop);
}, { passive: true });
let trailT = 0;
function trailLoop(t) {
  trail.raf = 0; if (!trail.cv) return;
  const dt = Math.min(0.05, (t - (trailT || t)) / 1000); trailT = t;
  const { ctx, cv } = trail; ctx.clearRect(0, 0, cv.width, cv.height);
  if (trail.pts.length) {
    for (const p of trail.pts) p.l -= dt * 2.2; trail.pts = trail.pts.filter((p) => p.l > 0);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const acc = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c6cff";
    for (let i = 1; i < trail.pts.length; i++) { const a = trail.pts[i - 1], b = trail.pts[i]; ctx.strokeStyle = acc; ctx.globalAlpha = b.l; ctx.lineWidth = 4 * b.l; ctx.shadowColor = acc; ctx.shadowBlur = 12; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.shadowBlur = 0;
  }
  for (const p of trail.parts) {
    p.l -= dt * 1.6; p.x += p.vx * dt; p.y += p.vy * dt; p.a += dt * 3;
    ctx.globalAlpha = Math.max(0, p.l); ctx.fillStyle = p.c;
    if (cfg.cursorTrail === "kalp") { ctx.font = `${p.s * 2}px "Segoe UI Emoji"`; ctx.fillText("💗", p.x, p.y); }
    else if (cfg.cursorTrail === "yildiz") { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? p.s * 0.4 : p.s; ctx.lineTo(Math.cos((i * Math.PI) / 5) * r, Math.sin((i * Math.PI) / 5) * r); } ctx.fill(); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s * 0.35 * p.l + 0.5, 0, 6.28); ctx.fill(); }
  }
  trail.parts = trail.parts.filter((p) => p.l > 0); ctx.globalAlpha = 1;
  if (trail.parts.length || trail.pts.length) trail.raf = requestAnimationFrame(trailLoop); else ctx.clearRect(0, 0, cv.width, cv.height);
}

/* Paralaks: duvar kağıdı ve efektler fareyle hafifçe derinlik kazanır */
let parRaf = 0;
document.addEventListener("mousemove", (e) => {
  if (!cfg.parallax || !isSolen() || parRaf || !($("#wallpaper") || $("#wall-video") || fxState)) return;
  parRaf = requestAnimationFrame(() => {
    parRaf = 0; const r = document.documentElement.style;
    r.setProperty("--px", ((e.clientX / innerWidth) * 2 - 1).toFixed(3)); r.setProperty("--py", ((e.clientY / innerHeight) * 2 - 1).toFixed(3));
  });
}, { passive: true });

/* Günün saatine göre renk tonu */
function tintFor(hour) {
  if (hour >= 6 && hour < 10) return "rgba(255,170,90,.07)";
  if (hour >= 10 && hour < 17) return "";
  if (hour >= 17 && hour < 20) return "rgba(255,120,80,.08)";
  return "rgba(70,90,255,.09)";
}
function applyTimeTint() {
  let el = $("#time-tint"); const c = cfg.timeTint ? tintFor(new Date().getHours()) : "";
  if (!c) { el?.remove(); return; }
  if (!el) { el = h("div"); el.id = "time-tint"; document.body.append(el); }
  el.style.background = c;
}
setInterval(applyTimeTint, 10 * 60000);

/* Animasyonlu açılış ekranı */
function richSplash() {
  const s = $("#splash");
  if (!s || s.classList.contains("rich") || s.classList.contains("out") || !cfg.splash || lowMotion()) return;
  s.classList.add("rich");
  s.querySelector(".splash-logo")?.replaceWith(h("div", "sp-wrap", `<div class="sp-ring"></div><div class="sp-logo">${[..."Shion"].map((c) => `<span>${c}</span>`).join("")}</div>`));
}
{
  const base = showSplash;
  showSplash = function (on) { base(on); if (on) richSplash(); };
}
richSplash();

/* ================================================================== */
/* 🎁 Kişiselleştirme ve paylaşım                                      */
/* ================================================================== */
const THEME_KEYS = ["theme", "customTheme", "accent", "fx", "fxDensity", "glass", "glassAlpha", "glassBlur", "shape", "glow", "msgStyle", "font", "msgFx", "wallBlur", "wallDim",
  "soundPack", "soundVol", "msgAnim", "codeTheme", "cardTheme", "cursorTrail", "iconPack", "toastStyle", "toastPos", "scrollStyle", "cursorStyle", "parallax", "timeTint", "holoCard", "statusAnim"];
const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const unb64 = (s) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
function exportThemeCode() { return "SHION-TEMA:" + b64(JSON.stringify(Object.fromEntries(THEME_KEYS.filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]])))); }
function sanitizeTheme(obj) {
  const out = {};
  for (const k of THEME_KEYS) {
    if (!(k in obj)) continue;
    const v = obj[k], d = cfg[k];
    if (k === "customTheme") { if (v && typeof v === "object") out[k] = Object.fromEntries(["base", "accent", "accent2", "text"].filter((x) => /^#[0-9a-f]{6}$/i.test(v[x] || "")).map((x) => [x, v[x]])); continue; }
    if (k === "accent") { if (v === "" || /^#[0-9a-f]{6}$/i.test(v)) out[k] = v; continue; }
    if (typeof v === typeof d && (typeof v !== "string" || /^[\w\- çğıöşüÇĞİÖŞÜ]{0,40}$/.test(v)) && typeof v !== "object") out[k] = v;
  }
  if (out.theme && !THEMES.some(([id]) => id === out.theme)) delete out.theme;
  if (out.fx && !FX_LIST.some(([id]) => id === out.fx)) delete out.fx;
  return out;
}
function importThemeCode(code) {
  const m = String(code || "").trim().match(/^SHION-TEMA:([A-Za-z0-9+/=]+)$/);
  if (!m) throw new Error("Geçerli bir Shion tema kodu değil");
  const obj = sanitizeTheme(JSON.parse(unb64(m[1])));
  if (!Object.keys(obj).length) throw new Error("Kodda uygulanacak ayar yok");
  Object.assign(cfg, obj); saveCfg(); morph(() => applyCfg()); bumpStat("themes", JSON.stringify([cfg.theme, cfg.fx]));
  return Object.keys(obj).length;
}
function openThemeShare() {
  const root = h("div", "studio");
  const code = exportThemeCode();
  const ta = h("textarea", "inp theme-code"); ta.readOnly = true; ta.value = code; ta.rows = 3;
  const cp = h("button", "btn primary", "📋 Kodumu kopyala"); cp.onclick = () => { navigator.clipboard.writeText(code); toast("Tema kodu kopyalandı — arkadaşına gönder!"); };
  const inp = h("textarea", "inp theme-code"); inp.placeholder = "SHION-TEMA:… kodunu buraya yapıştır"; inp.rows = 3;
  const ap = h("button", "btn", "✨ Uygula"); ap.onclick = () => { try { const n = importThemeCode(inp.value); closeModal(); toast(`🎨 Tema uygulandı (${n} ayar)`); } catch (e) { toast(e.message); } };
  root.append(h("div", "pe-lbl", "Benim temam"), ta, cp, h("div", "pe-lbl", "Arkadaşının teması"), inp, ap);
  openModal("Tema paylaş", root);
}
/* Tema galerisi (12 görünüm) */
const GALLERY = [
  ...LOOKS.map(([n, v]) => [n, v]),
  ["Vaporwave", { theme: "ozel", customTheme: { base: "#1a0b2e", accent: "#ff71ce", accent2: "#01cdfe" }, fx: "css-akis", shape: "yuvarlak-kare", glow: true, glass: true, msgStyle: "baloncuk" }],
  ["Altın saat", { theme: "ozel", customTheme: { base: "#1c140a", accent: "#ffb347", accent2: "#ff6f61" }, fx: "atesbocegi", shape: "daire", glow: true, glass: true }],
  ["Buzul", { theme: "ozel", customTheme: { base: "#0b1a24", accent: "#7dd3fc", accent2: "#e0f2fe" }, fx: "kar", shape: "elmas", glow: false, glass: true, cardTheme: "cam" }],
  ["Derin okyanus", { theme: "okyanus", fx: "kabarcik", shape: "damla", glow: true, glass: true, msgStyle: "kart" }],
];
const PREVIEW_COLORS = { gece: ["#0f1117", "#7c6cff", "#4fd1c5"], okyanus: ["#061520", "#22b8cf", "#4dd4ac"], matrix: ["#000000", "#00ff66", "#00cc52"], kahve: ["#17110d", "#c8915f", "#9cbf7a"], nord: ["#2e3440", "#88c0d0", "#a3be8c"] };
function lookColors(v) { return v.theme === "ozel" ? [v.customTheme.base, v.customTheme.accent, v.customTheme.accent2] : PREVIEW_COLORS[v.theme] || ["#141824", "#7c6cff", "#4fd1c5"]; }
function openGallery() {
  const root = h("div", "gallery");
  for (const [name, v] of GALLERY) {
    const [bg, a1, a2] = lookColors(v), fxl = v.fx ? FX_LIST.find((x) => x[0] === v.fx)?.[1] || "" : "Efektsiz";
    const c = h("button", "g-card", `<div class="g-prev" style="--g0:${bg};--g1:${a1};--g2:${a2}"><i class="g-rail"></i><i class="g-side"></i><div class="g-chat"><i></i><i></i><i class="me"></i></div><span class="g-fx">${esc(fxl.split(" ")[0])}</span></div><b>${esc(name)}</b><small class="muted">${esc(fxl)}</small>`);
    c.onclick = () => { Object.assign(cfg, structuredClone(v)); if (v.theme !== "ozel") cfg.accent = ""; saveCfg(); morph(() => applyCfg()); bumpStat("themes", name); toast("🎨 " + name + " uygulandı"); };
    root.append(c);
  }
  openModal("Tema galerisi", root);
}
/* Görsel ayarların tam yedeği (duvar kağıdı ve süslemeler dahil) */
async function exportVisualBackup() {
  const data = { shion: "gorunum-yedegi", v: 1, cfg: Object.fromEntries([...THEME_KEYS, "deco", "decoShare", "guildThemes", "chanDeco", "userColors", "seasonal", "perf", "schedule", "collectibles"].map((k) => [k, cfg[k]])), wallpaper: wallpaperData() || "" };
  try { const p = await invoke("save_text", { name: `shion-gorunum-${new Date().toISOString().slice(0, 10)}.json`, content: JSON.stringify(data) }); toast("💾 Yedek kaydedildi: " + p); }
  catch (e) { toast("Kaydedilemedi: " + e); }
}
function importVisualBackup() {
  const inp = h("input"); inp.type = "file"; inp.accept = "application/json,.json";
  inp.onchange = async () => {
    try {
      const d = JSON.parse(await inp.files[0].text());
      if (d?.shion !== "gorunum-yedegi") throw new Error("Bu bir Shion görünüm yedeği değil");
      const c = d.cfg || {}, safe = sanitizeTheme(c);
      for (const k of ["guildThemes", "chanDeco", "userColors"]) if (c[k] && typeof c[k] === "object") safe[k] = c[k];
      if (c.deco && typeof c.deco === "object") safe.deco = { frame: String(c.deco.frame || ""), name: String(c.deco.name || ""), card: String(c.deco.card || ""), c1: /^#[0-9a-f]{6}$/i.test(c.deco.c1) ? c.deco.c1 : "#a78bfa", c2: /^#[0-9a-f]{6}$/i.test(c.deco.c2) ? c.deco.c2 : "#22d3ee" };
      for (const k of ["seasonal", "collectibles"]) if (typeof c[k] === "boolean") safe[k] = c[k];
      if (PERF_RANK[c.perf] !== undefined) safe.perf = c.perf;
      Object.assign(cfg, safe); saveCfg();
      if (typeof d.wallpaper === "string" && d.wallpaper.startsWith("data:image/")) setWallpaper(d.wallpaper);
      morph(() => applyCfg()); closeModal(); toast("✅ Görünüm yedeği geri yüklendi");
    } catch (e) { toast("Yüklenemedi: " + e.message); }
  };
  inp.click();
}
/* Kanal süsleme */
function decorateChannels() {
  const deco = cfg.chanDeco || {};
  for (const r of document.querySelectorAll("#channel-list .ch[data-id]")) {
    const d = deco[r.dataset.id]; if (!d) continue;
    const n = r.querySelector(".name"); if (!n || n.dataset.decorated) continue;
    n.dataset.decorated = "1";
    if (d.emoji) n.insertAdjacentHTML("afterbegin", `<span class="ch-emo">${esc(d.emoji)}</span> `);
    if (/^#[0-9a-f]{6}$/i.test(d.color || "")) { n.style.color = d.color; r.style.setProperty("--chc", d.color); r.classList.add("ch-colored"); }
  }
}
function openChanDeco(c) {
  const cur = cfg.chanDeco?.[c.id] || {};
  const root = h("div", "studio");
  const emo = h("input", "inp"); emo.maxLength = 4; emo.placeholder = "🔥"; emo.value = cur.emoji || ""; emo.style.width = "80px";
  const col = h("input"); col.type = "color"; col.value = cur.color || "#7c6cff";
  const colOn = h("label", "st-tg", `<input type="checkbox" ${cur.color ? "checked" : ""}> Renk`); colOn.append(col);
  const act = h("div", "pe-actions");
  const rm = h("button", "btn", "Kaldır"); rm.onclick = () => { const d = { ...cfg.chanDeco }; delete d[c.id]; cfg.chanDeco = d; saveCfg(); renderSidebar(); closeModal(); };
  const ok = h("button", "btn primary", "Kaydet"); ok.onclick = () => { cfg.chanDeco = { ...cfg.chanDeco, [c.id]: { emoji: emo.value.trim(), color: colOn.querySelector("input").checked ? col.value : "" } }; saveCfg(); renderSidebar(); closeModal(); };
  act.append(rm, ok);
  root.append(h("div", "pe-lbl", "Emoji"), emo, colOn, act);
  openModal("Kanalı süsle — " + (c.name || "kanal"), root);
}
{
  const base = vencordChannelItems;
  vencordChannelItems = function (c, gid) { return [...base(c, gid), { label: "🎨 Kanalı süsle", fn: () => openChanDeco(c) }]; };
}
/* Simge paketleri, bildirim balonları, kaydırma çubukları, imleçler */
const ICON_PACKS = [["", "Varsayılan"], ["cizgi", "✏ Çizgi"], ["neon", "💡 Neon"], ["gradyan", "🌈 Gradyan"], ["el", "🖍 El çizimi"]];
const TOAST_STYLES = [["", "Varsayılan"], ["cam", "🫧 Cam"], ["neon", "💡 Neon"], ["kart", "🗂 Kart"]];
const TOAST_POS = [["alt", "Alt"], ["ust", "Üst"], ["sag-alt", "Sağ alt"], ["sag-ust", "Sağ üst"]];
const SCROLL_STYLES = [["", "Varsayılan"], ["ince", "İnce"], ["neon", "Neon"], ["gizli", "Gizli"]];
const CURSOR_STYLES = [["", "Sistem"], ["nokta", "● Neon nokta"], ["ok", "➤ Vurgu oku"]];
{
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  defs.setAttribute("width", "0"); defs.setAttribute("height", "0"); defs.style.position = "absolute";
  defs.innerHTML = `<defs><linearGradient id="icon-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--accent-2)"/></linearGradient>
    <filter id="sketch"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/><feDisplacementMap in="SourceGraphic" scale="1.6"/></filter>
    <filter id="cb-deut"><feColorMatrix type="matrix" values="0.8 0.2 0 0 0  0.258 0.742 0 0 0  0 0.142 0.858 0 0  0 0 0 1 0"/></filter>
    <filter id="cb-prot"><feColorMatrix type="matrix" values="0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0"/></filter>
    <filter id="cb-trit"><feColorMatrix type="matrix" values="0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0"/></filter>
    <filter id="cb-mono"><feColorMatrix type="saturate" values="0"/></filter></defs>`;
  document.body.append(defs);
}
function applyCursorStyle() {
  let s = $("#cursor-css"); if (!s) { s = h("style"); s.id = "cursor-css"; document.head.append(s); }
  const acc = (getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#7c6cff").replace("#", "%23");
  let css = "";
  if (cfg.cursorStyle === "nokta") css = `body{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Ccircle cx='12' cy='12' r='4' fill='${acc}'/%3E%3Ccircle cx='12' cy='12' r='9' fill='none' stroke='${acc}' stroke-opacity='.5' stroke-width='2'/%3E%3C/svg%3E") 12 12,auto}`;
  if (cfg.cursorStyle === "ok") css = `body{cursor:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='22'%3E%3Cpath d='M2 2l7 18 3-7 7-3z' fill='${acc}' stroke='white' stroke-width='1.5' stroke-linejoin='round'/%3E%3C/svg%3E") 2 2,auto}`;
  if (s.textContent !== css) s.textContent = css;
}
const CB_FILTERS = [["", "Kapalı"], ["deut", "Döteranopi (yeşil)"], ["prot", "Protanopi (kırmızı)"], ["trit", "Tritanopi (mavi)"], ["mono", "Siyah-beyaz"]];
function applyCbFilter() {
  const f = CB_FILTERS.some(([k]) => k === cfg.cbFilter) && cfg.cbFilter ? `url(#cb-${cfg.cbFilter})` : "";
  for (const id of ["#app", "#modal"]) { const el = $(id); if (el) el.style.filter = f; }
}
/* Okunabilirlik koruması: yazı/arka plan kontrastı düşükse yazı rengini düzelt */
function parseColor(s) {
  let m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/); if (m) return [+m[1], +m[2], +m[3]];
  m = s.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255];
  return null;
}
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
function fixContrast() {
  const st = document.documentElement.style; st.removeProperty("--text-fix");
  const probe = h("div"); probe.style.cssText = "position:absolute;visibility:hidden;color:var(--text);background:var(--solid-bg, var(--bg-2))"; document.body.append(probe);
  const cs = getComputedStyle(probe), fg = parseColor(cs.color), bg = parseColor(cs.backgroundColor); probe.remove();
  if (!fg || !bg || contrast(fg, bg) >= 4.5) return;
  const white = [245, 245, 247], black = [17, 17, 17];
  st.setProperty("--text", contrast(white, bg) >= contrast(black, bg) ? "#f5f5f7" : "#111111");
}

/* ================================================================== */
/* 🏆 Shion Wrapped ve başarımlar                                     */
/* ================================================================== */
const stats = Object.assign({ since: Date.now(), msgs: 0, chars: 0, byChannel: {}, byPerson: {}, names: {}, hours: Array(168).fill(0), emojis: {}, voiceSec: 0, reactions: 0, effects: 0, themes: [], days: {}, night: 0, early: 0, ach: {}, wrapped: 0 }, lsGet("shion.stats", {}));
if (!Array.isArray(stats.hours) || stats.hours.length !== 168) stats.hours = Array(168).fill(0);
let statsTimer = 0;
const saveStats = () => { clearTimeout(statsTimer); statsTimer = setTimeout(() => lsSet("shion.stats", stats), 1500); };
function bumpStat(k, v) {
  if (k === "themes") { if (v && !stats.themes.includes(v)) { stats.themes.push(v); if (stats.themes.length > 50) stats.themes.shift(); } }
  else stats[k] = (stats[k] || 0) + 1;
  saveStats(); checkAch();
}
const EMOJI_RE = /<a?:(\w+):\d+>|\p{Extended_Pictographic}/gu;
function recordOwnMessage(m) {
  const d = new Date(m.timestamp || Date.now()), text = (m.content || "").replace(/[\u{E0000}-\u{E007F}]/gu, "");
  stats.msgs++; stats.chars += text.length;
  stats.byChannel[m.channel_id] = (stats.byChannel[m.channel_id] || 0) + 1;
  const dm = S.dms.find((x) => x.id === m.channel_id);
  if (dm?.type === 1 && dm.recipients?.[0]) { const u = dm.recipients[0]; stats.byPerson[u.id] = (stats.byPerson[u.id] || 0) + 1; stats.names[u.id] = { n: dname(u), a: u.avatar || null }; }
  else if (S.channel?.id === m.channel_id) stats.names[m.channel_id] = { n: (S.channel.guild_id ? "#" : "@") + (S.channel.name || ""), g: S.channel.guild_id || null };
  stats.hours[((d.getDay() + 6) % 7) * 24 + d.getHours()]++;
  const hr = d.getHours(); if (hr >= 2 && hr < 5) stats.night++; if (hr >= 5 && hr < 7) stats.early++;
  for (const e of text.matchAll(EMOJI_RE)) { const k = e[1] ? ":" + e[1] + ":" : e[0]; stats.emojis[k] = (stats.emojis[k] || 0) + 1; }
  const dk = d.toISOString().slice(0, 10); stats.days[dk] = (stats.days[dk] || 0) + 1;
  const keys = Object.keys(stats.days).sort(); if (keys.length > 400) delete stats.days[keys[0]];
  saveStats(); checkAch();
}
setInterval(() => { if (S.vc.state === "connected") { stats.voiceSec += 30; saveStats(); checkAch(); } }, 30000);
function streakDays() {
  let n = 0; const d = new Date();
  for (;;) { const k = d.toISOString().slice(0, 10); if (!stats.days[k]) { if (n === 0 && d.toDateString() === new Date().toDateString()) { d.setDate(d.getDate() - 1); continue; } break; } n++; d.setDate(d.getDate() - 1); }
  return n;
}
function achList() {
  const ch = Object.keys(stats.byChannel).length, em = Object.keys(stats.emojis).length;
  return [
    { id: "ilk", ico: "👋", name: "Merhaba Dünya", desc: "Shion'dan ilk mesajını gönder", ok: stats.msgs >= 1 },
    { id: "yuz", ico: "💬", name: "Sohbetçi", desc: "100 mesaj gönder", ok: stats.msgs >= 100 },
    { id: "bin", ico: "🗣", name: "Çenesi Düşük", desc: "1.000 mesaj gönder", ok: stats.msgs >= 1000 },
    { id: "onbin", ico: "📜", name: "Destan Yazarı", desc: "10.000 mesaj gönder", ok: stats.msgs >= 10000 },
    { id: "gece", ico: "🦉", name: "Gece Kuşu", desc: "Gece 02:00–05:00 arası 10 mesaj", ok: stats.night >= 10 },
    { id: "sabah", ico: "🌅", name: "Erkenci", desc: "Sabah 05:00–07:00 arası 5 mesaj", ok: stats.early >= 5 },
    { id: "ses1", ico: "🎙", name: "Mikrofon Kontrol", desc: "Seste 10 dakika geçir", ok: stats.voiceSec >= 600 },
    { id: "ses2", ico: "🎧", name: "Ses Maratoncusu", desc: "Seste 10 saat geçir", ok: stats.voiceSec >= 36000 },
    { id: "emoji", ico: "😂", name: "Emoji Ustası", desc: "30 farklı emoji kullan", ok: em >= 30 },
    { id: "tepki", ico: "❤️", name: "Tepki Canavarı", desc: "100 tepki ver", ok: stats.reactions >= 100 },
    { id: "tema", ico: "🎨", name: "Tema Ustası", desc: "5 farklı görünüm dene", ok: stats.themes.length >= 5 },
    { id: "susle", ico: "✨", name: "Süslü", desc: "Profil süslemesi kullan", ok: !!(cfg.deco?.frame || cfg.deco?.name || cfg.deco?.card) },
    { id: "seri", ico: "🔥", name: "Ateşli Seri", desc: "7 gün üst üste mesaj at", ok: streakDays() >= 7 },
    { id: "parti", ico: "🎉", name: "Parti Başlasın", desc: "Bir ekran efekti komutu kullan", ok: stats.effects >= 1 },
    { id: "kasif", ico: "🧭", name: "Kaşif", desc: "20 farklı kanalda mesaj at", ok: ch >= 20 },
    { id: "wrapped", ico: "📊", name: "Kendini Tanı", desc: "Shion Wrapped'ı aç", ok: stats.wrapped >= 1 },
  ];
}
function checkAch() {
  if (!cfg.achievements) return;
  for (const a of achList()) {
    if (!a.ok || stats.ach[a.id]) continue;
    stats.ach[a.id] = Date.now(); saveStats();
    toast(`🏆 Başarım açıldı: ${a.ico} ${a.name}`); burstFx("konfeti");
  }
}
function openAchievements() {
  const list = achList(), got = list.filter((a) => stats.ach[a.id]).length;
  const root = h("div", "ach-grid");
  for (const a of list) root.append(h("div", "ach" + (stats.ach[a.id] ? " got" : ""), `<span class="ach-ico">${a.ico}</span><b>${esc(a.name)}</b><small class="muted">${esc(a.desc)}</small>${stats.ach[a.id] ? `<small class="ach-date">${new Date(stats.ach[a.id]).toLocaleDateString("tr-TR")}</small>` : ""}`));
  openModal(`🏆 Başarımlar — ${got}/${list.length}`, root);
}
function countUp(el, to, ms = 900) {
  if (lowMotion()) { el.textContent = to.toLocaleString("tr-TR"); return; }
  const t0 = performance.now(); const step = (t) => { const p = Math.min(1, (t - t0) / ms), v = Math.round(to * (1 - (1 - p) ** 3)); el.textContent = v.toLocaleString("tr-TR"); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step);
}
function openWrapped() {
  stats.wrapped++; saveStats(); checkAch();
  const days = Math.max(1, Math.round((Date.now() - stats.since) / 86400000));
  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  const people = top(stats.byPerson, 5), chans = top(stats.byChannel, 5), emos = top(stats.emojis, 8);
  const maxH = Math.max(1, ...stats.hours), dn = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  const busiest = stats.hours.indexOf(Math.max(...stats.hours)), bh = busiest % 24, bd = dn[Math.floor(busiest / 24)];
  const slides = [
    `<div class="wr-big">📊</div><h2>Shion Wrapped</h2><p class="muted">${new Date(stats.since).toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" })}'dan bu yana · ${days} gün</p>`,
    `<p>Gönderdiğin mesaj</p><div class="wr-num" data-to="${stats.msgs}">0</div><p class="muted">${stats.chars.toLocaleString("tr-TR")} karakter · günde ortalama ${(stats.msgs / days).toFixed(1)} mesaj</p>`,
    `<p>En çok konuştuğun kişiler</p><div class="wr-list">${people.length ? people.map(([id, n], i) => { const u = stats.names[id] || {}; return `<div class="wr-row" style="--i:${i}"><img src="${avatarUrl({ id, avatar: u.a }, 64)}" alt=""><b>${esc(u.n || "Bilinmeyen")}</b><span>${n.toLocaleString("tr-TR")}</span></div>`; }).join("") : '<p class="muted">Henüz DM yok</p>'}</div>`,
    `<p>En aktif kanalların</p><div class="wr-list">${chans.map(([id, n], i) => `<div class="wr-row" style="--i:${i}"><span class="wr-hash">#</span><b>${esc(stats.names[id]?.n || "kanal")}</b><span>${n.toLocaleString("tr-TR")}</span></div>`).join("") || '<p class="muted">Henüz veri yok</p>'}</div>`,
    `<p>Ne zaman aktifsin?</p><div class="wr-heat">${stats.hours.map((v, i) => `<i title="${dn[Math.floor(i / 24)]} ${i % 24}:00 — ${v}" style="--v:${(v / maxH).toFixed(2)}"></i>`).join("")}</div><div class="wr-heat-x"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div><p class="muted">En yoğun anın: <b>${bd} ${String(bh).padStart(2, "0")}:00</b></p>`,
    `<p>En sevdiğin emojiler</p><div class="wr-emo">${emos.map(([e, n], i) => `<span style="--i:${i}" title="${n}">${e.startsWith(":") ? esc(e) : e}</span>`).join("") || '<p class="muted">Henüz emoji yok</p>'}</div>`,
    `<p>Seste geçen süre</p><div class="wr-num" data-to="${Math.round(stats.voiceSec / 60)}">0</div><p class="muted">dakika · 🔥 seri: ${streakDays()} gün · 🏆 ${Object.keys(stats.ach).length}/${achList().length} başarım</p><button class="btn primary wr-ach">Başarımları gör</button>`,
  ];
  const root = h("div", "wrapped"); let i = 0;
  const stage = h("div", "wr-slide"); const dots = h("div", "wr-dots");
  const nav = h("div", "wr-nav"); const prev = h("button", "btn", "‹ Geri"), next = h("button", "btn primary", "İleri ›");
  nav.append(prev, dots, next); root.append(stage, nav);
  const show = () => {
    stage.innerHTML = slides[i]; stage.classList.remove("in"); void stage.offsetWidth; stage.classList.add("in");
    for (const n of stage.querySelectorAll(".wr-num")) countUp(n, +n.dataset.to);
    stage.querySelector(".wr-ach")?.addEventListener("click", openAchievements);
    dots.innerHTML = slides.map((_, k) => `<i class="${k === i ? "on" : ""}"></i>`).join("");
    prev.disabled = i === 0; next.textContent = i === slides.length - 1 ? "Bitir ✓" : "İleri ›";
  };
  prev.onclick = () => { if (i > 0) { i--; show(); } };
  next.onclick = () => { if (i < slides.length - 1) { i++; show(); } else closeModal(); };
  openModal("Shion Wrapped", root); show();
  if (!lowMotion()) setTimeout(() => burstFx("konfeti"), 300);
}

/* ================================================================== */
/* 🎨 Stüdyo: yeni bölümler, sekmeler, arama, maliyet etiketleri       */
/* ================================================================== */
const FX_COST = { yildiz: "o", kar: "o", sakura: "o", atesbocegi: "o", ag: "a", kabarcik: "o", matrix: "a", cadilar: "o", "css-aurora": "a", "css-synth": "h", "css-akis": "h" };
const STUDIO_TABS = [["tema", "🎨 Tema"], ["arka", "🌌 Arka plan"], ["sohbet", "💬 Sohbet"], ["profil", "👤 Profil"], ["ses", "🔔 Ses"], ["paylas", "🎁 Paylaşım"], ["perf", "⚡ Performans"], ["oyun", "🏆 Oyun"]];
const SEC_TAB = { "Hazır görünümler": "tema", "Temel tema": "tema", "Cam görünüm": "tema", "Gece / gündüz teması": "tema", "Tema galerisi": "tema", "Okunabilirlik": "tema",
  "Hareketli arka plan": "arka", "Duvar kağıdı": "arka", "Hareketli duvar kağıdı": "arka", "Atmosfer": "arka", "İmleç izi": "arka",
  "Mesaj görünümü": "sohbet", "Mesaj animasyonları": "sohbet", "Kod blokları": "sohbet",
  "Avatar ve sunucu simgesi şekli": "profil", "Profil": "profil", "Discord koleksiyonları": "profil", "Profil kartı": "profil",
  "Ses teması": "ses", "Ses kanalı": "ses",
  "Tema kodu ve yedek": "paylas", "Simgeler ve arayüz": "paylas", "Erişilebilirlik": "paylas",
  "Performans": "perf", "Shion Wrapped ve başarımlar": "oyun" };
function richStudio(body, apply) {
  const sec = (title) => { const s = h("div", "st-sec", `<div class="pe-lbl">${title}</div>`); body.append(s); return s; };
  const opts = (s, list, key, after) => {
    const w = h("div", "deco-opts");
    for (const [k, label] of list) {
      const b = h("button", "fx-btn" + ((cfg[key] || "") === k ? " sel" : ""), label);
      b.onclick = () => { cfg[key] = k; saveCfg(); after ? after(k) : apply(); w.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); };
      w.append(b);
    }
    s.append(w); return w;
  };
  const tg = (s, key, label, after) => { const l = h("label", "st-tg", `<input type="checkbox" ${cfg[key] ? "checked" : ""}> ${label}`); l.querySelector("input").onchange = (e) => { cfg[key] = e.target.checked; saveCfg(); after ? after() : apply(); }; s.append(l); return l; };
  const btn = (s, label, fn, cls = "btn") => { const b = h("button", cls, label); b.onclick = fn; s.append(b); return b; };

  const p = sec("Performans");
  const pw = h("div", "perf-levels");
  for (const [k, ico, name, desc] of PERF_LEVELS) {
    const b = h("button", "perf-card" + ((cfg.perf || "solen") === k ? " sel" : ""), `<span class="pc-ico">${ico}</span><b>${name}</b><small class="muted">${desc}</small>`);
    b.onclick = () => { setPerf(k); pw.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); };
    pw.append(b);
  }
  p.append(pw);
  tg(p, "perfAuto", "Otomatik: oyunda Sade, düşük pil / düşük FPS / \"hareketi azalt\" açıkken Dengeli", () => recomputePerf(true));
  tg(p, "perfMeter", "Performans ölçeri göster (FPS · bellek · öğe sayısı)", () => { updateMeter(); scheduleFps(); });
  const meas = h("div", "perf-measure muted"); btn(p, "📏 Üç seviyeyi ölç ve karşılaştır", () => measurePerf(meas)); p.append(meas);
  p.append(h("small", "muted", "Kısayol: Ctrl+Shift+P · alt paneldeki ⚡ düğmesi. Ayarların hiçbir seviyede silinmez. 🟢 hafif · 🟡 orta · 🔴 ağır"));

  const a = sec("Atmosfer");
  tg(a, "seasonal", "Mevsim modu (kışın kar, baharda sakura, cadılar bayramı, yılbaşı havai fişeği — kendi efektin yoksa)");
  tg(a, "parallax", "Paralaks: arka plan fareyle derinlik kazanır (Şölen)");
  tg(a, "timeTint", "Günün saatine göre renk tonu (sabah sıcak, gece serin)");
  tg(a, "splash", "Animasyonlu açılış ekranı");
  const vw = sec("Hareketli duvar kağıdı");
  const vr = h("div", "pe-row"); vw.append(vr);
  btn(vr, "🎬 Video / GIF seç", () => pickVideoWall()); btn(vr, "Kaldır", removeVideoWall);
  vw.append(h("small", "muted", "mp4, webm, GIF (en fazla 150 MB). Pencere arka plandayken ve Sade modda durur."));
  const tr = sec("İmleç izi"); opts(tr, TRAILS, "cursorTrail");

  const ma = sec("Mesaj animasyonları"); opts(ma, MSG_ANIMS, "msgAnim");
  tg(ma, "reactBurst", "Tepki verince parçacık patlaması");
  tg(ma, "embedGlow", "Bağlantı kartlarında içerik rengine göre parlama");
  ma.append(h("small", "muted", "✨ düğmesi (mesaj kutusunda): Shion yazı efektleri · /kar /konfeti /kalp /havaifisek /yildiz: herkesin ekranında efekt"));
  const cb = sec("Kod blokları"); opts(cb, CODE_THEMES, "codeTheme");

  const pk = sec("Profil kartı"); opts(pk, CARD_THEMES, "cardTheme");
  tg(pk, "holoCard", "3D holografik kart (fareyle eğilir, Şölen)"); tg(pk, "statusAnim", "Nabız gibi atan durum halkaları (Şölen)");
  const sk = sec("Ses kanalı");
  tg(sk, "voicePulse", "Biri konuşunca arka plan nabız atar (deneysel, 🔴)");
  sk.append(h("small", "muted", "Ses panelindeki 🎭 düğmesi: sahne görünümü"));

  const sh = sec("Tema kodu ve yedek");
  const r1 = h("div", "pe-row"); sh.append(r1);
  btn(r1, "🔗 Tema kodu paylaş", openThemeShare, "btn primary"); btn(r1, "🖼 Tema galerisi", openGallery);
  const r2 = h("div", "pe-row"); sh.append(r2);
  btn(r2, "💾 Görünümü yedekle", exportVisualBackup); btn(r2, "📂 Yedekten yükle", importVisualBackup);
  const ui = sec("Simgeler ve arayüz");
  ui.append(h("small", "muted", "Simge paketi")); opts(ui, ICON_PACKS, "iconPack");
  ui.append(h("small", "muted", "Bildirim balonu")); opts(ui, TOAST_STYLES, "toastStyle", () => { apply(); toast("Böyle görünecek ✨"); });
  opts(ui, TOAST_POS, "toastPos", () => { apply(); toast("Burada görünecek 👋"); });
  ui.append(h("small", "muted", "Kaydırma çubuğu")); opts(ui, SCROLL_STYLES, "scrollStyle");
  ui.append(h("small", "muted", "İmleç")); opts(ui, CURSOR_STYLES, "cursorStyle");
  const ac = sec("Erişilebilirlik");
  tg(ac, "autoContrast", "Okunabilirlik koruması (soluk yazıyı otomatik düzelt)");
  ac.append(h("small", "muted", "Renk körlüğü filtresi")); opts(ac, CB_FILTERS, "cbFilter");

  const g = sec("Shion Wrapped ve başarımlar");
  const r3 = h("div", "pe-row"); g.append(r3);
  btn(r3, "📊 Shion Wrapped", openWrapped, "btn primary"); btn(r3, `🏆 Başarımlar (${Object.keys(stats.ach).length}/${achList().length})`, openAchievements);
  tg(g, "achievements", "Başarım bildirimleri");
  g.append(h("small", "muted", "Bütün istatistikler yalnızca bu bilgisayarda tutulur."));
}
{
  const base = studioMore;
  studioMore = function (body, apply) { base(body, apply); richStudio(body, apply); };
}
function tagStudio(root) {
  for (const s of root.querySelectorAll(".st-sec")) {
    const t = s.querySelector(".pe-lbl")?.textContent.trim() || "";
    s.dataset.tab = SEC_TAB[t] || "tema";
  }
  for (const b of root.querySelectorAll(".fx-btn")) {
    if (b.dataset.cost) continue;
    const f = FX_LIST.find(([, l]) => l === b.textContent.trim()); if (f && FX_COST[f[0]]) b.dataset.cost = FX_COST[f[0]];
  }
}
{
  const base = openStudio;
  openStudio = function () {
    base();
    const root = $("#modal-body .studio"); if (!root || root.querySelector(".st-tabs")) return;
    const bar = h("div", "st-tabs"); const search = h("input", "inp st-search"); search.placeholder = "🔍 Ayarlarda ara…";
    let tab = lsGet("shion.studioTab", "tema");
    const set = (k) => { tab = k; lsSet("shion.studioTab", k); root.dataset.tab = search.value.trim() ? "" : k; bar.querySelectorAll("button").forEach((b) => b.classList.toggle("sel", b.dataset.k === k)); };
    for (const [k, label] of STUDIO_TABS) { const b = h("button", "", label); b.dataset.k = k; b.onclick = () => { search.value = ""; filter(); set(k); }; bar.append(b); }
    const filter = () => {
      const q = search.value.trim().toLocaleLowerCase("tr");
      root.dataset.tab = q ? "" : tab;
      for (const s of root.querySelectorAll(".st-sec")) s.classList.toggle("st-hide", !!q && !s.textContent.toLocaleLowerCase("tr").includes(q));
    };
    search.oninput = filter;
    root.prepend(bar, search);
    const snap = JSON.stringify(Object.fromEntries(Object.keys(RICH_DEFAULTS).filter((k) => !["achievements", "perfMeter"].includes(k)).map((k) => [k, cfg[k]])));
    const undo = [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === "Geri al");
    undo?.addEventListener("click", () => { Object.assign(cfg, JSON.parse(snap)); saveCfg(); recomputePerf(true); });
    tagStudio(root); set(tab);
    new MutationObserver(() => { tagStudio(root); filter(); }).observe(root, { childList: true, subtree: true });
  };
}
async function measurePerf(out) {
  const keep = cfg.perf, res = [];
  out.textContent = "Ölçülüyor… (her seviye 3 sn)";
  for (const [k, ico, name] of PERF_LEVELS) {
    cfg.perf = k; window.__perfOverride = null; applyCfg();
    await new Promise((r) => setTimeout(r, 600));
    const n = await new Promise((r) => { let f = 0; const t0 = performance.now(); const step = (t) => { f++; if (t - t0 < 3000) requestAnimationFrame(step); else r(Math.round((f * 1000) / (t - t0))); }; requestAnimationFrame(step); });
    res.push([ico + " " + name, n, performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null]);
  }
  cfg.perf = keep; saveCfg(); recomputePerf(true);
  out.innerHTML = `<table class="perf-table"><tr><th>Seviye</th><th>FPS</th><th>Bellek</th></tr>${res.map(([n, f, m]) => `<tr><td>${n}</td><td><b>${f}</b></td><td>${m ?? "—"} MB</td></tr>`).join("")}</table>`;
  return res;
}

/* ================================================================== */
/* Kısayollar, Yenilikler, başlangıç                                    */
/* ================================================================== */
document.addEventListener("keydown", (e) => {
  if (!e.ctrlKey || !e.shiftKey || $("#app").classList.contains("hidden")) return;
  const k = e.key.toLowerCase();
  if (k === "p") { e.preventDefault(); cyclePerf(); }
  else if (k === "y") { e.preventDefault(); openWrapped(); }
});
WHATS_NEW.splice(0, WHATS_NEW.length,
  ["⚡", "Performans modu", "Tek tuşla 🍃 Sade · ⚖ Dengeli · ✨ Şölen (Ctrl+Shift+P, alt paneldeki ⚡). Oyunda otomatik Sade", () => openStudio()],
  ["🎭", "Sahne, holografik kart, Spotify kartı", "Profil kartı fareyle eğilir; dinlenen şarkı ve oyun canlı kartlarda; ses kanalı sahne görünümü", () => openStudio()],
  ["✨", "Shion yazı efektleri ve ekran efektleri", "Mesaj kutusundaki ✨: gökkuşağı, dalga, daktilo… /kar /konfeti /kalp herkesin ekranında", () => { const i = $("#input"); if (i) { i.value = "/konfeti "; i.focus(); } }],
  ["🌌", "Video duvar kağıdı, sunucuya özel tema, mevsim modu", "İmleç izi, paralaks, açılış ekranı, tema galerisi ve tema kodu paylaşımı", () => openGallery()],
  ["📊", "Shion Wrapped ve başarımlar", "Kiminle ne kadar konuştun, ne zaman aktifsin, 16 başarım (Ctrl+Shift+Y)", () => openWrapped()],
);
setTimeout(tfxButton, 0);
loadWallVideo();
applyCfg();
renderMe();
