"use strict";
/* Shion — kamera, ekran paylaşımı (Go Live) ve yayın izleme.
   Yakalama + H264 kodlama/çözme WebView2'nin WebCodecs'i ile (donanım hızlandırmalı);
   Rust tarafı DAVE şifreleme, RTP ve Discord sinyalleşmesini yapar. */

const V = {
  tiles: new Map(),      // "cam:<uid>" | "live:<uid>" | "self-cam" | "self-live" -> tile
  cam: null,             // { stream, sender }
  screen: null,          // { stream, sender, key }
  watching: new Set(),   // izlenen yayın anahtarları
  focus: null,
};
const CAM = { w: 1280, h: 720, fps: 30, bitrate: 2_500_000 };
const SCR = { w: 1920, h: 1080, fps: 30, bitrate: 6_000_000 };
const SCR_PRESETS = { "720": [1280, 720, 30, 3_500_000], "1080": [1920, 1080, 30, 6_000_000], "1080-60": [1920, 1080, 60, 8_000_000] };
function applyScreenPreset() { const p = SCR_PRESETS[cfg.screenQuality] || SCR_PRESETS["1080"]; [SCR.w, SCR.h, SCR.fps, SCR.bitrate] = p; }
applyScreenPreset();

/* ------------------------------------------------------------------ */
/* Kodlayıcı: MediaStreamTrack -> H264 Annex-B -> Rust                 */
/* ------------------------------------------------------------------ */
const even = (n) => Math.max(2, n & ~1);

async function pickCodec(w, h, fps, bitrate) {
  if (!("VideoEncoder" in window)) throw new Error("Bu sistemde WebCodecs yok");
  // Kısıtlı baseline: Discord istemcilerinin hepsi çözebilir
  // 4.2 -> 1080p60; 5.1 -> 1440p/4K (ölçekleme başarısız olursa)
  for (const codec of ["avc1.42E02A", "avc1.42E028", "avc1.42E01F", "avc1.42E033", "avc1.640033"]) {
    for (const hw of ["prefer-hardware", "no-preference"]) {
      const c = { codec, width: w, height: h, bitrate, framerate: fps, latencyMode: "realtime", hardwareAcceleration: hw, avc: { format: "annexb" } };
      try { if ((await VideoEncoder.isConfigSupported(c)).supported) return c; } catch {}
    }
  }
  throw new Error("H264 kodlayıcı desteklenmiyor");
}

class Sender {
  constructor(target, track, opts, onInfo) {
    this.target = target; this.track = track; this.opts = opts; this.onInfo = onInfo;
    this.needKey = true; this.n = 0; this.last = 0; this.stopped = false; this.size = null; this.sent = 0; this.lastKey = 0;
  }
  /** İzleyicilerden gelen anahtar kare isteği (PLI) — saniyede en fazla bir kez. */
  requestKey() { if (performance.now() - this.lastKey > 1000) this.needKey = true; }
  /** Büyük ekranları (1440p, 4K, ultra geniş) en-boy oranını koruyarak sınıra sığdır. */
  fit(fw, fh) {
    const s = Math.min(1, (this.opts.maxW || this.opts.w) / fw, (this.opts.maxH || this.opts.h) / fh);
    return [even(Math.round(fw * s)), even(Math.round(fh * s))];
  }
  scaled(frame, w, h) {
    if (!this.cv || this.cv.width !== w || this.cv.height !== h) { this.cv = new OffscreenCanvas(w, h); this.cx = this.cv.getContext("2d", { alpha: false, desynchronized: true }); }
    this.cx.drawImage(frame, 0, 0, w, h);
    return new VideoFrame(this.cv, { timestamp: frame.timestamp });
  }
  async configure(w, h) {
    this.size = [w, h];
    const cfg = await pickCodec(w, h, this.opts.fps, this.opts.bitrate);
    if (this.enc && this.enc.state !== "closed") { try { await this.enc.flush(); } catch {} this.enc.close(); }
    this.enc = new VideoEncoder({
      output: (chunk) => {
        const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b);
        this.sent++;
        invoke("video_frame", b, { headers: { "x-target": this.target, "x-key": chunk.type === "key" ? "1" : "0" } }).catch(() => {});
      },
      error: (e) => { console.warn("kodlayıcı:", e); this.needKey = true; this.size = null; },
    });
    this.enc.configure(cfg);
    this.needKey = true;
    this.onInfo?.(w, h, this.opts.fps);
  }
  async start() {
    if (!("MediaStreamTrackProcessor" in window)) throw new Error("Bu sistemde MediaStreamTrackProcessor yok");
    this.reader = new MediaStreamTrackProcessor({ track: this.track }).readable.getReader();
    const gap = 1000 / this.opts.fps;
    (async () => {
      while (!this.stopped) {
        const { value: frame, done } = await this.reader.read().catch(() => ({ done: true }));
        if (done || !frame) break;
        try {
          const now = performance.now();
          if (now - this.last < gap * 0.85 || (this.enc && this.enc.encodeQueueSize > 2)) continue;
          this.last = now;
          const [w, h] = this.fit(frame.displayWidth, frame.displayHeight);
          if (!this.size || this.size[0] !== w || this.size[1] !== h) await this.configure(w, h);
          if (this.enc.state !== "configured") continue;
          const big = w < even(frame.displayWidth) || h < even(frame.displayHeight);
          const f = big ? this.scaled(frame, w, h) : w === frame.displayWidth && h === frame.displayHeight ? frame : new VideoFrame(frame, { visibleRect: { x: 0, y: 0, width: w, height: h } });
          const key = this.needKey || this.n % (this.opts.fps * 4) === 0;
          if (key) this.lastKey = now;
          this.needKey = false; this.n++;
          this.enc.encode(f, { keyFrame: key });
          if (f !== frame) f.close();
        } catch (e) { console.warn("kare:", e); }
        finally { frame.close(); }
      }
    })();
  }
  stop() {
    this.stopped = true;
    try { this.reader?.cancel(); } catch {}
    try { if (this.enc?.state !== "closed") this.enc?.close(); } catch {}
  }
}
listen("video-keyframe", (e) => {
  const k = e.payload.key;
  if (k === "camera" && V.cam) V.cam.sender.requestKey();
  if (V.screen && k === V.screen.key) V.screen.sender.requestKey();
});

/* ------------------------------------------------------------------ */
/* Çözücü: Rust -> H264 -> canvas                                      */
/* ------------------------------------------------------------------ */
function userById(uid) {
  if (uid === S.me?.id) return S.me;
  return S.vstates.get(uid)?.user || S.msgs.find((m) => m.author?.id === uid)?.author || S.friends.find((f) => f.id === uid)?.user || { id: uid, username: "…" };
}

function onVideoFrame(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf instanceof ArrayBuffer ? buf : buf);
  if (u8.length < 15) return;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const kind = u8[0];
  const uid = dv.getBigUint64(1).toString();
  const key = u8[13] === 1;
  const id = (kind === 1 ? "live:" : "cam:") + uid;
  if (kind === 1 && !V.watching.size) return;
  const t = V.tiles.get(id) || remoteTile(id, uid, kind === 1);
  t.lastFrame = Date.now();
  if (!t.dec || t.dec.state === "closed") {
    if (!("VideoDecoder" in window)) return;
    t.dec = new VideoDecoder({
      output: (frame) => {
        const c = t.canvas;
        if (c.width !== frame.displayWidth || c.height !== frame.displayHeight) { c.width = frame.displayWidth; c.height = frame.displayHeight; }
        c.getContext("2d").drawImage(frame, 0, 0);
        frame.close();
        t.el.classList.remove("waiting");
        t.frames = (t.frames || 0) + 1;
      },
      error: (e) => { console.warn("çözücü:", e); t.ready = false; },
    });
    t.ready = false;
  }
  if (!t.ready) {
    if (!key) return;
    try { t.dec.configure({ codec: "avc1.64002A", optimizeForLatency: true, hardwareAcceleration: "no-preference" }); t.ready = true; }
    catch (e) { console.warn(e); return; }
  }
  if (t.dec.decodeQueueSize > 6 && !key) return; // geride kaldık: anahtar kareye kadar atla
  try { t.dec.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: Math.round(performance.now() * 1000), data: u8.subarray(14) })); }
  catch (e) { t.ready = false; }
}

if (window.__TAURI__.core.Channel) {
  const ch = new window.__TAURI__.core.Channel();
  ch.onmessage = onVideoFrame;
  invoke("video_subscribe", { channel: ch }).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Izgara                                                              */
/* ------------------------------------------------------------------ */
function grid() {
  let g = $("#video-grid");
  if (!g) { g = h("div", ""); g.id = "video-grid"; $("#call-bar").after(g); }
  return g;
}
function layoutGrid() {
  const g = grid();
  g.classList.toggle("hidden", !V.tiles.size);
  g.dataset.n = Math.min(V.tiles.size, 4);
  g.classList.toggle("focused", !!V.focus && V.tiles.has(V.focus));
  for (const [id, t] of V.tiles) t.el.classList.toggle("focus", V.focus === id);
}
function makeTile(id, label, live, media) {
  const el = h("div", "vtile waiting");
  el.dataset.id = id;
  el.append(media);
  const cap = h("div", "vcap", `${live ? '<span class="live">CANLI</span>' : ""}<span>${esc(label)}</span>`);
  const tools = h("div", "vtools");
  const fs = h("button", null, "⛶"); fs.title = "Odakla / tam ekran";
  fs.onclick = (e) => { e.stopPropagation(); V.focus = V.focus === id ? null : id; layoutGrid(); };
  tools.append(fs);
  el.ondblclick = () => { el.requestFullscreen?.().catch(() => {}); };
  el.append(cap, tools);
  grid().append(el);
  const t = { id, el, tools };
  V.tiles.set(id, t);
  layoutGrid();
  return t;
}
function remoteTile(id, uid, live) {
  const canvas = h("canvas");
  const t = makeTile(id, dname(userById(uid)), live, canvas);
  t.canvas = canvas; t.uid = uid;
  if (live) {
    const x = h("button", null, "✕"); x.title = "İzlemeyi bırak";
    x.onclick = (e) => { e.stopPropagation(); stopWatching(uid); };
    t.tools.append(x);
  }
  return t;
}
function selfTile(id, stream, label, mirror) {
  removeTile(id);
  const v = h("video"); v.muted = true; v.autoplay = true; v.playsInline = true; v.srcObject = stream;
  if (mirror) v.classList.add("mirror");
  const t = makeTile(id, label, id === "self-live", v);
  t.el.classList.remove("waiting"); t.el.classList.add("self");
  return t;
}
function removeTile(id) {
  const t = V.tiles.get(id); if (!t) return;
  try { if (t.dec?.state !== "closed") t.dec?.close(); } catch {}
  t.el.remove(); V.tiles.delete(id);
  if (V.focus === id) V.focus = null;
  layoutGrid();
}
// Kare gelmeyen uzak döşemeleri temizle
setInterval(() => {
  for (const [id, t] of V.tiles) if (t.uid && t.lastFrame && Date.now() - t.lastFrame > 15000) removeTile(id);
}, 5000);

/* ------------------------------------------------------------------ */
/* Kamera                                                              */
/* ------------------------------------------------------------------ */
const inVoice = () => S.vc.channel_id && S.vc.state === "connected";

async function toggleCamera() {
  if (V.cam) return stopCamera();
  if (!inVoice()) return toast("Önce bir ses kanalına bağlan");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: CAM.w }, height: { ideal: CAM.h }, frameRate: { ideal: CAM.fps, max: CAM.fps }, ...(cfg.camDevice ? { deviceId: { exact: cfg.camDevice } } : {}) }, audio: false });
  } catch (e) { return toast("Kameraya erişilemedi: " + (e.message || e)); }
  const track = stream.getVideoTracks()[0];
  const sender = new Sender("camera", track, CAM, (w, h, fps) => invoke("set_video", { on: true, width: w, height: h, fps }).catch((e) => { toast("Kamera: " + e); stopCamera(); }));
  V.cam = { stream, sender };
  selfTile("self-cam", stream, dname(S.me) + " (sen)", true);
  try { await sender.start(); } catch (e) { toast("Kamera: " + e.message); return stopCamera(); }
  track.onended = stopCamera;
  renderVoicePanel();
}
function stopCamera(silent) {
  if (!V.cam) return;
  V.cam.sender.stop(); V.cam.stream.getTracks().forEach((t) => t.stop());
  V.cam = null; removeTile("self-cam");
  if (silent !== true) invoke("set_video", { on: false, width: 0, height: 0, fps: 0 }).catch(() => {});
  renderVoicePanel();
}

/* ------------------------------------------------------------------ */
/* Ekran paylaşımı (Go Live)                                           */
/* ------------------------------------------------------------------ */
async function toggleScreen() {
  if (V.screen) return stopScreen();
  if (!inVoice()) return toast("Önce bir ses kanalına bağlan");
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: SCR.w }, height: { max: SCR.h }, frameRate: { ideal: SCR.fps, max: SCR.fps } }, audio: false }); // ses Rust'ta yakalanır (Shion hariç sistem sesi)
  } catch (e) { if (e?.name !== "NotAllowedError") toast("Ekran yakalanamadı: " + (e.message || e)); return; }
  const track = stream.getVideoTracks()[0];
  try { track.contentHint = "detail"; } catch {}
  let key;
  try { key = await invoke("start_stream"); }
  catch (e) { stream.getTracks().forEach((t) => t.stop()); return toast("Yayın başlatılamadı: " + e); }
  const sender = new Sender(key, track, SCR, (w, h, fps) => invoke("stream_active", { key, on: true, width: w, height: h, fps }).catch(() => {}));
  V.screen = { stream, sender, key, started: false };
  selfTile("self-live", stream, "Yayındasın", false);
  track.onended = stopScreen;
  renderVoicePanel();
  toast("📡 Yayın sunucusuna bağlanılıyor…");
}
/* Yayın sesi: Rust, Windows'un "bu uygulama hariç" yakalamasıyla sistem sesini alır —
   böylece sesli sohbetteki kişilerin sesi yayına yankı olarak gitmez. */
async function startStreamAudio(sc) {
  if (cfg.streamAudio === false) return "kapalı";
  try { await invoke("system_audio", { key: sc.key, on: true }); sc.audio = true; return "sesli"; }
  catch (e) { console.warn("yayın sesi:", e); return "ses açılamadı"; }
}
async function startScreenSender() {
  const sc = V.screen; if (!sc || sc.started) return;
  sc.started = true;
  try { await sc.sender.start(); const a = await startStreamAudio(sc); toast(a === "sesli" ? "🔴 Yayındasın (sesli)" : `🔴 Yayındasın (ses: ${a})`); }
  catch (e) { toast("Yayın: " + e.message); stopScreen(); }
}
function stopScreen(silent) {
  const sc = V.screen; if (!sc) return;
  sc.sender.stop(); sc.stream.getTracks().forEach((t) => t.stop());
  if (sc.audio) invoke("system_audio", { key: sc.key, on: false }).catch(() => {});
  V.screen = null; removeTile("self-live");
  if (silent !== true) invoke("stop_stream", { key: sc.key }).catch(() => {});
  renderVoicePanel();
}

/* ------------------------------------------------------------------ */
/* Yayın izleme                                                        */
/* ------------------------------------------------------------------ */
function streamKeyFor(v) {
  return v.guild_id ? `guild:${v.guild_id}:${v.channel_id}:${v.user_id}` : `call:${v.channel_id}:${v.user_id}`;
}
async function watchStream(uid) {
  const v = S.vstates.get(uid);
  if (!v?.self_stream) return toast("Bu kişi şu an yayında değil");
  if (S.vc.channel_id !== v.channel_id || S.vc.state !== "connected") {
    V.pendingWatch = uid; // bağlanınca otomatik izle
    await joinVoice(v.guild_id || null, v.channel_id);
    toast("📡 Kanala bağlanılıyor, yayın birazdan açılacak…");
    return;
  }
  const key = streamKeyFor(v);
  if (V.watching.has(key)) { V.focus = "live:" + uid; layoutGrid(); return; }
  V.watching.add(key);
  const t = V.tiles.get("live:" + uid) || remoteTile("live:" + uid, uid, true);
  t.key = key;
  try { await invoke("watch_stream", { key }); }
  catch (e) { V.watching.delete(key); removeTile("live:" + uid); toast("İzlenemedi: " + e); }
}
function stopWatching(uid) {
  for (const key of V.watching) if (key.endsWith(":" + uid)) { V.watching.delete(key); invoke("stop_stream", { key }).catch(() => {}); }
  removeTile("live:" + uid);
}
// Ses listesindeki CANLI rozetine tıklayınca izle (profil kartından önce yakala)
document.addEventListener("click", (e) => {
  const live = e.target.closest(".vuser .live");
  if (!live) return;
  e.stopPropagation(); e.preventDefault();
  const uid = live.closest(".vuser").dataset.uid;
  if (uid === S.me?.id) return;
  watchStream(uid);
}, true);

listen("stream-status", (e) => {
  const { key, state, sending, detail } = e.payload;
  if (V.screen && key === V.screen.key) {
    if (state === "connected") startScreenSender();
    else if (state === "error") { toast("Yayın hatası: " + detail); stopScreen(); }
    else if (state === "ended" || state === "disconnected") stopScreen(true);
    return;
  }
  if (!sending && V.watching.has(key)) {
    const uid = key.split(":").pop();
    if (state === "error") toast("Yayın: " + detail);
    if (state === "ended" || state === "disconnected" || state === "error") {
      V.watching.delete(key); removeTile("live:" + uid);
      if (state === "ended") toast("Yayın sona erdi");
    }
  }
});
listen("video-end", (e) => removeTile((e.payload.kind === 1 ? "live:" : "cam:") + e.payload.user_id));
listen("voice-status", (e) => {
  if (e.payload.state === "connected" && V.pendingWatch) {
    const uid = V.pendingWatch; V.pendingWatch = null;
    setTimeout(() => watchStream(uid), 400);
  }
  if (e.payload.state === "disconnected" || e.payload.state === "error") {
    V.pendingWatch = null;
    stopCamera(true); stopScreen(true);
    V.watching.clear();
    for (const id of [...V.tiles.keys()]) removeTile(id);
  }
});
listen("voice-state", (e) => {
  const v = e.payload;
  // Yayını kapatan ya da kanaldan çıkan kişinin döşemesini kaldır
  if (!v.self_stream) for (const key of [...V.watching]) if (key.endsWith(":" + v.user_id)) { V.watching.delete(key); removeTile("live:" + v.user_id); }
  if (!v.self_video || v.channel_id !== S.vc.channel_id) removeTile("cam:" + v.user_id);
});

/* Ses paneline kamera / ekran düğmeleri */
const VSVG = {
  cam: '<svg viewBox="0 0 24 24"><path d="M4 6h11a2 2 0 0 1 2 2v1.5l4-2.5v10l-4-2.5V16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="currentColor"/></svg>',
  screen: '<svg viewBox="0 0 24 24"><path d="M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm9 3-4 4h3v3h2v-3h3z" fill="currentColor"/></svg>',
};
function videoButtons(panel) {
  if (S.vc.state !== "connected") return;
  const row = h("div", "vp-actions");
  const cam = h("button", "vp-btn" + (V.cam ? " on" : ""), VSVG.cam + `<span>${V.cam ? "Kamerayı kapat" : "Kamera"}</span>`);
  cam.onclick = toggleCamera;
  const scr = h("button", "vp-btn" + (V.screen ? " on live" : ""), VSVG.screen + `<span>${V.screen ? "Yayını bitir" : "Ekran"}</span>`);
  scr.onclick = toggleScreen;
  row.append(cam, scr);
  panel.append(row);
}
