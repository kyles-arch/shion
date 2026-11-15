"use strict";
/* Shion — davetler, slash komutları, anketler, sesli mesajlar, moderasyon. */

/* ------------------------------------------------------------------ */
/* Ortak: küçük onay penceresi                                         */
/* ------------------------------------------------------------------ */
function askModal(title, html, okLabel, { danger = false, reason = false, extra = null } = {}) {
  return new Promise((resolve) => {
    const box = h("div", "new-post", html ? `<p>${html}</p>` : "");
    if (extra) box.append(extra);
    let rs = null;
    if (reason) { rs = h("input", "inp"); rs.placeholder = "Neden (denetim kaydına yazılır, isteğe bağlı)"; rs.maxLength = 400; box.append(rs); }
    const ok = h("button", "btn " + (danger ? "danger" : "primary"), esc(okLabel));
    ok.onclick = () => { closeModal(); resolve({ ok: true, reason: rs?.value || null }); };
    box.append(ok);
    openModal(title, box);
    const obs = new MutationObserver(() => { if ($("#modal").classList.contains("hidden")) { obs.disconnect(); resolve({ ok: false }); } });
    obs.observe($("#modal"), { attributes: true, attributeFilter: ["class"] });
  });
}

/* ------------------------------------------------------------------ */
/* Davetler                                                            */
/* ------------------------------------------------------------------ */
const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]{2,32})/gi;
const inviteCache = new Map();
const getInvite = (code) => { if (!inviteCache.has(code)) inviteCache.set(code, invoke("invite_info", { code }).catch((e) => ({ _err: String(e) }))); return inviteCache.get(code); };

async function joinByCode(code, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Katılınıyor…"; }
  try {
    await invoke("join_invite", { code });
    toast("✅ Sunucuya katıldın");
    if (btn) btn.textContent = "Katıldın ✓";
    return true;
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Katıl"; }
    if (String(e).includes("captcha")) {
      const r = await askModal("Doğrulama gerekiyor", "Discord bu katılım için insan doğrulaması (captcha) istiyor. Shion captcha çözemez — daveti tarayıcıda açıp oradan katılabilirsin; katılınca sunucu burada otomatik görünür.", "Tarayıcıda aç");
      if (r.ok) window.__TAURI__.opener.openUrl("https://discord.com/invite/" + code);
    } else toast("Katılamadın: " + e);
    return false;
  }
}

function inviteCards(m) {
  const codes = [...new Set([...(m.content || "").matchAll(INVITE_RE)].map((x) => x[1]))].slice(0, 3);
  return codes.map((code) => {
    const card = h("div", "inv-card", '<div class="inv-load">Davet yükleniyor…</div>');
    getInvite(code).then((inv) => {
      if (inv._err || !inv.guild) { card.innerHTML = `<div class="inv-bad">⚠ Geçersiz ya da süresi dolmuş davet</div>`; return; }
      const g = inv.guild;
      const icon = g.icon ? `<img src="${CDN}/icons/${g.id}/${g.icon}.webp?size=96">` : `<div class="inv-acr">${esc(guildAcr(g.name))}</div>`;
      const member = S.guilds.some((x) => x.id === g.id);
      card.innerHTML = `<small>SUNUCUYA DAVET EDİLDİN</small><div class="inv-row">${icon}<div class="inv-info"><b>${esc(g.name)}</b>
        <span><i class="dot on"></i>${(inv.approximate_presence_count ?? 0).toLocaleString("tr-TR")} çevrimiçi <i class="dot"></i>${(inv.approximate_member_count ?? 0).toLocaleString("tr-TR")} üye</span></div></div>`;
      const b = h("button", "btn " + (member ? "" : "ok"), member ? "Sunucuya git" : "Katıl");
      b.onclick = () => member ? (openGuild(g.id)) : joinByCode(code, b);
      card.querySelector(".inv-row").append(b);
    });
    return card;
  });
}

function openJoinModal() {
  const box = h("div", "new-post", `<p class="muted">Davet linkini ya da kodunu yapıştır (ör. discord.gg/shion)</p>`);
  const inp = h("input", "inp"); inp.placeholder = "https://discord.gg/…"; inp.spellcheck = false;
  const prev = h("div");
  const go = h("button", "btn primary", "Daveti göster");
  const show = async () => {
    const code = (inp.value.match(/([\w-]{2,32})\/?$/) || [])[1];
    if (!code) return;
    prev.textContent = "";
    prev.append(...inviteCards({ content: "discord.gg/" + code }));
  };
  go.onclick = show; inp.onkeydown = (e) => { if (e.key === "Enter") show(); };
  box.append(inp, go, prev);
  openModal("Sunucuya katıl", box); inp.focus();
}
{
  const add = h("button", "rail-btn add-guild", "＋"); add.title = "Sunucuya katıl";
  add.onclick = openJoinModal;
  $("#guild-list").after(add);
}

async function makeInvite(g) {
  const pref = S.channel?.guild_id === g.id && S.channel.invite ? S.channel : g.channels.find((c) => c.invite && !c.hidden && (c.type === 0 || c.type === 5));
  if (!pref) return toast("Bu sunucuda davet oluşturma iznin yok");
  try {
    const inv = await invoke("create_invite", { channelId: pref.id, maxAge: 604800, maxUses: 0 });
    const url = "https://discord.gg/" + inv.code;
    const box = h("div", "new-post", `<p class="muted">#${esc(pref.name)} kanalına davet · 7 gün geçerli</p>`);
    const inp = h("input", "inp"); inp.value = url; inp.readOnly = true;
    const cp = h("button", "btn primary", "Kopyala");
    cp.onclick = () => { navigator.clipboard.writeText(url); cp.textContent = "Kopyalandı ✓"; };
    box.append(inp, cp); openModal("Arkadaşlarını davet et", box); inp.select();
  } catch (e) { toast("Davet oluşturulamadı: " + e); }
}
async function leaveGuild(g) {
  if (g.owner) return toast("Sahibi olduğun sunucudan ayrılamazsın");
  const r = await askModal("Sunucudan ayrıl", `<b>${esc(g.name)}</b> sunucusundan ayrılmak istediğine emin misin? Davet olmadan geri dönemezsin.`, "Ayrıl", { danger: true });
  if (!r.ok) return;
  try { await invoke("leave_guild", { guildId: g.id }); toast("Sunucudan ayrıldın"); }
  catch (e) { toast("Ayrılamadın: " + e); }
}
function guildExtraItems(g) {
  return ["-", { label: "✉️ Davet oluştur", fn: () => makeInvite(g) }, { label: "🚪 Sunucudan ayrıl", danger: true, fn: () => leaveGuild(g) }];
}

/* ------------------------------------------------------------------ */
/* Anketler                                                            */
/* ------------------------------------------------------------------ */
function renderPoll(m) {
  const p = m.poll;
  const counts = new Map((p.results?.answer_counts || []).map((c) => [c.id, c]));
  const total = [...counts.values()].reduce((a, c) => a + (c.count || 0), 0);
  const expired = p.results?.is_finalized || (p.expiry && new Date(p.expiry) < new Date());
  const voted = [...counts.values()].some((c) => c.me_voted);
  const box = h("div", "poll" + (expired ? " done" : ""));
  box.append(h("div", "poll-q", esc(p.question?.text || "Anket")));
  box.append(h("small", "muted", p.allow_multiselect ? "Birden fazla cevap seçebilirsin" : "Bir cevap seç"));
  const picked = new Set();
  const top = Math.max(0, ...[...counts.values()].map((c) => c.count || 0));
  for (const a of p.answers || []) {
    const c = counts.get(a.answer_id) || { count: 0 };
    const pct = total ? Math.round((c.count * 100) / total) : 0;
    const em = a.poll_media?.emoji;
    const row = h("button", "poll-a" + (c.me_voted ? " mine" : "") + (expired && c.count === top && top > 0 ? " win" : ""));
    row.innerHTML = `<span class="bar" style="width:${voted || expired ? pct : 0}%"></span><span class="txt">${em ? emojiHtml(em, 32) + " " : ""}${esc(a.poll_media?.text || "")}</span>${voted || expired ? `<span class="pct">${c.count} · %${pct}</span>` : ""}`;
    row.disabled = expired;
    row.onclick = async () => {
      if (voted) return;
      if (p.allow_multiselect) { picked.has(a.answer_id) ? picked.delete(a.answer_id) : picked.add(a.answer_id); row.classList.toggle("sel"); vote.disabled = !picked.size; return; }
      try { await invoke("poll_vote", { channelId: m.channel_id, messageId: m.id, answerIds: [a.answer_id] }); } catch (e) { toast("Oy verilemedi: " + e); }
    };
    box.append(row);
  }
  const foot = h("div", "poll-f");
  const left = p.expiry && !expired ? Math.max(0, new Date(p.expiry) - Date.now()) : 0;
  const leftTxt = left > 86400000 ? Math.round(left / 86400000) + " gün kaldı" : left > 3600000 ? Math.round(left / 3600000) + " saat kaldı" : left ? Math.max(1, Math.round(left / 60000)) + " dk kaldı" : "Anket bitti";
  foot.append(h("span", "muted", `${total} oy · ${leftTxt}`));
  const vote = h("button", "btn primary small", "Oy ver"); vote.disabled = true;
  vote.onclick = () => invoke("poll_vote", { channelId: m.channel_id, messageId: m.id, answerIds: [...picked] }).catch((e) => toast("Oy verilemedi: " + e));
  if (!expired && !voted && p.allow_multiselect) foot.append(vote);
  if (!expired && voted) { const b = h("button", "btn small", "Oyu kaldır"); b.onclick = () => invoke("poll_vote", { channelId: m.channel_id, messageId: m.id, answerIds: [] }).catch((e) => toast("" + e)); foot.append(b); }
  if (!expired && m.author?.id === S.me?.id) { const b = h("button", "btn small", "Anketi bitir"); b.onclick = () => invoke("end_poll", { channelId: m.channel_id, messageId: m.id }).catch((e) => toast("" + e)); foot.append(b); }
  box.append(foot);
  return box;
}

function openPollCreator() {
  if (!S.channel || $("#input").disabled) return;
  const box = h("div", "new-post poll-new");
  const q = h("input", "inp"); q.placeholder = "Soru"; q.maxLength = 300;
  const list = h("div", "poll-answers");
  const addAns = (v = "") => {
    if (list.children.length >= 10) return;
    const r = h("div", "pa-row"); const i = h("input", "inp"); i.placeholder = "Cevap " + (list.children.length + 1); i.maxLength = 55; i.value = v;
    const x = h("button", "btn small", "✕"); x.onclick = () => { if (list.children.length > 2) r.remove(); };
    r.append(i, x); list.append(r);
  };
  addAns(); addAns();
  const more = h("button", "btn small", "+ Cevap ekle"); more.onclick = () => addAns();
  const dur = h("select", "inp"); for (const [hrs, l] of [[1, "1 saat"], [4, "4 saat"], [8, "8 saat"], [24, "1 gün"], [72, "3 gün"], [168, "1 hafta"]]) { const o = h("option", null, l); o.value = hrs; o.selected = hrs === 24; dur.append(o); }
  const multi = h("label", "check", ""); const mc = h("input"); mc.type = "checkbox"; multi.append(mc, document.createTextNode(" Birden fazla cevap seçilebilsin"));
  const ok = h("button", "btn primary", "Anketi gönder");
  ok.onclick = async () => {
    const answers = [...list.querySelectorAll("input")].map((i) => i.value.trim()).filter(Boolean);
    if (!q.value.trim() || answers.length < 2) return toast("Soru ve en az 2 cevap gerekli");
    const poll = { question: { text: q.value.trim() }, answers: answers.map((text) => ({ poll_media: { text } })), duration: +dur.value, allow_multiselect: mc.checked, layout_type: 1 };
    closeModal();
    try { await invoke("send_message", { channelId: S.channel.id, content: "", replyTo: null, files: [], poll }); }
    catch (e) { toast("Anket gönderilemedi: " + e); }
  };
  const row = h("div", "pa-row"); row.append(h("span", "muted", "Süre"), dur);
  box.append(q, list, more, row, multi, ok);
  openModal("📊 Anket oluştur", box); q.focus();
}

/* ------------------------------------------------------------------ */
/* Sesli mesaj: kaydet + oynat                                         */
/* ------------------------------------------------------------------ */
const REC = { on: false };
async function toggleRecord() {
  if (REC.on) return finishRecord(true);
  if (!S.channel || $("#input").disabled) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } }); }
  catch (e) { return toast("Mikrofona erişilemedi: " + (e.message || e)); }
  const ctx = new AudioContext({ sampleRate: 48000 });
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  proc.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  src.connect(proc); proc.connect(ctx.destination);
  Object.assign(REC, { on: true, stream, ctx, proc, chunks, t0: Date.now(), channel: S.channel.id });
  const bar = h("div", "rec-bar", `<span class="rec-dot"></span><span class="rec-t">0:00</span><span class="muted">Kaydediliyor… göndermek için 🎤, iptal için ✕</span>`);
  const x = h("button", "btn small", "✕"); x.onclick = () => finishRecord(false);
  bar.append(x); $("#composer").prepend(bar); REC.bar = bar;
  $("#mic-btn").classList.add("rec");
  REC.timer = setInterval(() => {
    const s = Math.floor((Date.now() - REC.t0) / 1000);
    bar.querySelector(".rec-t").textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    if (s >= 600) finishRecord(true);
  }, 250);
}
async function finishRecord(sendIt) {
  if (!REC.on) return;
  REC.on = false; clearInterval(REC.timer);
  try { REC.proc.disconnect(); } catch {}
  REC.stream.getTracks().forEach((t) => t.stop());
  REC.ctx.close().catch(() => {});
  REC.bar?.remove(); $("#mic-btn").classList.remove("rec");
  if (!sendIt) return toast("Kayıt iptal edildi");
  const len = REC.chunks.reduce((a, c) => a + c.length, 0);
  if (len < 48000 / 2) return toast("Kayıt çok kısa");
  const pcm = new Float32Array(len); let o = 0;
  for (const c of REC.chunks) { pcm.set(c, o); o += c.length; }
  toast("🎤 Sesli mesaj gönderiliyor…");
  try { await invoke("voice_message", new Uint8Array(pcm.buffer), { headers: { "x-channel": REC.channel } }); }
  catch (e) { toast("Sesli mesaj gönderilemedi: " + e); }
}

let playingAudio = null;
function audioPlayer(a) {
  const box = h("div", "vmsg");
  const btn = h("button", "vm-play", "▶");
  const wave = h("div", "vm-wave");
  let bars = [];
  try { bars = [...atob(a.waveform || "")].map((c) => c.charCodeAt(0)); } catch {}
  if (!bars.length) bars = Array.from({ length: 40 }, (_, i) => 60 + 50 * Math.sin(i * 0.7));
  const step = Math.max(1, Math.floor(bars.length / 48));
  const shown = bars.filter((_, i) => i % step === 0).slice(0, 48);
  wave.innerHTML = shown.map((b) => `<i style="height:${Math.max(8, Math.round((b / 255) * 100))}%"></i>`).join("");
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const time = h("span", "vm-time", a.duration_secs ? fmt(a.duration_secs) : esc(a.filename || "ses"));
  const au = new Audio(); au.preload = "none"; au.src = a.url;
  const paint = () => {
    const p = au.duration ? au.currentTime / au.duration : 0;
    wave.querySelectorAll("i").forEach((el, i, all) => el.classList.toggle("on", i / all.length < p));
    time.textContent = fmt(au.paused && !au.currentTime ? (a.duration_secs || au.duration || 0) : au.currentTime);
  };
  au.ontimeupdate = paint;
  au.onended = () => { btn.textContent = "▶"; au.currentTime = 0; paint(); };
  btn.onclick = () => {
    if (au.paused) { if (playingAudio && playingAudio !== au) playingAudio.pause(); playingAudio = au; au.play().catch((e) => toast("Oynatılamadı: " + e.message)); btn.textContent = "⏸"; }
    else { au.pause(); btn.textContent = "▶"; }
  };
  au.onpause = () => { btn.textContent = "▶"; };
  wave.onclick = (e) => { if (au.duration) { au.currentTime = ((e.offsetX) / wave.clientWidth) * au.duration; paint(); } };
  box.append(btn, wave, time);
  return box;
}

/* ------------------------------------------------------------------ */
/* Slash komutları                                                     */
/* ------------------------------------------------------------------ */
const cmdCache = new Map();
const cmdResolved = new Map();
async function loadCommands() {
  const c = S.channel; if (!c) return [];
  const key = c.guild_id || c.id;
  if (!cmdCache.has(key)) {
    cmdCache.set(key, invoke("app_commands", { guildId: c.guild_id || null, channelId: c.id }).then((r) => {
      const apps = new Map((r?.applications || []).map((a) => [a.id, a]));
      const out = [];
      for (const cmd of r?.application_commands || []) {
        if (cmd.type && cmd.type !== 1) continue;
        const app = apps.get(cmd.application_id);
        const subs = (cmd.options || []).filter((o) => o.type === 1 || o.type === 2);
        if (!subs.length) { out.push({ path: [cmd.name], cmd, opts: cmd.options || [], desc: cmd.description, app }); continue; }
        for (const s of subs) {
          if (s.type === 1) out.push({ path: [cmd.name, s.name], cmd, opts: s.options || [], desc: s.description, app });
          else for (const ss of (s.options || []).filter((o) => o.type === 1)) out.push({ path: [cmd.name, s.name, ss.name], cmd, opts: ss.options || [], desc: ss.description, app });
        }
      }
      cmdResolved.set(key, out);
      return out;
    }).catch((e) => { cmdCache.delete(key); console.warn(e); return []; }));
  }
  return cmdCache.get(key);
}

let slashPop = null, slashSel = 0, slashList = [];
function closeSlash() { slashPop?.remove(); slashPop = null; slashList = []; }
async function updateSlash() {
  const v = $("#input").value;
  if (!v.startsWith("/") || v.includes("\n")) return closeSlash();
  const typed = v.slice(1).toLowerCase();
  const cmds = await loadCommands();
  if ($("#input").value !== v) return;
  // Komut tamamen yazılmış ve boşluktan sonra seçenek giriliyorsa: ipucu göster
  const exact = matchSlash(v);
  slashList = exact && v.length > exact.path.join(" ").length + 1 ? [exact] : cmds.filter((c) => c.path.join(" ").startsWith(typed.trim()) || c.path[0].includes(typed.trim())).slice(0, 12);
  if (!slashList.length) return closeSlash();
  if (!slashPop) { slashPop = h("div", "slash-pop"); $("#composer").prepend(slashPop); }
  slashSel = Math.min(slashSel, slashList.length - 1);
  slashPop.innerHTML = "";
  slashList.forEach((c, i) => {
    const icon = c.app?.icon ? `<img src="${CDN}/app-icons/${c.app.id}/${c.app.icon}.webp?size=32">` : `<span class="sl-ico">/</span>`;
    const opts = c.opts.map((o) => `<span class="sl-opt${o.required ? " req" : ""}">${esc(o.name)}:</span>`).join("");
    const it = h("div", "sl-item" + (i === slashSel ? " sel" : ""), `${icon}<div><b>/${esc(c.path.join(" "))}</b> ${opts}<small>${esc(c.desc || "")}</small></div><span class="sl-app">${esc(c.app?.name || "")}</span>`);
    it.onmousedown = (e) => { e.preventDefault(); pickSlash(i); };
    slashPop.append(it);
  });
}
function pickSlash(i) {
  const c = slashList[i]; if (!c) return;
  const req = c.opts.filter((o) => o.required).map((o) => o.name + ":").join(" ");
  $("#input").value = "/" + c.path.join(" ") + " " + (req ? req.split(" ")[0] : "");
  $("#input").focus(); autoGrow(); updateSlash();
}
function matchSlash(text) {
  const words = text.slice(1).split(/\s+/);
  let best = null;
  const list = cmdResolved.get(S.channel?.guild_id || S.channel?.id) || [];
  for (const c of list) if (c.path.every((p, i) => words[i] === p) && (!best || c.path.length > best.path.length)) best = c;
  return best;
}

function slashKey(e) {
  if (!slashPop || !slashList.length) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); slashSel = (slashSel + (e.key === "ArrowDown" ? 1 : -1) + slashList.length) % slashList.length; updateSlash(); return true; }
  if (e.key === "Tab" || (e.key === "Enter" && !matchSlash($("#input").value))) { e.preventDefault(); pickSlash(slashSel); return true; }
  if (e.key === "Escape") { closeSlash(); return true; }
  return false;
}
$("#input").addEventListener("input", () => { clearTimeout(updateSlash._t); updateSlash._t = setTimeout(updateSlash, 80); });
$("#input").addEventListener("blur", () => setTimeout(closeSlash, 150));

function parseOptions(rest, defs) {
  const out = [];
  const parts = rest.split(/(?:^|\s)([\w-]+):/).slice(1);
  for (let i = 0; i < parts.length; i += 2) {
    const name = parts[i], raw = (parts[i + 1] || "").trim();
    const d = defs.find((o) => o.name === name);
    if (!d) throw new Error("Bilinmeyen seçenek: " + name);
    let value = raw;
    if (d.type === 4) { value = parseInt(raw, 10); if (isNaN(value)) throw new Error(name + " tam sayı olmalı"); }
    else if (d.type === 10) { value = parseFloat(raw.replace(",", ".")); if (isNaN(value)) throw new Error(name + " sayı olmalı"); }
    else if (d.type === 5) value = /^(true|evet|1|e|yes)$/i.test(raw);
    else if ([6, 7, 8, 9].includes(d.type)) { value = (raw.match(/\d{15,21}/) || [])[0]; if (!value) throw new Error(name + " için @etiket ya da ID gerekli"); }
    else if (d.choices?.length) { const ch = d.choices.find((c) => c.name.toLowerCase() === raw.toLowerCase() || String(c.value) === raw); if (ch) value = ch.value; }
    out.push({ type: d.type, name, value });
  }
  for (const d of defs) if (d.required && !out.some((o) => o.name === d.name)) throw new Error(`Zorunlu seçenek eksik: ${d.name}`);
  return out;
}

async function runSlash(text) {
  await loadCommands();
  const c = matchSlash(text);
  if (!c) return false;
  let options;
  try { options = parseOptions(text.slice(1 + c.path.join(" ").length), c.opts); }
  catch (e) { toast(e.message); return true; }
  let opts = options;
  if (c.path.length === 3) opts = [{ type: 2, name: c.path[1], options: [{ type: 1, name: c.path[2], options }] }];
  else if (c.path.length === 2) opts = [{ type: 1, name: c.path[1], options }];
  const data = { version: c.cmd.version, id: c.cmd.id, name: c.cmd.name, type: 1, options: opts, application_command: c.cmd, attachments: [] };
  closeSlash();
  $("#input").value = ""; autoGrow();
  toast(`⏳ /${c.path.join(" ")} çalıştırılıyor…`);
  try { const n = await invoke("run_command", { guildId: S.channel.guild_id || null, channelId: S.channel.id, applicationId: c.cmd.application_id, data }); pendingCmds.set(n, c.path.join(" ")); }
  catch (e) { toast("Komut çalıştırılamadı: " + e); $("#input").value = text; }
  return true;
}
const pendingCmds = new Map();
listen("interaction", (e) => {
  const name = pendingCmds.get(e.payload.nonce);
  if (!name) return;
  pendingCmds.delete(e.payload.nonce);
  if (!e.payload.ok) toast(`⚠ /${name}: uygulama yanıt vermedi`);
});

/* ------------------------------------------------------------------ */
/* Moderasyon                                                          */
/* ------------------------------------------------------------------ */
const P = { KICK: 1n << 1n, BAN: 1n << 2n, ADMIN: 1n << 3n, MANAGE_NICK: 1n << 27n, MANAGE_ROLES: 1n << 28n, MODERATE: 1n << 40n, CHANGE_NICK: 1n << 26n };
const gperm = (g, bit) => { try { const p = BigInt(g?.perms || 0); return (p & P.ADMIN) !== 0n || (p & bit) !== 0n; } catch { return false; } };
const curGuild = () => S.guilds.find((g) => g.id === (S.channel?.guild_id || (S.view !== "home" ? S.view : null)));

function moreActions(btn, m, el) {
  const c = S.channel;
  if (!c?.guild_id || m._deleted) return;
  if (c.manage) {
    btn(m.pinned ? "📍" : "📌", m.pinned ? "Sabitlemeyi kaldır" : "Sabitle", async () => {
      try { await invoke("mod_action", { action: m.pinned ? "unpin" : "pin", guildId: c.guild_id, channelId: c.id, target: m.id, value: null, reason: null }); toast(m.pinned ? "Sabitleme kaldırıldı" : "📌 Sabitlendi"); }
      catch (e) { toast("" + e); }
    });
    if (m.author?.id !== S.me?.id) btn("🗑", "Sil (moderatör)", () => delMsg(m), "del");
  }
}

async function timeoutUser(g, u) {
  const sel = h("select", "inp");
  for (const [s, l] of [[60, "60 saniye"], [300, "5 dakika"], [600, "10 dakika"], [3600, "1 saat"], [86400, "1 gün"], [604800, "1 hafta"], [0, "Zaman aşımını kaldır"]]) { const o = h("option", null, l); o.value = s; sel.append(o); }
  const r = await askModal("⏱ Zaman aşımı", `<b>${esc(dname(u))}</b> bu süre boyunca yazamaz ve konuşamaz.`, "Uygula", { reason: true, extra: sel });
  if (!r.ok) return;
  const until = +sel.value ? new Date(Date.now() + +sel.value * 1000).toISOString() : null;
  try { await invoke("mod_action", { action: "timeout", guildId: g.id, channelId: null, target: u.id, value: until, reason: r.reason }); toast(until ? "⏱ Zaman aşımı verildi" : "Zaman aşımı kaldırıldı"); }
  catch (e) { toast("Olmadı: " + e); }
}
async function kickOrBan(g, u, ban) {
  let sel = null;
  if (ban) { sel = h("select", "inp"); for (const [s, l] of [[0, "Mesajlarını silme"], [3600, "Son 1 saatin mesajlarını sil"], [86400, "Son 24 saati sil"], [604800, "Son 7 günü sil"]]) { const o = h("option", null, l); o.value = s; sel.append(o); } }
  const r = await askModal(ban ? "🔨 Yasakla" : "👢 Sunucudan at", `<b>${esc(dname(u))}</b> ${ban ? "yasaklansın mı? Davetle bile geri dönemez." : "sunucudan atılsın mı? Davetle geri dönebilir."}`, ban ? "Yasakla" : "At", { danger: true, reason: true, extra: sel });
  if (!r.ok) return;
  try { await invoke("mod_action", { action: ban ? "ban" : "kick", guildId: g.id, channelId: null, target: u.id, value: ban ? +sel.value : null, reason: r.reason }); toast(ban ? "🔨 Yasaklandı" : "👢 Atıldı"); }
  catch (e) { toast("Olmadı: " + e); }
}
async function editNick(g, u) {
  let cur = "";
  try { cur = (await invoke("member_info", { guildId: g.id, userId: u.id })).nick || ""; } catch {}
  const inp = h("input", "inp"); inp.value = cur; inp.maxLength = 32; inp.placeholder = "Sunucu takma adı (boş = sıfırla)";
  const r = await askModal("Sunucu takma adı", `<b>${esc(dname(u))}</b> — herkes görür.`, "Kaydet", { extra: inp, reason: u.id !== S.me?.id });
  if (!r.ok) return;
  try { await invoke("mod_action", { action: "nick", guildId: g.id, channelId: null, target: u.id, value: inp.value.trim() || null, reason: r.reason }); toast("Takma ad güncellendi"); }
  catch (e) { toast("Olmadı: " + e); }
}
async function editRoles(g, u) {
  let member;
  try { member = await invoke("member_info", { guildId: g.id, userId: u.id }); } catch (e) { return toast("Üye bilgisi alınamadı: " + e); }
  const have = new Set(member.roles || []);
  const list = h("div", "role-list");
  const roles = Object.entries(g.roles || {}).filter(([id]) => id !== g.id).sort((a, b) => (b[1].position ?? 0) - (a[1].position ?? 0));
  for (const [id, r] of roles) {
    const can = g.owner || (r.position ?? 0) < (g.my_top ?? 0);
    const l = h("label", "role-item" + (can ? "" : " off"));
    const cb = h("input"); cb.type = "checkbox"; cb.checked = have.has(id); cb.disabled = !can; cb.value = id;
    l.append(cb, h("span", "dot", ""), document.createTextNode(" " + r.name));
    l.querySelector(".dot").style.background = intColor(r.color) || "var(--muted)";
    list.append(l);
  }
  const res = await askModal("🎭 Roller — " + dname(u), "Senin en üst rolünün altındaki rolleri verebilirsin.", "Kaydet", { extra: list, reason: true });
  if (!res.ok) return;
  const next = [...list.querySelectorAll("input:checked")].map((x) => x.value);
  try { await invoke("mod_action", { action: "roles", guildId: g.id, channelId: null, target: u.id, value: next, reason: res.reason }); toast("Roller güncellendi"); }
  catch (e) { toast("Olmadı: " + e); }
}

function memberMenu(e, u) {
  const g = curGuild();
  const items = [{ label: "👤 Profil", fn: () => openPopout(e.target.closest("[data-pop]") || e.target, u.id) }];
  items.push(...voiceUserItems(u));
  if (u.id !== S.me?.id) items.push({ label: "💬 Mesaj gönder", fn: () => openDmWith(u) }, { label: "🏷 Yerel takma ad", fn: () => setNickname(u) });
  if (g) {
    const mods = [];
    if (u.id === S.me?.id ? gperm(g, P.CHANGE_NICK) : gperm(g, P.MANAGE_NICK)) mods.push({ label: "✏️ Sunucu takma adı", fn: () => editNick(g, u) });
    if (gperm(g, P.MANAGE_ROLES)) mods.push({ label: "🎭 Rolleri düzenle", fn: () => editRoles(g, u) });
    if (u.id !== S.me?.id) {
      if (gperm(g, P.MODERATE)) mods.push({ label: "⏱ Zaman aşımı", fn: () => timeoutUser(g, u) });
      if (gperm(g, P.KICK)) mods.push({ label: "👢 Sunucudan at", danger: true, fn: () => kickOrBan(g, u, false) });
      if (gperm(g, P.BAN)) mods.push({ label: "🔨 Yasakla", danger: true, fn: () => kickOrBan(g, u, true) });
    }
    if (mods.length) items.push("-", ...mods);
  }
  items.push("-", { label: "Kullanıcı ID'sini kopyala", fn: () => { navigator.clipboard.writeText(u.id); toast("Kopyalandı"); } });
  showMenu(e, items);
}
document.addEventListener("contextmenu", (e) => {
  const t = e.target.closest("[data-pop]");
  if (!t) return;
  e.preventDefault();
  memberMenu(e, userById(t.dataset.pop));
});

/* Besteci düğmeleri */
$("#poll-btn").onclick = openPollCreator;
$("#mic-btn").onclick = toggleRecord;
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && REC.on) finishRecord(false); });
