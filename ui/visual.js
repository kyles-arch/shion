"use strict";
/* Shion — görsel paket: animasyonlu arka planlar, cam görünüm, özel şekiller, profil süslemeleri
   (çerçeve, isim efekti, kart arka planı — biyografideki görünmez kodla diğer Shion kullanıcılarına da görünür)
   ve canlı önizlemeli tema stüdyosu. vencord.js'ten sonra yüklenir. */

const VIS_DEFAULTS = { fx: "", fxDensity: 1, glass: false, glassAlpha: 0.72, glassBlur: true, shape: "daire", glow: false,
  msgStyle: "klasik", font: "", msgFx: true, wallBlur: 0, wallDim: 0.35,
  deco: { frame: "", name: "", card: "", c1: "#a78bfa", c2: "#22d3ee" }, decoShare: false, customTheme: { base: "#141824", accent: "#7c6cff", accent2: "#4fd1c5", text: "" } };
for (const [k, v] of Object.entries(VIS_DEFAULTS)) if (cfg[k] === undefined) cfg[k] = structuredClone(v);
THEMES.push(["ozel", "Özel 🎨"]);

/* ================================================================== */
/* Özel tema paleti                                                    */
/* ================================================================== */
function hexToHsl(hex) {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l * 100];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s * 100, l * 100];
}
const hsl = (hh, s, l, a = 1) => `hsla(${hh.toFixed(0)}, ${s.toFixed(0)}%, ${Math.max(0, Math.min(100, l)).toFixed(1)}%, ${a})`;
function customPalette(t) {
  const [hh, s, l] = hexToHsl(t.base || "#141824");
  const light = l > 55, sg = Math.min(s, 40), step = light ? -1 : 1;
  const L = (n) => (light ? Math.min(98, l) : Math.max(4, Math.min(l, 14))) + step * n;
  return {
    "--bg-0": hsl(hh, sg, L(0)), "--bg-1": hsl(hh, sg, L(3)), "--bg-2": hsl(hh, sg, L(5)), "--bg-3": hsl(hh, sg, L(9)), "--bg-4": hsl(hh, sg, L(14)),
    "--border": hsl(hh, sg, L(8)), "--text": t.text || (light ? hsl(hh, 20, 12) : hsl(hh, 25, 93)), "--muted": light ? hsl(hh, 12, 42) : hsl(hh, 14, 62),
    "--accent": t.accent || "#7c6cff", "--accent-2": t.accent2 || "#4fd1c5", "--mention": `color-mix(in srgb, ${t.accent || "#7c6cff"} 14%, transparent)`,
    "--danger": "#ff5c7a", "--ok": "#3ddc97", "--deleted": "rgba(255,92,122,.10)", "--shadow": "0 10px 40px rgba(0,0,0,.45)",
  };
}

/* ================================================================== */
/* Uygula: tema paleti → cam → şekil → efekt → süsleme CSS'i           */
/* ================================================================== */
const VIS_VARS = ["--bg-0", "--bg-1", "--bg-2", "--bg-3", "--bg-4", "--border", "--text", "--muted", "--accent-2", "--mention", "--danger", "--ok", "--deleted", "--shadow", "--solid-bg"];
function applyVisual() {
  const r = document.documentElement, st = r.style;
  for (const v of VIS_VARS) st.removeProperty(v);
  if (!cfg.accent) st.removeProperty("--accent");
  if (cfg.theme === "ozel") for (const [k, v] of Object.entries(customPalette(cfg.customTheme))) if (k !== "--accent" || !cfg.accent) st.setProperty(k, v);
  const glassy = !!(cfg.glass || cfg.fx || wallpaperData()) && !["aurora", "cam"].includes(cfg.theme);
  r.classList.toggle("glassy", glassy);
  r.classList.toggle("glass-blur", glassy && cfg.glassBlur);
  if (glassy) {
    const cs = getComputedStyle(r);
    st.setProperty("--solid-bg", cs.getPropertyValue("--bg-0").trim());
    const a = Math.round(cfg.glassAlpha * 100);
    for (const [v, extra] of [["--bg-0", 6], ["--bg-1", 0], ["--bg-2", -8]]) st.setProperty(v, `color-mix(in srgb, ${cs.getPropertyValue(v).trim()} ${Math.max(20, Math.min(100, a + extra))}%, transparent)`);
  }
  r.dataset.shape = cfg.shape || "daire";
  const sp = SHAPE_PATHS[cfg.shape];
  if (sp) { st.setProperty("--shape-mask", svgUrl(`<path d='${sp}'/>`)); st.setProperty("--shape-ring", svgUrl(`<path d='${sp}' fill='none' stroke='%23000' stroke-width='7' transform='translate(5 5) scale(.9)'/>`)); }
  else { st.removeProperty("--shape-mask"); st.removeProperty("--shape-ring"); }
  r.classList.toggle("glow", !!cfg.glow);
  r.dataset.msgStyle = cfg.msgStyle || "klasik";
  if (cfg.font) { r.dataset.font = "1"; st.setProperty("--ufont", `"${cfg.font}", "Segoe UI", system-ui, sans-serif`); } else { delete r.dataset.font; st.removeProperty("--ufont"); }
  applyWallpaper();
  startFx(cfg.noAnim ? "" : cfg.fx);
  renderDecoCss();
}
{
  const base = applyCfg;
  applyCfg = function () { base(); applyVisual(); };
}

/* ================================================================== */
/* Animasyonlu arka planlar                                            */
/* ================================================================== */
const FX_LIST = [
  ["", "Yok"], ["yildiz", "🌌 Yıldız alanı"], ["kar", "❄️ Kar"], ["sakura", "🌸 Sakura"], ["atesbocegi", "✨ Ateş böcekleri"],
  ["ag", "🕸 Parçacık ağı"], ["kabarcik", "🫧 Kabarcıklar"], ["matrix", "💚 Matrix yağmuru"],
  ["css-aurora", "🌈 Aurora"], ["css-synth", "🌆 Neon ızgara"], ["css-akis", "🎨 Akan renkler"],
];
let fxState = null;
function accentRgb() {
  const c = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const m = c.match(/^#([0-9a-f]{6})$/i);
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [124, 108, 255];
}
function startFx(kind) {
  const r = document.documentElement;
  for (const [k] of FX_LIST) if (k.startsWith("css-")) r.classList.remove("fx-" + k);
  if (fxState) { cancelAnimationFrame(fxState.raf); fxState.cv.remove(); fxState = null; }
  if (!kind) return;
  if (kind.startsWith("css-")) { r.classList.add("fx-" + kind); return; }
  const cv = h("canvas"); cv.id = "fx-canvas"; document.body.prepend(cv);
  const ctx = cv.getContext("2d");
  const st = { cv, ctx, kind, w: 0, h: 0, raf: 0, last: 0, parts: [], mouse: { x: -1e4, y: -1e4 }, acc: accentRgb() };
  const resize = () => { st.w = cv.width = innerWidth; st.h = cv.height = innerHeight; seed(st); };
  st.resize = resize; resize();
  fxState = st;
  const loop = (t) => {
    st.raf = requestAnimationFrame(loop);
    if (document.hidden || t - st.last < 33) return; // ~30 fps
    const dt = Math.min(0.05, (t - (st.last || t)) / 1000); st.last = t;
    FX[kind].draw(st, dt, t / 1000);
  };
  st.raf = requestAnimationFrame(loop);
}
addEventListener("resize", () => fxState?.resize());
addEventListener("mousemove", (e) => { if (fxState) { fxState.mouse.x = e.clientX; fxState.mouse.y = e.clientY; } }, { passive: true });
const rnd = (a, b) => a + Math.random() * (b - a);
function seed(st) {
  const area = (st.w * st.h) / (1280 * 720), n = (base) => Math.round(base * area * (cfg.fxDensity || 1));
  st.parts = [];
  const f = FX[st.kind];
  for (let i = 0; i < n(f.count); i++) st.parts.push(f.make(st, true));
  if (st.kind === "matrix") { st.cols = Array.from({ length: Math.ceil(st.w / 16) }, () => rnd(-st.h, 0)); st.ctx.fillStyle = "#000"; }
}
const KATA = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789ŞĞÜİÖÇ";
const FX = {
  yildiz: {
    count: 220,
    make: (st) => ({ x: rnd(0, st.w), y: rnd(0, st.h), r: rnd(0.3, 1.6), p: rnd(0, 6.28), s: rnd(0.5, 2) }),
    draw(st, dt, t) {
      const { ctx, w, h: H } = st; ctx.clearRect(0, 0, w, H);
      for (const p of st.parts) { ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(t * p.s + p.p)); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); }
      if (!st.shoot && Math.random() < 0.006) st.shoot = { x: rnd(0, w), y: rnd(0, H / 2), vx: rnd(500, 900), vy: rnd(150, 350), l: 1 };
      const s = st.shoot;
      if (s) {
        const g = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.12, s.y - s.vy * 0.12);
        g.addColorStop(0, `rgba(255,255,255,${s.l})`); g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.12, s.y - s.vy * 0.12); ctx.stroke();
        s.x += s.vx * dt; s.y += s.vy * dt; s.l -= dt * 0.9; if (s.l <= 0 || s.x > w + 100) st.shoot = null;
      }
      ctx.globalAlpha = 1;
    },
  },
  kar: {
    count: 140,
    make: (st, init) => ({ x: rnd(0, st.w), y: init ? rnd(0, st.h) : -10, r: rnd(1, 3.4), v: rnd(25, 70), p: rnd(0, 6.28) }),
    draw(st, dt, t) {
      const { ctx, w, h: H } = st; ctx.clearRect(0, 0, w, H); ctx.fillStyle = "rgba(255,255,255,.85)";
      for (const p of st.parts) {
        p.y += p.v * dt; p.x += Math.sin(t + p.p) * 18 * dt;
        if (p.y > H + 5) Object.assign(p, FX.kar.make(st, false));
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill();
      }
    },
  },
  sakura: {
    count: 55,
    make: (st, init) => ({ x: rnd(-50, st.w), y: init ? rnd(0, st.h) : -20, s: rnd(5, 10), v: rnd(30, 65), a: rnd(0, 6.28), va: rnd(-1.5, 1.5), sw: rnd(20, 60), p: rnd(0, 6.28) }),
    draw(st, dt, t) {
      const { ctx, w, h: H } = st; ctx.clearRect(0, 0, w, H);
      for (const p of st.parts) {
        p.y += p.v * dt; p.x += (Math.sin(t * 0.8 + p.p) * p.sw + 25) * dt; p.a += p.va * dt;
        if (p.y > H + 20 || p.x > w + 40) Object.assign(p, FX.sakura.make(st, false));
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.scale(1, Math.abs(Math.sin(t * 2 + p.p)) * 0.6 + 0.4);
        ctx.fillStyle = "rgba(255,183,213,.85)"; ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.6, 0, 0, 6.28); ctx.fill();
        ctx.fillStyle = "rgba(255,140,190,.6)"; ctx.beginPath(); ctx.ellipse(p.s * 0.3, 0, p.s * 0.35, p.s * 0.2, 0, 0, 6.28); ctx.fill(); ctx.restore();
      }
    },
  },
  atesbocegi: {
    count: 45,
    make: (st) => ({ x: rnd(0, st.w), y: rnd(0, st.h), vx: rnd(-15, 15), vy: rnd(-15, 15), p: rnd(0, 6.28), r: rnd(1.5, 3) }),
    draw(st, dt, t) {
      const { ctx, w, h: H } = st; ctx.clearRect(0, 0, w, H);
      for (const p of st.parts) {
        p.vx += rnd(-20, 20) * dt; p.vy += rnd(-20, 20) * dt; p.vx *= 0.99; p.vy *= 0.99;
        p.x = (p.x + p.vx * dt + w) % w; p.y = (p.y + p.vy * dt + H) % H;
        const a = 0.25 + 0.75 * Math.max(0, Math.sin(t * 1.3 + p.p));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        g.addColorStop(0, `rgba(255,236,140,${a})`); g.addColorStop(0.3, `rgba(190,255,120,${a * 0.45})`); g.addColorStop(1, "rgba(190,255,120,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 6, 0, 6.28); ctx.fill();
      }
    },
  },
  ag: {
    count: 70,
    make: (st) => ({ x: rnd(0, st.w), y: rnd(0, st.h), vx: rnd(-25, 25), vy: rnd(-25, 25) }),
    draw(st, dt) {
      const { ctx, w, h: H, parts, mouse } = st; ctx.clearRect(0, 0, w, H);
      const [r, g, b] = st.acc;
      for (const p of parts) {
        const dx = mouse.x - p.x, dy = mouse.y - p.y, d = Math.hypot(dx, dy);
        if (d < 160) { p.vx += (dx / d) * 30 * dt; p.vy += (dy / d) * 30 * dt; }
        p.vx = Math.max(-40, Math.min(40, p.vx)); p.vy = Math.max(-40, Math.min(40, p.vy));
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > H) p.vy *= -1;
      }
      ctx.lineWidth = 1;
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i], c = parts[j], d = Math.hypot(a.x - c.x, a.y - c.y);
        if (d < 130) { ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - d / 130) * 0.45})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(c.x, c.y); ctx.stroke(); }
      }
      ctx.fillStyle = `rgba(${r},${g},${b},.9)`;
      for (const p of parts) { ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 6.28); ctx.fill(); }
    },
  },
  kabarcik: {
    count: 40,
    make: (st, init) => ({ x: rnd(0, st.w), y: init ? rnd(0, st.h) : st.h + 30, r: rnd(4, 22), v: rnd(20, 55), p: rnd(0, 6.28) }),
    draw(st, dt, t) {
      const { ctx, w, h: H } = st; ctx.clearRect(0, 0, w, H);
      const [r, g, b] = st.acc;
      for (const p of st.parts) {
        p.y -= p.v * dt; p.x += Math.sin(t + p.p) * 12 * dt;
        if (p.y < -30) Object.assign(p, FX.kabarcik.make(st, false));
        ctx.strokeStyle = `rgba(${r},${g},${b},.55)`; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.beginPath(); ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.22, 0, 6.28); ctx.fill();
      }
    },
  },
  matrix: {
    count: 0, make: () => ({}),
    draw(st) {
      const { ctx, w, h: H } = st;
      ctx.fillStyle = "rgba(0,0,0,.09)"; ctx.fillRect(0, 0, w, H);
      ctx.font = "15px monospace";
      const [r, g, b] = cfg.theme === "matrix" ? [0, 255, 102] : st.acc;
      st.cols.forEach((y, i) => {
        ctx.fillStyle = Math.random() < 0.05 ? "#fff" : `rgb(${r},${g},${b})`;
        ctx.fillText(KATA[(Math.random() * KATA.length) | 0], i * 16, y);
        st.cols[i] = y > H + Math.random() * 4000 ? 0 : y + 16;
      });
    },
  },
};

/* ================================================================== */
/* Profil süslemeleri                                                  */
/* ================================================================== */
const FRAMES = [
  ["", "Yok"], ["neon", "Neon"], ["ikili", "İkili renk"], ["gokkusagi", "Gökkuşağı"], ["altin", "Altın"], ["alev", "Alev"],
  ["buz", "Buz"], ["elektrik", "Elektrik"], ["kalp", "Kalp atışı"], ["galaksi", "Galaksi"],
];
const NAME_FX = [["", "Yok"], ["gradyan", "Gradyan"], ["gokkusagi", "Gökkuşağı"], ["parilti", "Parıltı"], ["isilti", "Işıltı"], ["glitch", "Glitch"], ["alev", "Alev"]];
const CARD_FX = [["", "Yok"], ["yildizli", "Yıldızlı gece"], ["dalga", "Dalgalar"], ["ikili", "İki renk"], ["galaksi", "Galaksi"], ["izgara", "Neon ızgara"]];
const FRAME_CSS = {
  neon: "padding:2px;background:var(--d1);box-shadow:0 0 8px var(--d1),0 0 18px var(--d1);animation:v-pulse 2.2s ease-in-out infinite",
  ikili: "padding:2.5px;background:conic-gradient(from var(--ang),var(--d1),var(--d2),var(--d1));animation:v-spin 3s linear infinite",
  gokkusagi: "padding:2.5px;background:conic-gradient(from var(--ang),#ff004c,#ffb300,#4cff00,#00e5ff,#7a00ff,#ff004c);animation:v-spin 2.5s linear infinite",
  altin: "padding:2.5px;background:conic-gradient(from var(--ang),#fff3b0,#d4a017,#8a6d1d,#ffe066,#d4a017,#fff3b0);box-shadow:0 0 10px #d4a01788;animation:v-spin 5s linear infinite",
  alev: "padding:2.5px;background:radial-gradient(circle at 50% 110%,#fde047,#f97316 40%,#dc2626 70%,#7f1d1d);box-shadow:0 -2px 12px #f97316aa;animation:v-flicker 1.4s ease-in-out infinite",
  buz: "padding:2.5px;background:linear-gradient(var(--ang),#e0f7ff,#7dd3fc,#c4b5fd,#e0f7ff);box-shadow:0 0 12px #7dd3fc99;animation:v-spin 6s linear infinite",
  elektrik: "padding:2px;background:var(--d1);animation:v-zap 1.8s steps(1) infinite",
  kalp: "padding:2px;background:#ff4d8d;box-shadow:0 0 10px #ff4d8d;animation:v-beat 1.2s ease-in-out infinite",
  galaksi: "padding:2.5px;background:conic-gradient(from var(--ang),#0b0230,#6d28d9,#ec4899,#22d3ee,#0b0230);box-shadow:0 0 14px #6d28d9aa;animation:v-spin 8s linear infinite",
};
const NAME_CSS = {
  gradyan: "background:linear-gradient(90deg,var(--d1),var(--d2),var(--d1));background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent!important;animation:v-slide 4s linear infinite",
  gokkusagi: "background:linear-gradient(90deg,#ff004c,#ffb300,#4cff00,#00e5ff,#7a00ff,#ff004c);background-size:300% 100%;-webkit-background-clip:text;background-clip:text;color:transparent!important;animation:v-slide 5s linear infinite",
  parilti: "color:var(--d1)!important;text-shadow:0 0 8px var(--d1);animation:v-tglow 2.4s ease-in-out infinite",
  isilti: "background:linear-gradient(100deg,var(--d1) 40%,#fff 50%,var(--d1) 60%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent!important;animation:v-slide 3s linear infinite",
  glitch: "color:var(--d1)!important;animation:v-glitch 2.5s steps(1) infinite",
  alev: "background:linear-gradient(0deg,#dc2626,#f97316,#fde047);-webkit-background-clip:text;background-clip:text;color:transparent!important;filter:drop-shadow(0 0 4px #f97316aa)",
};

/* Biyografide görünmez kod: Unicode "etiket" karakterleri (U+E0020–U+E007E) */
const TAG0 = 0xe0000;
/* Kısa biçim: "S1" + çerçeve/isim/kart sırası (tek harf) + iki renk (12 hex) = 17 görünmez karakter */
const IDX = "0123456789abcdefghijklmnopqrstuvwxyz";
function encodeDeco(d) {
  const ix = (list, v) => IDX[Math.max(0, list.findIndex(([k]) => k === v))];
  const s = "S1" + ix(FRAMES, d.frame) + ix(NAME_FX, d.name) + ix(CARD_FX, d.card) + (d.c1 || "#a78bfa").slice(1) + (d.c2 || "#22d3ee").slice(1);
  return [...s].map((c) => String.fromCodePoint(TAG0 + c.charCodeAt(0))).join("");
}
function decodeDeco(bio) {
  const m = (bio || "").match(/[\u{E0020}-\u{E007E}]+/u);
  if (!m) return null;
  const s = [...m[0]].map((c) => String.fromCharCode(c.codePointAt(0) - TAG0)).join("");
  if (!/^S1[0-9a-z]{3}[0-9a-f]{12}$/i.test(s)) return null;
  const at = (list, i) => (list[IDX.indexOf(s[i])] || [""])[0];
  return { frame: at(FRAMES, 2), name: at(NAME_FX, 3), card: at(CARD_FX, 4), c1: "#" + s.slice(5, 11), c2: "#" + s.slice(11, 17) };
}
const stripDeco = (bio) => (bio || "").replace(/[\u{E0000}-\u{E007F}]+/gu, "");
const DECOS = new Map(Object.entries(lsGet("shion.decos", {})));
function rememberDeco(uid, d) {
  const old = JSON.stringify(DECOS.get(uid) || null);
  if (d) DECOS.set(uid, d); else DECOS.delete(uid);
  if (old !== JSON.stringify(d || null)) {
    while (DECOS.size > 500) DECOS.delete(DECOS.keys().next().value);
    lsSet("shion.decos", Object.fromEntries(DECOS)); renderDecoCss();
  }
}
const decoOf = (uid) => (uid === S.me?.id ? cfg.deco : DECOS.get(uid));

/* Profil kartında çerçeve avatarın kabına (6px halka) uygulanır — şekilli avatarlarda da görünür. */
const SHAPED = `html:not([data-shape="daire"]):not([data-shape="yuvarlak-kare"])`;
const cardFrame = (f) => FRAME_CSS[f].replace(/padding:[^;]+/, "padding:6px");
/* Her süslemeli kullanıcı için seçicilerle CSS üret (mesaj, üye listesi, ses, alt panel). */
function renderDecoCss() {
  let css = "";
  const all = new Map(DECOS); if (S.me?.id) all.set(S.me.id, cfg.deco);
  for (const [uid, d] of all) {
    if (!d || !/^\d+$/.test(uid)) continue;
    const id = `"${uid}"`;
    const vars = `--d1:${/^#[0-9a-f]{6}$/i.test(d.c1) ? d.c1 : "#a78bfa"};--d2:${/^#[0-9a-f]{6}$/i.test(d.c2) ? d.c2 : "#22d3ee"};`;
    const av = `img.av[data-pop=${id}],[data-pop=${id}]>img,.m-row[data-pop=${id}] .m-av img,.me-av img[data-uid=${id}]`;
    const nm = `.author[data-pop=${id}],.m-row[data-pop=${id}] .m-name b,.vuser[data-pop=${id}] .name,.pc-deco-${uid} .pc-name${uid === S.me?.id ? ",#me-panel .who b" : ""}`;
    css += `${av},${nm},.pc-deco-${uid}{${vars}}\n`;
    if (FRAME_CSS[d.frame]) css += `${av}{box-sizing:border-box;${FRAME_CSS[d.frame]}}\n${SHAPED} :is(${av}){padding:12%!important;-webkit-mask:var(--shape-mask) content-box center/100% 100% no-repeat,var(--shape-ring) border-box center/100% 100% no-repeat!important;mask:var(--shape-mask) content-box center/100% 100% no-repeat,var(--shape-ring) border-box center/100% 100% no-repeat!important}\n.pc.pc-deco-${uid} .pc-av{${cardFrame(d.frame)}}\n.pc.pc-deco-${uid} .pc-av img{animation:none}\n`;
    if (NAME_CSS[d.name]) css += `${nm}{${NAME_CSS[d.name]}}\n`;
  }
  let el = $("#deco-css"); if (!el) { el = h("style"); el.id = "deco-css"; document.head.append(el); }
  if (el.textContent !== css) el.textContent = css;
}
listen("gw-ready", () => setTimeout(renderDecoCss, 300));

/* Profil kartına süsleme sınıflarını uygula + biyografideki kodu oku. */
function visualProfile(pop, u, prof) {
  const pc = pop.querySelector(".pc"); if (!pc) return;
  const bio = prof?.user_profile?.bio;
  if (u.id !== S.me?.id && bio !== undefined) rememberDeco(u.id, decodeDeco(bio));
  const d = decoOf(u.id);
  if (d) {
    pc.classList.add("pc-deco-" + u.id);
    if (d.card) pc.classList.add("card-" + d.card);
    if (d.frame || d.name || d.card) pc.title = u.id === S.me?.id ? "" : "✨ Shion süslemesi";
  }
  profileThemeColors(pc, prof);
  visualProfileMore(pc, u, prof);
}

/* ================================================================== */
/* Süsleme düzenleyici                                                 */
/* ================================================================== */
function openDecoEditor() {
  const d = structuredClone(cfg.deco);
  let share = cfg.decoShare;
  const root = h("div", "deco-ed");
  const prev = h("div", "deco-prev");
  const form = h("div", "deco-form");
  root.append(form, prev);
  const draw = () => {
    const tmp = { ...S.me };
    prev.innerHTML = `<div class="pe-lbl">Önizleme</div>` + profileCardHtml(tmp, null, { status: cfg.status }) +
      `<div class="deco-msg"><img class="av" src="${avatarUrl(S.me, 64)}"><div><span class="author">${esc(dname(S.me))}</span><div>Selam! Yeni süslememe bak ✨</div></div></div>`;
    const pc = prev.querySelector(".pc"); pc.classList.add("deco-live"); if (d.card) pc.classList.add("card-" + d.card);
    prev.style.setProperty("--d1", d.c1); prev.style.setProperty("--d2", d.c2);
    const fcss = FRAME_CSS[d.frame] || "", ncss = NAME_CSS[d.name] || "";
    let s = prev.querySelector("style"); if (!s) { s = h("style"); prev.append(s); }
    s.textContent = `.deco-prev .deco-msg img{box-sizing:border-box;${fcss}} .deco-prev .pc .pc-av{${fcss ? cardFrame(d.frame) : ""}} .deco-prev .pc .pc-av img{${fcss ? "animation:none" : ""}} .deco-prev .pc-name,.deco-prev .deco-msg .author{${ncss}}`;
  };
  const group = (title, list, key) => {
    const w = h("div", "deco-group", `<div class="pe-lbl">${title}</div>`);
    const row = h("div", "deco-opts");
    for (const [k, label] of list) {
      const b = h("button", "fx-btn" + (d[key] === k ? " sel" : ""), label);
      b.onclick = () => { d[key] = k; row.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); draw(); };
      row.append(b);
    }
    w.append(row); form.append(w);
  };
  group("Avatar çerçevesi", FRAMES, "frame");
  group("İsim efekti", NAME_FX, "name");
  group("Kart arka planı", CARD_FX, "card");
  const colors = h("div", "deco-group", `<div class="pe-lbl">Renkler</div>`);
  const cr = h("div", "pe-row");
  for (const k of ["c1", "c2"]) { const i = h("input"); i.type = "color"; i.value = d[k]; i.oninput = () => { d[k] = i.value; draw(); }; cr.append(i); }
  const presets = [["#a78bfa", "#22d3ee"], ["#ff4d8d", "#ffb86b"], ["#00ff99", "#00b3ff"], ["#ffd700", "#ff6a00"], ["#f0abfc", "#7dd3fc"], ["#ef4444", "#111827"]];
  for (const [a, b] of presets) {
    const p = h("button", "deco-sw"); p.style.background = `linear-gradient(135deg,${a},${b})`;
    p.onclick = () => { d.c1 = a; d.c2 = b; cr.querySelectorAll("input")[0].value = a; cr.querySelectorAll("input")[1].value = b; draw(); };
    cr.append(p);
  }
  colors.append(cr); form.append(colors);
  const sh = h("label", "deco-share", `<input type="checkbox" ${share ? "checked" : ""}> <span><b>Shion kullanıcıları da görsün</b><small class="muted">Biyografine görünmez bir kod eklenir (Discord'da görünmez, 17 karakter yer kaplar). Diğer Shion kullanıcıları profilini açınca süslemeni görür.</small></span>`);
  sh.querySelector("input").onchange = (e) => (share = e.target.checked);
  form.append(sh);
  const act = h("div", "pe-actions");
  const cancel = h("button", "btn", "Vazgeç"); cancel.onclick = closeModal;
  const save = h("button", "btn primary", "Kaydet");
  save.onclick = async () => {
    save.disabled = true;
    const wasShared = cfg.decoShare;
    cfg.deco = d; cfg.decoShare = share; saveCfg(); renderDecoCss(); renderMe();
    if (share || wasShared) {
      try {
        profileCache.clear();
        const prof = await fetchProfile(S.me.id, null);
        const clean = stripDeco(prof?.user_profile?.bio || "");
        const code = share && (d.frame || d.name || d.card) ? encodeDeco(d) : "";
        if ([...clean].length + [...code].length > 190) { toast("Biyografin çok uzun — kod için 17 karakter yer aç"); save.disabled = false; return; }
        if (clean + code !== (prof?.user_profile?.bio || "")) await invoke("update_profile", { user: {}, profile: { bio: clean + code } });
        profileCache.clear();
      } catch (e) { toast("Biyografi güncellenemedi: " + e); save.disabled = false; return; }
    }
    closeModal(); toast("✨ Süsleme kaydedildi");
  };
  act.append(cancel, save); root.append(act);
  openModal("Profil süslemeleri", root);
  draw();
}

/* ================================================================== */
/* Tema stüdyosu                                                       */
/* ================================================================== */
const LOOKS = [
  ["Galaksi", { theme: "gece", fx: "yildiz", shape: "daire", glow: true, glass: true }],
  ["Synthwave", { theme: "ozel", customTheme: { base: "#140a24", accent: "#ff2bd6", accent2: "#22d3ee" }, fx: "css-synth", shape: "elmas", glow: true, glass: true }],
  ["Kış gecesi", { theme: "okyanus", fx: "kar", shape: "yuvarlak-kare", glow: false, glass: true }],
  ["Sakura bahçesi", { theme: "ozel", customTheme: { base: "#1f1218", accent: "#ff8fb8", accent2: "#ffd1e3" }, fx: "sakura", shape: "kalp", glow: false, glass: true }],
  ["Hacker", { theme: "matrix", fx: "matrix", shape: "altigen", glow: true, glass: true }],
  ["Orman", { theme: "kahve", fx: "atesbocegi", shape: "damla", glow: false, glass: true }],
  ["Siber ağ", { theme: "nord", fx: "ag", shape: "altigen", glow: true, glass: true }],
  ["Sade", { theme: "gece", fx: "", shape: "daire", glow: false, glass: false }],
];
const SHAPES = [["daire", "Daire"], ["yuvarlak-kare", "Yuvarlak kare"], ["altigen", "Altıgen"], ["elmas", "Elmas"], ["damla", "Damla"], ["yildiz", "Yıldız"], ["kalp", "Kalp"]];
function openStudio() {
  const snap = JSON.stringify(Object.fromEntries(["theme", "fx", "fxDensity", "glass", "glassAlpha", "glassBlur", "shape", "glow", "customTheme", "accent", "msgStyle", "font", "wallBlur", "wallDim", "soundPack", "soundVol", "sendSound", "schedule", "collectibles"].map((k) => [k, cfg[k]])));
  const root = h("div", "studio");
  const apply = () => { saveCfg(); applyCfg(); };
  const sec = (t) => { const s = h("div", "st-sec", `<div class="pe-lbl">${t}</div>`); root.append(s); return s; };

  const looks = sec("Hazır görünümler");
  const lw = h("div", "st-looks");
  for (const [name, v] of LOOKS) {
    const b = h("button", "st-look", `<span class="st-look-fx">${v.fx ? FX_LIST.find((x) => x[0] === v.fx)[1].split(" ")[0] : "🤍"}</span>${esc(name)}`);
    b.onclick = () => { Object.assign(cfg, structuredClone(v)); if (v.theme !== "ozel") cfg.accent = ""; apply(); redraw(); };
    lw.append(b);
  }
  looks.append(lw);

  const body = h("div"); root.append(body);
  const redraw = () => {
    body.textContent = "";
    const s1 = h("div", "st-sec", `<div class="pe-lbl">Temel tema</div>`);
    const sel = h("select", "inp"); sel.innerHTML = THEMES.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join(""); sel.value = cfg.theme;
    sel.onchange = () => { cfg.theme = sel.value; apply(); redraw(); };
    s1.append(sel);
    if (cfg.theme === "ozel") {
      const cr = h("div", "st-colors");
      for (const [k, label] of [["base", "Arka plan"], ["accent", "Vurgu"], ["accent2", "İkinci vurgu"]]) {
        const l = h("label", "", `<span>${label}</span>`); const i = h("input"); i.type = "color"; i.value = cfg.customTheme[k] || "#7c6cff";
        i.oninput = () => { cfg.customTheme = { ...cfg.customTheme, [k]: i.value }; if (k === "accent") cfg.accent = ""; apply(); };
        l.append(i); cr.append(l);
      }
      s1.append(cr);
    }
    body.append(s1);

    const s2 = h("div", "st-sec", `<div class="pe-lbl">Hareketli arka plan</div>`);
    const fw = h("div", "deco-opts");
    for (const [k, label] of FX_LIST) {
      const b = h("button", "fx-btn" + (cfg.fx === k ? " sel" : ""), label);
      b.onclick = () => { cfg.fx = k; apply(); fw.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); };
      fw.append(b);
    }
    s2.append(fw);
    const slider = (label, key, min, max, step, after) => {
      const r = h("label", "st-slider", `<span>${label}</span>`); const i = h("input"); i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = cfg[key];
      i.oninput = () => { cfg[key] = +i.value; after ? after() : apply(); }; r.append(i); return r;
    };
    s2.append(slider("Yoğunluk", "fxDensity", 0.3, 2, 0.1, () => { saveCfg(); fxState && seed(fxState); }));
    body.append(s2);

    const s3 = h("div", "st-sec", `<div class="pe-lbl">Cam görünüm</div>`);
    const tg = (key, label) => { const l = h("label", "st-tg", `<input type="checkbox" ${cfg[key] ? "checked" : ""}> ${label}`); l.querySelector("input").onchange = (e) => { cfg[key] = e.target.checked; apply(); }; return l; };
    s3.append(tg("glass", "Yarı saydam paneller (hareketli arka planda otomatik açık)"), tg("glassBlur", "Buzlu cam bulanıklığı"), tg("glow", "Parlayan kenarlar ve vurgular"),
      slider("Panel opaklığı", "glassAlpha", 0.3, 0.95, 0.01));
    body.append(s3);

    const s4 = h("div", "st-sec", `<div class="pe-lbl">Avatar ve sunucu simgesi şekli</div>`);
    const sw = h("div", "st-shapes");
    for (const [k, label] of SHAPES) {
      const b = h("button", "st-shape" + (cfg.shape === k ? " sel" : ""), `<img data-shape-prev="${k}" src="${avatarUrl(S.me || {}, 64)}"><small>${label}</small>`);
      b.onclick = () => { cfg.shape = k; apply(); sw.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); };
      sw.append(b);
    }
    s4.append(sw); body.append(s4);
    studioExtras(body, apply, redraw);
    studioMore(body, apply);
    const s5 = h("div", "st-sec", `<div class="pe-lbl">Profil</div>`);
    const db = h("button", "btn", "✨ Profil süslemelerini düzenle"); db.onclick = openDecoEditor;
    s5.append(db); body.append(s5);
  };
  redraw();
  const act = h("div", "pe-actions");
  const undo = h("button", "btn", "Geri al"); undo.onclick = () => { Object.assign(cfg, JSON.parse(snap)); apply(); closeModal(); toast("Değişiklikler geri alındı"); };
  const ok = h("button", "btn primary", "Tamam"); ok.onclick = () => { closeModal(); toast("🎨 Görünüm kaydedildi"); };
  act.append(undo, ok); root.append(act);
  openModal("Görünüm stüdyosu 🎨", root);
}
function visualSettings(root, sec) {
  const s = sec("Görünüm stüdyosu 🎨");
  const r = h("div", "row", `<label>Hareketli arka planlar, cam, şekiller, özel tema<small>Canlı önizlemeyle dene — beğenmezsen "Geri al"</small></label>`);
  const b = h("button", "btn primary", "Stüdyoyu aç"); b.onclick = openStudio; r.append(b); s.append(r);
  const r2 = h("div", "row", `<label>Profil süslemeleri<small>Avatar çerçevesi, isim efekti, kart arka planı</small></label>`);
  const b2 = h("button", "btn", "Düzenle"); b2.onclick = openDecoEditor; r2.append(b2); s.append(r2);
  const r3 = h("div", "row", `<label>Bu sürümdeki yenilikler<small>Shion ${SHION_VERSION}</small></label>`);
  const b3 = h("button", "btn", "Göster"); b3.onclick = showWhatsNew; r3.append(b3); s.append(r3);
}
/* ================================================================== */
/* Şekil yolları (maske + şekilli çerçeve halkası)                     */
/* ================================================================== */
const SHAPE_PATHS = {
  altigen: "M50 2 93 26v48L50 98 7 74V26z",
  elmas: "M50 3Q54 3 57 6L94 43Q97 46 97 50T94 57L57 94Q54 97 50 97T43 94L6 57Q3 54 3 50T6 43L43 6Q46 3 50 3z",
  damla: "M50 0h50v50A50 50 0 1 1 50 0z",
  yildiz: "M50 3l13 31 34 3-26 22 8 34-29-18-29 18 8-34L3 37l34-3z",
  kalp: "M50 92C20 70 2 52 2 30 2 14 14 4 28 4c10 0 17 5 22 13C55 9 62 4 72 4c14 0 26 10 26 26 0 22-18 40-48 62z",
};
const svgUrl = (inner) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E${inner.replace(/</g, "%3C").replace(/>/g, "%3E")}%3C/svg%3E")`;

/* ================================================================== */
/* Duvar kağıdı                                                        */
/* ================================================================== */
let wallCache;
const wallpaperData = () => (wallCache === undefined ? (wallCache = lsGet("shion.wallpaper", "")) : wallCache);
function applyWallpaper() {
  const src = wallpaperData();
  let el = $("#wallpaper");
  if (!src) { el?.remove(); return; }
  if (!el) { el = h("div"); el.id = "wallpaper"; document.body.prepend(el); }
  el.style.backgroundImage = `url("${src}")`;
  el.style.filter = cfg.wallBlur ? `blur(${cfg.wallBlur}px)` : "";
  el.style.inset = cfg.wallBlur ? `-${cfg.wallBlur * 2}px` : "0";
  el.style.setProperty("--dim", cfg.wallDim);
}
/** Seçilen resmi en fazla 1920px'e küçültüp JPEG olarak saklar (localStorage sınırı için). */
function pickWallpaper(after) {
  const inp = h("input"); inp.type = "file"; inp.accept = "image/*";
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1920 / Math.max(img.width, img.height));
      const c = h("canvas"); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      setWallpaper(c.toDataURL("image/jpeg", 0.85)); URL.revokeObjectURL(img.src); after?.();
    };
    img.onerror = () => toast("Resim açılamadı");
    img.src = URL.createObjectURL(f);
  };
  inp.click();
}
function setWallpaper(data) {
  wallCache = data || "";
  try { if (data) localStorage.setItem("shion.wallpaper", JSON.stringify(data)); else localStorage.removeItem("shion.wallpaper"); }
  catch { toast("Resim çok büyük, kaydedilemedi"); }
  applyVisual();
}

/* ================================================================== */
/* Mesaj efektleri: konfeti, kalpler, havai fişek                      */
/* ================================================================== */
const BURSTS = [
  [/🎉|🥳|🎊|tebrik|doğum ?günü|iyi ki doğdun|congrat|happy birthday/i, "konfeti"],
  [/❤️|💖|💕|😍|🥰|seni seviyorum|love you/i, "kalp"],
  [/🎆|🎇|yeni yıl|mutlu yıllar|happy new year/i, "fisek"],
];
let burst = null;
function burstFx(kind) {
  if (cfg.noAnim || !cfg.msgFx) return;
  if (!burst) {
    const cv = h("canvas"); cv.id = "burst-canvas"; document.body.append(cv);
    burst = { cv, ctx: cv.getContext("2d"), parts: [], raf: 0 };
  }
  const { cv } = burst; cv.width = innerWidth; cv.height = innerHeight;
  const W = cv.width, H = cv.height, cols = ["#ff4d8d", "#ffd23f", "#3ddc97", "#4fc3ff", "#a78bfa", "#ff8a3d"];
  if (kind === "konfeti") for (let i = 0; i < 160; i++) burst.parts.push({ k: "c", x: rnd(0, W), y: rnd(-H * 0.3, -10), vx: rnd(-60, 60), vy: rnd(120, 320), a: rnd(0, 6.28), va: rnd(-8, 8), w: rnd(6, 11), c: cols[i % 6], l: 4 });
  if (kind === "kalp") for (let i = 0; i < 40; i++) burst.parts.push({ k: "h", x: rnd(0, W), y: H + rnd(0, 200), vx: rnd(-20, 20), vy: -rnd(120, 260), s: rnd(14, 30), p: rnd(0, 6.28), l: 4 });
  if (kind === "fisek") for (let j = 0; j < 4; j++) {
    const cx = rnd(W * 0.2, W * 0.8), cy = rnd(H * 0.15, H * 0.45), c = cols[(Math.random() * 6) | 0], d = j * 0.45;
    for (let i = 0; i < 70; i++) { const ang = (i / 70) * 6.28, sp = rnd(80, 260); burst.parts.push({ k: "f", x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, c, l: 1.8, d }); }
  }
  if (burst.raf) return;
  let last = performance.now();
  const loop = (t) => {
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    const { ctx, parts } = burst; ctx.clearRect(0, 0, W, H);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.d > 0) { p.d -= dt; continue; }
      p.l -= dt; if (p.l <= 0 || p.y > H + 60) { parts.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; ctx.globalAlpha = Math.min(1, p.l);
      if (p.k === "c") { p.vy += 60 * dt; p.vx *= 0.99; p.a += p.va * dt; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2); ctx.restore(); }
      else if (p.k === "h") { p.x += Math.sin(t / 400 + p.p) * 30 * dt; ctx.font = `${p.s}px "Segoe UI Emoji"`; ctx.fillText("❤️", p.x, p.y); }
      else { p.vx *= 0.97; p.vy = p.vy * 0.97 + 50 * dt; ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, 6.28); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (parts.length) burst.raf = requestAnimationFrame(loop); else { burst.raf = 0; burst.cv.remove(); burst = null; }
  };
  burst.raf = requestAnimationFrame(loop);
}
function checkBurst(text) {
  for (const [re, kind] of BURSTS) if (re.test(text || "")) { burstFx(kind); return kind; }
  return null;
}
let lastBurst = 0;
listen("msg-create", (e) => {
  const m = e.payload;
  if (m.channel_id !== S.channel?.id || document.hidden || Date.now() - lastBurst < 4000) return;
  if (checkBurst(m.content)) lastBurst = Date.now();
});

/* Mesaj başına: kendi mesajım (baloncuk stili için) + Nitro profil tema renkleri */
{
  const base = vcPost;
  vcPost = function (el, m) { base(el, m); if (m.author?.id && m.author.id === S.me?.id) el.classList.add("own"); };
}
const intHex = (n) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);
function profileThemeColors(pc, prof) {
  const tc = prof?.user_profile?.theme_colors;
  if (!Array.isArray(tc) || tc.length < 2 || pc.className.includes("card-")) return;
  pc.classList.add("nitro-theme");
  pc.style.setProperty("--t1", intHex(tc[0])); pc.style.setProperty("--t2", intHex(tc[1]));
}

/* ================================================================== */
/* Stüdyo ek bölümleri                                                 */
/* ================================================================== */
const FONTS = [["", "Varsayılan (Segoe UI)"], ["Bahnschrift", "Bahnschrift"], ["Trebuchet MS", "Trebuchet"], ["Georgia", "Georgia (serif)"], ["Cascadia Code", "Cascadia Code"], ["Consolas", "Consolas"], ["Comic Sans MS", "Comic Sans"], ["Ink Free", "Ink Free (el yazısı)"], ["Segoe Print", "Segoe Print"]];
const MSG_STYLES = [["klasik", "Klasik"], ["baloncuk", "💬 Baloncuk"], ["kart", "🗂 Kart"]];
function studioExtras(body, apply, redraw) {
  const s1 = h("div", "st-sec", `<div class="pe-lbl">Duvar kağıdı</div>`);
  const row = h("div", "pe-row");
  const prev = h("div", "st-wall"); const wd = wallpaperData(); if (wd) prev.style.backgroundImage = `url("${wd}")`;
  const pick = h("button", "btn", "🖼 Resim seç"); pick.onclick = () => pickWallpaper(() => { prev.style.backgroundImage = `url("${wallpaperData()}")`; });
  const rm = h("button", "btn", "Kaldır"); rm.onclick = () => { setWallpaper(""); prev.style.backgroundImage = ""; };
  const auto = h("button", "btn", "🎨 Duvar kağıdından tema"); auto.title = "Renkleri resimden çıkarıp özel tema oluşturur";
  auto.onclick = async () => { if (await themeFromWallpaper()) redraw?.(); };
  row.append(prev, pick, rm, auto); s1.append(row);
  const sl = (label, key, min, max, step) => {
    const r = h("label", "st-slider", `<span>${label}</span>`); const i = h("input"); i.type = "range"; i.min = min; i.max = max; i.step = step; i.value = cfg[key];
    i.oninput = () => { cfg[key] = +i.value; saveCfg(); applyWallpaper(); }; r.append(i); return r;
  };
  s1.append(sl("Bulanıklık", "wallBlur", 0, 20, 1), sl("Karartma", "wallDim", 0, 0.85, 0.05));
  body.append(s1);

  const s2 = h("div", "st-sec", `<div class="pe-lbl">Mesaj görünümü</div>`);
  const mw = h("div", "deco-opts");
  for (const [k, label] of MSG_STYLES) {
    const b = h("button", "fx-btn" + ((cfg.msgStyle || "klasik") === k ? " sel" : ""), label);
    b.onclick = () => { cfg.msgStyle = k; apply(); mw.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); };
    mw.append(b);
  }
  s2.append(mw);
  const fs = h("select", "inp"); fs.innerHTML = FONTS.map(([v, n]) => `<option value="${esc(v)}" style="font-family:'${esc(v || "Segoe UI")}'">${esc(n)}</option>`).join(""); fs.value = cfg.font || "";
  fs.onchange = () => { cfg.font = fs.value; apply(); };
  const fl = h("label", "st-slider", "<span>Yazı tipi</span>"); fl.append(fs); s2.append(fl);
  const fx = h("label", "st-tg", `<input type="checkbox" ${cfg.msgFx ? "checked" : ""}> Mesaj efektleri (🎉 konfeti, ❤️ kalpler, 🎆 havai fişek)`);
  fx.querySelector("input").onchange = (e) => { cfg.msgFx = e.target.checked; saveCfg(); if (cfg.msgFx) burstFx("konfeti"); };
  s2.append(fx);
  body.append(s2);
}

/* ================================================================== */
/* Discord koleksiyonları: avatar süsü, sunucu (klan) etiketi, isim plakası */
/* ================================================================== */
const COLL_DEFAULTS = { collectibles: true, soundPack: "", soundVol: 0.5, sendSound: false, schedule: { on: false, day: "acik", night: "gece", from: "07:30", to: "19:30" } };
for (const [k, v] of Object.entries(COLL_DEFAULTS)) if (cfg[k] === undefined) cfg[k] = structuredClone(v);
const decoUrl = (u, anim) => { const a = u?.avatar_decoration_data?.asset; return a ? `${CDN}/avatar-decoration-presets/${a}.png?size=96&passthrough=${!!anim}` : ""; };
const clanOf = (u) => { const c = u?.primary_guild || u?.clan; return c?.tag && c.identity_enabled !== false ? c : null; };
function clanHtml(u) {
  const c = cfg.collectibles && clanOf(u); if (!c) return "";
  const b = c.badge && /^\d+$/.test(c.identity_guild_id || "") ? `<img src="${CDN}/guild-tag-badges/${c.identity_guild_id}/${esc(c.badge)}.png?size=16" alt="">` : "";
  return `<span class="clan-tag" title="Sunucu etiketi">${b}${esc(c.tag)}</span>`;
}
const plateUrl = (u) => { const n = u?.collectibles?.nameplate; return n?.asset && /^[\w/-]+$/.test(n.asset) ? `${CDN}/assets/collectibles/${n.asset}static.png` : ""; };
/** Avatarın üstüne Discord avatar süsünü koyar; hoverEl üzerine gelince animasyonlu sürüme geçer. */
function addAvDeco(img, u, anim, hoverEl) {
  const url = cfg.collectibles && img && decoUrl(u, anim); if (!url) return;
  let w = img.parentElement;
  if (!w.classList.contains("av-wrap")) { w = h("span", "av-wrap"); img.replaceWith(w); w.append(img); }
  w.querySelector(".av-deco")?.remove();
  const d = h("img", "av-deco"); d.src = url; d.alt = ""; d.draggable = false; w.append(d);
  if (!anim && hoverEl) { hoverEl.addEventListener("mouseenter", () => (d.src = decoUrl(u, true))); hoverEl.addEventListener("mouseleave", () => (d.src = url)); }
}
function plateRow(row, u) {
  const p = cfg.collectibles && plateUrl(u); if (!p) return;
  row.classList.add("plated"); row.style.setProperty("--plate", `url("${p}")`);
}
{
  const base = vcPost;
  vcPost = function (el, m) {
    base(el, m);
    if (el.classList.contains("grouped") || !m.author) return;
    addAvDeco(el.querySelector(":scope > img.av"), m.author, false, el);
    const a = el.querySelector(".head .author"); if (a) a.insertAdjacentHTML("afterend", clanHtml(m.author));
  };
}
{
  const base = renderMembers;
  renderMembers = function () {
    base();
    if (!cfg.collectibles) return;
    const byId = new Map(); for (const it of S.members.items) if (it?.member?.user) byId.set(it.member.user.id, it.member.user);
    for (const row of document.querySelectorAll("#members .m-row[data-pop]")) {
      const u = byId.get(row.dataset.pop); if (!u) continue;
      addAvDeco(row.querySelector(".m-av img"), u, false, row);
      row.querySelector(".m-name b")?.insertAdjacentHTML("beforeend", clanHtml(u));
      plateRow(row, u);
    }
  };
}
{
  const base = renderSidebar;
  renderSidebar = function () {
    base();
    if (!cfg.collectibles || S.view !== "home") return;
    for (const r of document.querySelectorAll("#channel-list .ch.dm[data-id]")) {
      const d = S.dms.find((x) => x.id === r.dataset.id); const u = d?.type === 1 ? d.recipients?.[0] : null; if (!u) continue;
      addAvDeco(r.querySelector("img"), u, false, r); plateRow(r, u);
    }
  };
}
{
  const base = renderMe;
  renderMe = function () { base(); if (S.me) addAvDeco($(".me-av img"), S.me, false, $(".me-av")); };
}

/* ================================================================== */
/* Duvar kağıdından otomatik tema                                       */
/* ================================================================== */
function hslHex(hh, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return "#" + [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("");
}
/** Görüntüden palet: ortalama renkten koyu arka plan, en baskın canlı tondan vurgu, ondan uzak bir tondan ikinci vurgu. */
function paletteFromImage(img) {
  const c = h("canvas"); c.width = c.height = 48; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0, 48, 48);
  const d = x.getImageData(0, 0, 48, 48).data, buckets = new Map(); let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const rgb = [d[i], d[i + 1], d[i + 2]]; sr += rgb[0]; sg += rgb[1]; sb += rgb[2]; n++;
    const hex = "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join(""); const [hh, s, l] = hexToHsl(hex);
    if (s < 30 || l < 22 || l > 82) continue;
    const key = Math.round(hh / 30) % 12, bk = buckets.get(key) || { n: 0, best: -1, hex };
    bk.n++; const score = s * (1 - Math.abs(l - 58) / 58); if (score > bk.best) { bk.best = score; bk.hex = hex; }
    buckets.set(key, bk);
  }
  const avg = "#" + [sr, sg, sb].map((v) => Math.round(v / n).toString(16).padStart(2, "0")).join("");
  const [ah, as] = hexToHsl(avg);
  const sorted = [...buckets.entries()].sort((a, b) => b[1].n - a[1].n);
  const acc = sorted[0]?.[1].hex || hslHex(ah, 70, 60);
  const far = sorted.find(([k]) => sorted[0] && Math.min(Math.abs(k - sorted[0][0]), 12 - Math.abs(k - sorted[0][0])) >= 2);
  const acc2 = (far || sorted[1])?.[1].hex || hslHex((ah + 150) % 360, 65, 60);
  return { base: hslHex(ah, Math.min(as, 35), 10), accent: acc, accent2: acc2 };
}
function themeFromWallpaper() {
  const src = wallpaperData(); if (!src) { toast("Önce bir duvar kağıdı seç"); return Promise.resolve(null); }
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => { cfg.customTheme = paletteFromImage(img); cfg.theme = "ozel"; cfg.accent = ""; saveCfg(); applyCfg(); toast("🎨 Tema duvar kağıdından oluşturuldu"); res(cfg.customTheme); };
    img.onerror = () => res(null);
    img.src = src;
  });
}

/* ================================================================== */
/* Ses temaları (WebAudio ile üretilir, dosya gerekmez)                */
/* ================================================================== */
const SOUND_PACKS = [["", "Sessiz"], ["kristal", "💎 Kristal"], ["pop", "🫧 Pop"], ["retro", "👾 Retro"], ["yumusak", "🌙 Yumuşak"], ["akor", "🎹 Akor"]];
const PACK_NOTES = {
  kristal: { type: "sine", notes: [[1318, 0], [1760, 0.09]], dur: 0.35 },
  pop: { type: "triangle", notes: [[600, 0], [900, 0.06]], dur: 0.12, slide: true },
  retro: { type: "square", notes: [[880, 0], [1175, 0.07], [1568, 0.14]], dur: 0.08 },
  yumusak: { type: "sine", notes: [[523, 0], [659, 0.12]], dur: 0.6 },
  akor: { type: "triangle", notes: [[523, 0], [659, 0.02], [784, 0.04]], dur: 0.5 },
};
let actx = null;
function soundNotes(p, kind) {
  if (kind === "gonder") return [[p.notes[0][0] * 1.5, 0]];
  if (kind === "katil") return p.notes.map(([f, t]) => [f * 0.75, t]);
  if (kind === "ayril") return p.notes.map(([, t], i) => [p.notes[p.notes.length - 1 - i][0] * 0.75, t]);
  return p.notes;
}
function playUiSound(kind = "bildirim", pack = cfg.soundPack) {
  const p = PACK_NOTES[pack]; if (!p) return null;
  const notes = soundNotes(p, kind);
  try {
    actx ||= new AudioContext();
    const t0 = actx.currentTime + 0.01, vol = Math.max(0.0002, (kind === "gonder" ? 0.4 : 1) * cfg.soundVol * 0.3);
    for (const [f, dt] of notes) {
      const o = actx.createOscillator(), g = actx.createGain(); o.type = p.type;
      o.frequency.setValueAtTime(f, t0 + dt); if (p.slide) o.frequency.exponentialRampToValueAtTime(f * 1.6, t0 + dt + p.dur);
      g.gain.setValueAtTime(0.0001, t0 + dt); g.gain.exponentialRampToValueAtTime(vol, t0 + dt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + p.dur);
      o.connect(g).connect(actx.destination); o.start(t0 + dt); o.stop(t0 + dt + p.dur + 0.05);
    }
  } catch {}
  return notes;
}
{
  const base = notify;
  notify = async function (title, body) { playUiSound("bildirim"); return base(title, body); };
}
const vcPrev = new Map();
listen("voice-state", (e) => {
  const v = e.payload, was = vcPrev.get(v.user_id); vcPrev.set(v.user_id, v.channel_id);
  if (!cfg.soundPack || v.user_id === S.me?.id || S.vc.state !== "connected" || !S.vc.channel_id) return;
  if (v.channel_id === S.vc.channel_id && was !== S.vc.channel_id) playUiSound("katil");
  else if (was === S.vc.channel_id && v.channel_id !== S.vc.channel_id) playUiSound("ayril");
});
listen("msg-create", (e) => { if (cfg.sendSound && e.payload.author?.id === S.me?.id) playUiSound("gonder"); });

/* ================================================================== */
/* Gece/gündüz tema zamanlaması                                        */
/* ================================================================== */
const minutesOf = (s) => { const [a, b] = String(s || "0:0").split(":").map(Number); return (a || 0) * 60 + (b || 0); };
function scheduledTheme(now = new Date()) {
  const s = cfg.schedule; if (!s?.on) return null;
  const m = now.getHours() * 60 + now.getMinutes(), f = minutesOf(s.from), t = minutesOf(s.to);
  const day = f <= t ? m >= f && m < t : m >= f || m < t;
  return day ? s.day : s.night;
}
function scheduleTick() { const want = scheduledTheme(); if (want && cfg.theme !== want) { cfg.theme = want; saveCfg(); applyCfg(); } }
setInterval(scheduleTick, 60000);

function studioMore(body, apply) {
  const s1 = h("div", "st-sec", `<div class="pe-lbl">Discord koleksiyonları</div>`);
  const cl = h("label", "st-tg", `<input type="checkbox" ${cfg.collectibles ? "checked" : ""}> Avatar süslerini, sunucu etiketlerini ve isim plakalarını göster`);
  cl.querySelector("input").onchange = (e) => { cfg.collectibles = e.target.checked; saveCfg(); renderMembers(); renderSidebar(); renderMe(); if (S.channel) openChannel(S.channel); };
  s1.append(cl); body.append(s1);

  const s2 = h("div", "st-sec", `<div class="pe-lbl">Ses teması</div>`);
  const sw = h("div", "deco-opts");
  for (const [k, label] of SOUND_PACKS) {
    const b = h("button", "fx-btn" + ((cfg.soundPack || "") === k ? " sel" : ""), label);
    b.onclick = () => { cfg.soundPack = k; saveCfg(); playUiSound("bildirim", k); sw.querySelectorAll(".sel").forEach((x) => x.classList.remove("sel")); b.classList.add("sel"); };
    sw.append(b);
  }
  s2.append(sw);
  const vr = h("label", "st-slider", "<span>Ses düzeyi</span>"); const vi = h("input"); vi.type = "range"; vi.min = 0; vi.max = 1; vi.step = 0.05; vi.value = cfg.soundVol;
  vi.onchange = () => { cfg.soundVol = +vi.value; saveCfg(); playUiSound("bildirim"); }; vr.append(vi); s2.append(vr);
  const ss = h("label", "st-tg", `<input type="checkbox" ${cfg.sendSound ? "checked" : ""}> Mesaj gönderince de ses çal`);
  ss.querySelector("input").onchange = (e) => { cfg.sendSound = e.target.checked; saveCfg(); };
  s2.append(ss, h("small", "muted", "Bildirimlerde ve bulunduğun ses kanalına biri girip çıktığında çalar."));
  body.append(s2);

  const s3 = h("div", "st-sec", `<div class="pe-lbl">Gece / gündüz teması</div>`);
  const sc = cfg.schedule;
  const on = h("label", "st-tg", `<input type="checkbox" ${sc.on ? "checked" : ""}> Temayı saate göre otomatik değiştir`);
  const opts = THEMES.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join("");
  const row = h("div", "st-sched", `<label>☀️ <select class="inp" data-k="day">${opts}</select></label><label>🌙 <select class="inp" data-k="night">${opts}</select></label>
    <label>Gündüz başlar <input class="inp" type="time" data-k="from"></label><label>Gece başlar <input class="inp" type="time" data-k="to"></label>`);
  for (const el of row.querySelectorAll("[data-k]")) { el.value = sc[el.dataset.k]; el.onchange = () => { cfg.schedule = { ...cfg.schedule, [el.dataset.k]: el.value }; saveCfg(); scheduleTick(); }; }
  on.querySelector("input").onchange = (e) => { cfg.schedule = { ...cfg.schedule, on: e.target.checked }; saveCfg(); scheduleTick(); };
  s3.append(on, row); body.append(s3);
}

/* ================================================================== */
/* Hareketli avatarlar ve sunucu simgeleri (üzerine gelince oynar)     */
/* ================================================================== */
const ANIM_RE = /\/(avatars|icons|guilds\/\d+\/users\/\d+\/avatars)\/(\d+\/)?a_[0-9a-f]+\.webp/;
const animSrc = (src) => src.replace(/(\/a_[0-9a-f]+)\.webp(\?[^#]*)?/, (_, p, q) => `${p}.webp${q ? q + "&" : "?"}animated=true`);
function playAnims(root, on) {
  for (const img of root.querySelectorAll("img:not(.av-deco)")) {
    if (on) { if (!img.dataset.still && ANIM_RE.test(img.src)) { img.dataset.still = img.src; img.src = animSrc(img.src); } }
    else if (img.dataset.still) { img.src = img.dataset.still; delete img.dataset.still; }
  }
}
const ANIM_HOST = ".msg, .m-row, .rail-btn, .vuser, .ch.dm, .me-av, .reply-line";
let animHost = null;
document.addEventListener("mouseover", (e) => {
  if (cfg.noAnim) return;
  const host = e.target.closest?.(ANIM_HOST);
  if (host === animHost) return;
  if (animHost) playAnims(animHost, false);
  animHost = host; if (host) playAnims(host, true);
}, { passive: true });

/* ================================================================== */
/* Discord profil efektleri, görünen ad stilleri, Shion rozeti         */
/* ================================================================== */
let effectsP = null;
function effectConfigs() {
  effectsP ||= invoke("profile_effects").then((r) => new Map((r?.profile_effect_configs || []).map((c) => [String(c.id), c]))).catch(() => { effectsP = null; return new Map(); });
  return effectsP;
}
/** Efekt katmanlarını kartın üstüne yerleştirir (Discord koordinatları ~450px genişliğe göre). */
async function addProfileEffect(pc, prof) {
  const pe = prof?.user_profile?.profile_effect;
  if (!cfg.collectibles || !pe?.id || (pe.expires_at && new Date(pe.expires_at) < new Date())) return false;
  const conf = (await effectConfigs()).get(String(pe.id)); if (!conf?.effects?.length) return false;
  pc.querySelector(".pfx")?.remove();
  const box = h("div", "pfx"); box.title = conf.title || conf.accessibilityLabel || "";
  const k = (pc.offsetWidth || 300) / 450;
  for (const ef of conf.effects) {
    if (!/^https:\/\/cdn\.discordapp\.com\//.test(ef.src || "")) continue;
    const img = h("img"); img.alt = ""; img.src = cfg.noAnim && conf.reducedMotionSrc ? conf.reducedMotionSrc : ef.src;
    Object.assign(img.style, { left: (ef.position?.x || 0) * k + "px", top: (ef.position?.y || 0) * k + "px", width: (ef.width || 450) * k + "px", zIndex: ef.zIndex || 1 });
    box.append(img);
  }
  pc.append(box); pc.classList.add("has-pfx");
  return true;
}
/** Discord "görünen ad stili" renkleri → tek renk ya da gradyan (yazı tipi/efekt kimlikleri belgelenmediği için yalnız renk). */
function nameStyleCss(u) {
  const s = cfg.collectibles && u?.display_name_styles; if (!Array.isArray(s?.colors) || !s.colors.length) return "";
  const cols = s.colors.slice(0, 4).map(intHex);
  return cols.length > 1
    ? `background:linear-gradient(90deg,${cols.join(",")});-webkit-background-clip:text;background-clip:text;color:transparent;`
    : `color:${cols[0]};`;
}
function styleName(el, u) { const css = el && nameStyleCss(u); if (css && !el.style.cssText.includes("background-clip")) { el.style.cssText += css; el.classList.add("styled-name"); } }
{
  const base = vcPost;
  vcPost = function (el, m) { base(el, m); if (!el.classList.contains("grouped") && !decoOf(m.author?.id)?.name) styleName(el.querySelector(".head .author"), m.author); };
}
{
  const base = renderMembers;
  renderMembers = function () {
    base();
    for (const it of S.members.items) {
      const u = it?.member?.user; if (!u?.display_name_styles || decoOf(u.id)?.name) continue;
      styleName(document.querySelector(`#members .m-row[data-pop="${u.id}"] .m-name b`), u);
    }
  };
}
function visualProfileMore(pc, u, prof) {
  const av = pc.querySelector(".pc-av img"); if (av && ANIM_RE.test(av.src) && !cfg.noAnim) av.src = animSrc(av.src);
  const pu = { ...u, ...(prof?.user || {}) };
  addAvDeco(av, pu, true);
  pc.querySelector(".pc-user")?.insertAdjacentHTML("beforeend", clanHtml(pu));
  if (!decoOf(u.id)?.name) styleName(pc.querySelector(".pc-name"), pu);
  const shion = u.id === S.me?.id || DECOS.has(u.id);
  if (shion && !pc.querySelector(".shion-badge")) pc.querySelector(".pc-name")?.insertAdjacentHTML("afterend", `<span class="shion-badge" title="Shion kullanıcısı">✨ Shion</span>`);
  addProfileEffect(pc, prof);
}

document.addEventListener("keydown", (e) => { if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "t" && !$("#app").classList.contains("hidden")) { e.preventDefault(); openStudio(); } });

/* ================================================================== */
/* Yenilikler penceresi (her sürümde bir kez)                          */
/* ================================================================== */
const SHION_VERSION = "0.3.0";
const WHATS_NEW = [
  ["🎨", "Görünüm stüdyosu", "Ctrl+Shift+T — hazır görünümler, özel tema, cam, parlama, avatar şekilleri", () => openStudio()],
  ["🌌", "Hareketli arka planlar", "Yıldız alanı, kar, sakura, ateş böcekleri, Matrix, aurora, neon ızgara…", () => openStudio()],
  ["✨", "Profil süslemeleri", "Avatar çerçevesi, isim efekti, kart arka planı — diğer Shion kullanıcıları da görür", () => openDecoEditor()],
  ["🖼", "Duvar kağıdı ve mesaj stilleri", "Kendi resmin, baloncuk/kart mesajlar, yazı tipi, resimden otomatik tema", () => openStudio()],
  ["💎", "Discord koleksiyonları", "Avatar süsleri, sunucu etiketleri, isim plakaları, profil efektleri, hareketli avatarlar", null],
  ["🎉", "Mesaj efektleri ve ses temaları", "Konfeti, kalpler, havai fişek; bildirim sesleri; gece/gündüz teması", () => openStudio()],
  ["📥", "Discord'dan eksikler", "Bahsetmeler kutusu (Ctrl+I), iletme, okunmadı işaretleme, soundboard, etkinlikler, notlar", null],
  ["🧩", "Vencord tarzı eklentiler", "Kod renklendirme, mesaj bağlantı önizlemesi, sabit DM'ler, özel durum (RPC), emoji kopyalama…", null],
  ["🔒", "Discord güncellemesine uyum", "\"Bilinmeyen\" kişiler ve ___hidden___ kanal adları düzeltildi", null],
];
function showWhatsNew() {
  const root = h("div", "whats-new");
  for (const [ico, title, desc, fn] of WHATS_NEW) {
    const r = h(fn ? "button" : "div", "wn-item", `<span class="wn-ico">${ico}</span><span><b>${esc(title)}</b><small class="muted">${esc(desc)}</small></span>`);
    if (fn) r.onclick = () => { closeModal(); fn(); };
    root.append(r);
  }
  const ok = h("button", "btn primary", "Harika!"); ok.onclick = closeModal;
  const act = h("div", "pe-actions"); act.append(ok); root.append(act);
  openModal(`Shion ${SHION_VERSION} — Yenilikler ✨`, root);
  lsSet("shion.seenVersion", SHION_VERSION);
  setTimeout(() => burstFx("konfeti"), 250);
}
listen("gw-ready", () => { if (lsGet("shion.seenVersion", "") !== SHION_VERSION) setTimeout(() => { if ($("#modal").classList.contains("hidden")) showWhatsNew(); }, 1500); });

scheduleTick();
applyVisual();
