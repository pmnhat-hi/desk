// Desk app (STEP 8), plan B: reads AES-GCM encrypted JSON from GitHub Pages every 60s. Read-only:
// settings, pause/resume and mode are Telegram commands (STEP 9) and the UI says so. No web push on plan B.
// Every FOMO URL shown here is a string the desk produced with links.py (coinUrl, profileUrl, signupUrl, push url).
// This file never builds a FOMO URL.
const VAPID_PUBLIC_KEY = "BL8rm6y4K1N7FfCOTrihKBI6idICurmGaNlce7wuvI75t_eifZXZ0of213y7Wzca2pH7IWKhYjLzGydKktL0u7M";
const POLL_MS = 60000, STALE_MS = 45 * 60000;   // publisher: <=7 min when changed, 30 min keep-alive, +10 min Pages cache
const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
const TITLE = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
const COLOR = { scanner: "var(--cyan)", auditor: "var(--blue)", analyst: "var(--yellow)", executor: "var(--green)", risk: "var(--pink)" };
const FILES = ["state.json", "chart.json", "activity.json", "agents.json", "account.json", "settings.json", "coins.json"];

function takeFragment(hash) {
  const p = new URLSearchParams(hash.replace(/^[^#]*#/, ""));
  const t = p.get("t"), d = p.get("d");
  if (t) localStorage.setItem("desk_token", t);
  if (d) localStorage.setItem("desk_data", d);
  return !!(t && d);
}
if (takeFragment(location.hash)) history.replaceState(null, "", location.pathname);

const Desk = {
  keys: null, cache: {},
  async init() {
    const t = localStorage.getItem("desk_token"), d = localStorage.getItem("desk_data");
    if (!t || !d) throw new Error("locked");
    this.keys = await deskKeys(t, d);
  },
  async get(name) {
    let path = name;
    const m = name.match(/^(coin|audit)\/(.+)\.json$/);
    if (m) path = `${m[1]}/${await fileId(this.keys, m[2])}.json`;
    const r = await fetch(`d/${this.keys.folder}/${path}?ts=${Date.now()}`, { cache: "no-store" });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const v = await openEnvelope(this.keys, name, await r.json());
    this.cache[name] = v;
    return v;
  },
};

// ---- helpers ------------------------------------------------------------------------------------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ND = '<span class="ter">no data</span>';
const nn = (v, f) => (v == null || Number.isNaN(v) ? ND : f(v));
const usd = (v, d = 2) => "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const compact = (v) => { const a = Math.abs(v); return a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : usd(v, 0); };
const SUB = "₀₁₂₃₄₅₆₇₈₉";
const px = (v) => {                                    // tiny prices: $0.0₇1435 (count of zeros as subscript)
  if (v >= 1) return usd(v, 2);
  if (v >= 0.0001) return "$" + Number(v).toPrecision(4).replace(/0+$/, "");
  if (v <= 0) return usd(v, 2);
  const zeros = Math.floor(-Math.log10(v)), digits = Math.round(v * 10 ** (zeros + 4)).toString().slice(0, 4);
  return `$0.0${[...String(zeros)].map((d) => SUB[d]).join("")}${digits}`;
};
const pct = (v, d = 2) => `${v >= 0 ? "+" : ""}${Number(v).toFixed(d)}%`;
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const short = (m) => (m ? `${m.slice(0, 4)}…${m.slice(-4)}` : "");
const cname = (o) => esc((o && (o.name || o.symbol)) || short(o && o.mint));
const safeUrl = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
const ext = (u, inner, cls = "") => (safeUrl(u) ? `<a class="${cls}" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : `<span class="${cls}">${inner}</span>`);
const ago = (iso) => { if (!iso) return null; const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${Math.round(m)}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const S = { range: "LIVE", shown: 30, tab: "home", lastOk: null, failing: false, nextAt: Date.now(), loaded: false,
  prevCount: {}, marksSeen: {}, sheet: null };
const D = (f) => Desk.cache[f];

// ---- polling + states ------------------------------------------------------------------------------
async function poll() {
  S.nextAt = Date.now() + POLL_MS;
  try {
    if (!Desk.keys) await Desk.init();
    $("#lock").classList.add("hidden");
    const got = await Promise.all(FILES.map((f) => Desk.get(f)));
    if (!got[0]) throw new Error("no state");
    S.lastOk = got[0].generatedAt;
    S.failing = Date.now() - Date.parse(S.lastOk) > STALE_MS;   // data stopped moving = desk offline
    S.loaded = true;
  } catch (e) {
    if (e.message === "locked") return showLock();
    S.failing = true;                                             // keep the last good numbers on screen
  }
  renderAll();
}

function errRow() {
  const n = Math.max(0, Math.round((S.nextAt - Date.now()) / 1000));
  const txt = `Desk offline · retrying in ${n}s · last update ${S.lastOk ? hhmm(S.lastOk) : "never"}`;
  $$(".err").forEach((el) => { el.textContent = txt; el.classList.toggle("hidden", !S.failing); });
}
setInterval(() => { if (S.failing) errRow(); if (Date.now() >= S.nextAt) poll(); }, 1000);

function showLock() {
  $$(".tab").forEach((t) => t.classList.add("hidden")); $("#tabs").classList.add("hidden"); $("#lock").classList.remove("hidden");
}
$("#lockgo").onclick = () => {
  const v = $("#lockin").value.trim();
  if (takeFragment(v)) { $("#lockin").value = ""; $("#lock").classList.add("hidden"); $("#tabs").classList.remove("hidden"); go(S.tab); poll(); }
};

function renderAll() {
  errRow();
  if (!S.loaded) return;                      // loading blocks stay until the first good read
  $$(".tab .ld").forEach((el) => el.classList.add("hidden"));
  $$(".tab .ok").forEach((el) => el.classList.remove("hidden"));
  renderHome(); renderAgents(); renderActivity(); renderAccount();
  if (S.sheet && S.sheet.kind === "coin") renderCoin(S.sheet.mint, true);
}

// ---- navigation --------------------------------------------------------------------------------------
function go(tab, anchor) {
  S.tab = tab; closeSheets();
  $$(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== tab));
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.go === tab));
  if (anchor) { const el = document.getElementById(anchor); if (el) el.scrollIntoView(); } else window.scrollTo(0, 0);
  if (tab === "home") requestAnimationFrame(renderChart);
}
function closeSheets() { $$(".sheet").forEach((s) => s.classList.add("hidden")); S.sheet = null; }
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]"); if (g) { go(g.dataset.go, g.dataset.anchor); return; }
  if (e.target.closest("[data-close]")) { closeSheets(); return; }
  const c = e.target.closest("[data-coin]"); if (c) { openCoin(c.dataset.coin); return; }
  const a = e.target.closest("[data-audit]"); if (a) { openAudit(a.dataset.audit); return; }
});

// ---- odometer -------------------------------------------------------------------------------------------
function setOdo(el, text) {
  const chars = [...text];
  const fresh = el.dataset.shape !== chars.map((c) => (/\d/.test(c) ? "d" : c)).join("");
  if (fresh) {
    el.dataset.shape = chars.map((c) => (/\d/.test(c) ? "d" : c)).join("");
    el.innerHTML = chars.map((c) => (/\d/.test(c)
      ? `<span class="d"><span class="col" style="transition:none">${[...Array(10).keys()].map((n) => `<span>${n}</span>`).join("")}</span></span>`
      : `<span>${esc(c)}</span>`)).join("");
  }
  const cols = $$(".col", el), digits = chars.filter((c) => /\d/.test(c));
  let k = 0;
  for (let i = cols.length - 1; i >= 0; i--) {          // right to left, 30ms stagger per changed digit
    const col = cols[i], want = `translateY(-${Number(digits[i]) * 66}px)`;
    if (col.style.transform === want) continue;
    col.style.transitionDelay = fresh || REDUCED_MOTION ? "0ms" : `${k++ * 30}ms`;
    col.style.transform = want;
  }
  if (fresh) requestAnimationFrame(() => cols.forEach((c) => (c.style.transition = "")));
  el.setAttribute("aria-label", text);
}

// ---- HOME -------------------------------------------------------------------------------------------------
function renderHome() {
  const st = D("state.json"), acc = D("account.json");
  const paper = st.mode === "PAPER";
  $("#paperHome").classList.toggle("hidden", !paper);
  document.querySelectorAll(".modepill").forEach((e) => e.classList.toggle("hidden", !paper));   // STEP 11: every screen
  if (st.balance == null) { $("#odo").innerHTML = ND; $("#odo").dataset.shape = ""; } else setOdo($("#odo"), usd(st.balance));
  $("#todayPct").innerHTML = st.todayPct == null ? ND : `<span class="${st.todayPct >= 0 ? "green" : "red"}">${pct(st.todayPct)}</span> <span class="sec">today</span>`;
  const g = st.guards || {};                                           // t53u: no new entries (exits continue)
  $("#guardBanner").classList.toggle("hidden", !g.blocked);
  $("#guardBanner").textContent = g.blocked ? `No new entries · ${g.blocked} · exits continue` : "";
  $("#mult").classList.toggle("hidden", st.multiplier == null);
  $("#mult").textContent = st.multiplier == null ? "" : `${st.multiplier.toFixed(2)}×`;
  $("#avatar").textContent = acc && acc.handle ? acc.handle.slice(0, 1).toUpperCase() : "·";
  const seen = localStorage.getItem("bell_seen") || "";
  $("#bellDot").classList.toggle("hidden", !(st.pushes || []).some((p) => p.ts > seen));
  $("#ranges").innerHTML = ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map((r) => `<button class="${r === S.range ? "on" : ""}" data-range="${r}">${r}</button>`).join("");
  renderChart();
  const running = AGENTS.filter((a) => st.agents[a].status === "running").length;
  $("#agentsHead").textContent = `Agents · ${running} running`;
  $("#carousel").innerHTML = AGENTS.map((a) => agentCard(a, st)).join("");
  const ring = $("#ringAnalyst"); if (ring) drawRing(ring, st.agents.analyst.lastScore, st.agents.analyst.minScore);
  execBar(st.agents.executor);
  const rows = (D("activity.json") || { rows: [] }).rows.slice(0, 5);
  $("#homeActivity").innerHTML = rows.length ? rows.map(actRow).join("") : '<div class="empty">Nothing yet tonight</div>';
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-range]"); if (b) { S.range = b.dataset.range; renderHome(); } });

function renderChart() {
  const all = D("chart.json"), cv = $("#lineChart");
  if (!all || !cv || $("#home").classList.contains("hidden")) return;
  const data = all[S.range] || { points: [], marks: [], start: null };
  const trades = (data.marks || []).length;
  const empty = S.range === "LIVE" ? trades === 0 : (data.points || []).length < 2;
  $("#chartEmpty").classList.toggle("hidden", !empty);
  const key = S.range, seenKey = `${key}:${trades}`;
  if (empty) drawLine(cv, { points: [], marks: [], start: data.start ?? (data.points[0] || {}).value ?? null });
  else drawLine(cv, data, { prevCount: S.prevCount[key], marksSeen: S.marksSeen[seenKey] });
  S.prevCount[key] = (data.points || []).length; S.marksSeen[seenKey] = true;
}
addEventListener("resize", () => { renderChart(); const r = $("#ringAnalyst"); if (r && D("state.json")) drawRing(r, D("state.json").agents.analyst.lastScore, D("state.json").agents.analyst.minScore); });

function dot(status) { return `<i class="sdot ${esc(status)}" title="${esc(status)}"></i>`; }

function agentCard(a, st) {
  const x = st.agents[a];
  const head = `<h3 style="color:${COLOR[a]}">${TITLE[a]} ${dot(x.status)}</h3>`;
  if (a === "scanner") {
    const feed = x.feed.length ? `<ul class="feed">${x.feed.slice(0, 6).map((f) => f.verdict === "pass"
      ? `<li class="pass"><span>${cname(f)} · liq ${nn(f.liquidityUsd, compact)}</span><span>→ auditor</span></li>`
      : `<li class="kill"><span>${cname(f)}</span><span>${esc(f.reason)}</span></li>`).join("")}</ul>`
      : '<div class="empty">Listening for graduations</div>';
    return `<div class="acard">${head}<div class="big num">${x.pools} pools</div>${feed}</div>`;
  }
  if (a === "auditor") {
    const L = x.last ? x.last.layers : [];
    const strips = [...Array(8).keys()].map((i) => { const l = L.find((y) => y.n === i + 1); return `<i class="${l ? (l.pass === true ? "ok" : l.pass === false ? "bad" : "") : ""}"></i>`; }).join("");
    const line = !x.last ? '<span class="sec">No coin taken apart yet</span>' : !x.last.complete ? "taking apart..."
      : x.last.passed ? '<span class="green">8/8 → Executor</span>' : `<span class="red">${esc(x.last.reason)}</span>`;
    return `<div class="acard" ${x.last ? `data-audit="${esc(x.last.mint)}"` : ""}>${head}<div class="big num">${x.takenApart} taken apart</div>
      <div class="strips">${strips}</div><div>${x.last ? cname(x.last) + " · " : ""}${line}</div>
      <div class="foot sec num">${x.rejected} rejected</div></div>`;
  }
  if (a === "analyst") {
    return `<div class="acard">${head}<div class="big">Scoring</div><canvas class="ring" id="ringAnalyst"></canvas>
      <div class="foot sec num">${x.scored} scored · green from ${x.minScore} · ${esc(x.mode)}</div></div>`;
  }
  if (a === "executor") {
    const s = x.lastSignal;
    const line = x.lastSizeUsd == null ? `<span class="sec">No trade yet</span> · ${x.stackPct}% of stack` : `${usd(x.lastSizeUsd)} · ${x.stackPct}% of stack`;
    return `<div class="acard">${head}<div class="big num">${x.trades} trades</div><div class="num">${line}</div>
      ${s ? `<div class="bar"><i id="execBar"></i></div><div id="execTxt" class="sec">${cname(s)}</div>` : ""}</div>`;
  }
  const big = x.guarding > 0 ? "Guarding" : x.lastExit || "Nothing open";
  return `<div class="acard">${head}<div class="big">${esc(big)}</div>
    <div class="sec num">${x.guarding} open${x.lastExit && x.guarding > 0 ? " · last: " + esc(x.lastExit) : ""}</div>
    <div class="foot"><span class="pill mono stop num">stop -${x.stopPct}%</span><span class="pill mono trail num">trail ${x.trailPct}%</span></div></div>`;
}

function execBar(x) {
  const s = x.lastSignal, bar = $("#execBar"), txt = $("#execTxt");
  if (!s || !bar) return;
  if (s.status === "sent") { bar.style.width = "50%"; txt.textContent = "Executing... waiting for your tap"; return; }
  if (s.status !== "bought") { bar.style.width = "0"; txt.textContent = `${s.status} · ${s.name || ""}`; return; }
  const k = `exec_seen_${s.id}`;
  if (sessionStorage.getItem(k) || REDUCED_MOTION) { bar.style.width = "100%"; txt.textContent = "✓ Filled"; return; }
  const t0 = performance.now();                          // PAPER: the bar runs 1.2s
  const f = (t) => { const p = Math.min(1, (t - t0) / 1200); bar.style.width = `${p * 100}%`;
    txt.textContent = p < 1 ? `Executing... ${Math.round(p * 100)}%` : "✓ Filled"; if (p < 1) requestAnimationFrame(f); else sessionStorage.setItem(k, "1"); };
  requestAnimationFrame(f);
}

function actRow(r) {
  const cls = r.kind === "sold" ? "green" : r.kind === "stopped" ? "red" : r.kind === "rejected" ? "sec" : "";
  const attr = r.mint ? (r.opens === "audit" ? `data-audit="${esc(r.mint)}"` : `data-coin="${esc(r.mint)}"`) : "";
  return `<button class="row" ${attr}><div class="mid"><div class="t">${esc(r.title)}</div><div class="s">${esc(r.subtitle)}</div></div>
    <div class="v num ${cls}">${esc(r.value)}</div><span class="chev">›</span></button>`;
}

// ---- AGENTS TAB -----------------------------------------------------------------------------------------------
function renderAgents() {
  const st = D("state.json"), dec = D("agents.json") || {};
  const count = { scanner: (x) => `${x.pools} pools`, auditor: (x) => `${x.takenApart} taken apart`, analyst: (x) => `${x.scored} scored`,
    executor: (x) => `${x.trades} trades`, risk: (x) => `${x.guarding} guarding` };
  $("#agentsList").innerHTML = AGENTS.map((a) => {
    const x = st.agents[a], rows = dec[a] || [];
    const locked = a === "risk" && x.guarding > 0;
    return `<div class="agent" id="agent-${a}"><div class="hd"><h2 style="color:${COLOR[a]}">${TITLE[a]}</h2>
      <span class="sec">${dot(x.status)} ${esc(x.status)}</span><span class="switch ro ${x.status !== "paused" ? "on" : ""}" role="switch" aria-checked="${x.status !== "paused"}" aria-disabled="true"></span></div>
      <div class="num" style="margin-top:6px">${count[a](x)} today</div>
      <div class="note">${locked ? "Locked while a position is open." : `Read-only here · send “pause ${TITLE[a]}” / “resume ${TITLE[a]}” in Telegram.`}</div>
      <div class="dec">${rows.length ? rows.map((r) => `<div class="row"><span class="sec num" style="width:44px">${hhmm(r.ts)}</span>
        <div class="mid"><div class="t">${ext(r.coinUrl, cname(r), "link")}</div><div class="s">${esc(r.reason ?? "")}</div></div>
        <div class="v ${/pass|bought|trail/.test(r.verdict) ? "green" : /kill|red|reject|stop|pulled/.test(r.verdict) ? "red" : "sec"}">${esc(r.verdict)}</div></div>`).join("")
        : '<div class="empty">No decisions yet</div>'}</div>
      <button class="more" data-go="account" data-anchor="set-${a}">Settings</button></div>`;
  }).join("");
}

// ---- ACTIVITY TAB ----------------------------------------------------------------------------------------------
function renderActivity() {
  const rows = (D("activity.json") || { rows: [] }).rows;
  $("#activityList").innerHTML = rows.length ? rows.slice(0, S.shown).map(actRow).join("") : '<div class="empty">Nothing yet tonight</div>';
  $("#activityMore").classList.toggle("hidden", rows.length <= S.shown);
}
$("#activityMore").onclick = () => { S.shown += 30; renderActivity(); };

// ---- ACCOUNT TAB -----------------------------------------------------------------------------------------------
const GROUPS = ["scanner", "auditor", "analyst", "executor", "risk", "desk"];
function settingRow(k, s) {
  const label = esc(k.split(".").slice(1).join(".").replace(/_/g, " "));
  const v = s.value, r = s.range;
  if (typeof v === "boolean") return `<div class="set"><div class="top"><span>${label}</span><span class="switch ro ${v ? "on" : ""}" role="switch" aria-checked="${v}" aria-disabled="true"></span></div></div>`;
  if (Array.isArray(r) && typeof r[0] === "string") return `<div class="set"><div class="top"><span>${label}</span></div><div class="seg" style="margin-top:6px">${r.map((o) => `<span class="${o === v ? "on" : ""}">${esc(o)}</span>`).join("")}</div></div>`;
  if (typeof v === "number" && Array.isArray(r)) {
    const step = Number.isInteger(v) && Number.isInteger(r[0]) && Number.isInteger(r[1]) ? 1 : "any";
    return `<div class="set"><div class="top"><span>${label}</span><input type="number" class="num" value="${v}" min="${r[0]}" max="${r[1]}" step="${step}" readonly aria-readonly="true"></div>
      <input type="range" min="${r[0]}" max="${r[1]}" step="${step}" value="${v}" disabled aria-label="${label}"><div class="ter num" style="font-size:12px">${r[0]} – ${r[1]}</div></div>`;
  }
  return `<div class="set"><div class="top"><span>${label}</span><input type="text" value="${esc(v ?? "")}" readonly aria-readonly="true"></div></div>`;
}
// STEP 10 ticket check: min_stack = min_ticket_usd / (stack_pct / 100), computed by the desk (views.settings_view)
function ticketBox(tk) {
  if (!tk) return "";
  const col = tk.kind === "skip" ? "red" : tk.kind === "bump" ? "" : "green";
  const msg = tk.message ? esc(tk.message) : "tickets at stack_pct, stack is above the minimum";
  return `<div class="set"><div class="top"><span>Ticket check</span><span class="num ter">min stack ${usd(tk.minStack)}</span></div>
    <div class="s wrap ${col}" style="font-size:13px">${msg}</div></div>`;
}
function renderAccount() {
  const acc = D("account.json"), set = D("settings.json");
  if (!acc || !set) return;
  const all = set.settings, by = (g, step10) => Object.keys(all).filter((k) => all[k].group === g && all[k].step10 === step10);
  const groups = GROUPS.map((g) => `<div class="sh" id="set-${g}"><span>${g[0].toUpperCase() + g.slice(1)}</span></div>
    <div class="card" style="margin-top:0">${g === "executor" ? ticketBox(set.ticket) : ""}${by(g, true).map((k) => settingRow(k, all[k])).join("")}
    ${by(g, false).length ? `<details><summary>More ${g} settings</summary>${by(g, false).map((k) => settingRow(k, all[k])).join("")}</details>` : ""}</div>`).join("");
  $("#accountBody").innerHTML = `
    <div class="card"><h3>Mode</h3><div class="seg"><span class="${acc.mode === "PAPER" ? "on" : ""}">PAPER</span><span class="${acc.mode === "LIVE" ? "on" : ""}">LIVE</span></div>
      <div class="note">Switch in Telegram: send “paper” or “live”. LIVE asks you to type LIVE and needs 1 full PAPER night.</div>
      <div class="set"><div class="top"><span>Stack</span><input type="text" class="num" value="${acc.stack == null ? "no data" : usd(acc.stack)}" readonly aria-readonly="true"></div>
      <div class="note">LIVE stack: send “stack 1240” in Telegram.</div></div></div>
    <div class="list" style="margin-top:12px">
      ${ext(acc.profileUrl, `<div class="mid"><div class="t">Your FOMO profile</div></div><span class="chev">›</span>`, "row")}
      <button class="row" id="invite"><div class="mid"><div class="t">Invite a friend</div></div><span class="chev">›</span></button>
      <div class="row"><div class="mid"><div class="t">Telegram</div><div class="s">Pushes and commands</div></div><div class="v ${acc.telegram === "connected" ? "green" : "red"}">${esc(acc.telegram)}</div></div>
      <div class="row"><div class="mid"><div class="t">Send test push</div><div class="s wrap">Not on plan B · runs from Telegram (STEP 9)</div></div></div>
      <div class="row"><div class="mid"><div class="t">Notifications</div><div class="s wrap">Plan B has no endpoint to save a web push subscription: no web push, Telegram only.</div></div></div>
    </div>
    <div class="note" style="margin-top:20px">Settings are read-only on plan B. Change any of them in Telegram, e.g. “set stop to -8%”. Out of range is refused with the allowed range.</div>
    ${groups}
    <div class="note" style="margin:24px 0">Last update ${S.lastOk ? hhmm(S.lastOk) : "never"} · refresh every 60s</div>`;
  $("#invite").onclick = () => invite(acc.signupUrl);
}
async function invite(url) {
  if (!safeUrl(url)) return;
  try { if (navigator.share) { await navigator.share({ url }); return; } } catch (e) { if (e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); } catch (e) { const t = document.createElement("textarea"); t.value = url; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  toast("Link copied");
}
function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }

// ---- COIN SCREEN -------------------------------------------------------------------------------------------------
async function openCoin(mint) {
  closeSheets(); S.sheet = { kind: "coin", mint };
  const el = $("#coin"); el.classList.remove("hidden"); el.scrollTop = 0;
  if (!Desk.cache[`coin/${mint}.json`]) el.innerHTML = `${sheetNav()}<div class="err hidden"></div><div class="sk" style="height:34px;width:60%;margin-top:8px"></div>
    <div class="sk" style="height:66px;width:80%;margin-top:12px"></div><div class="sk" style="height:260px;margin-top:12px"></div><div class="sk" style="height:120px;margin-top:16px"></div>`;
  await renderCoin(mint, false);
}
const sheetNav = (extra = "") => `<div class="nav"><button class="tap back" data-close>‹ Back</button><span style="flex:1"></span>${extra}</div>`;
async function renderCoin(mint, fromPoll) {
  let c = Desk.cache[`coin/${mint}.json`], failed = false;
  try { c = await Desk.get(`coin/${mint}.json`); } catch (e) { failed = true; S.failing = true; }
  if (!S.sheet || S.sheet.mint !== mint) return;
  const el = $("#coin"), st = D("state.json") || {};
  const idx = ((D("coins.json") || {}).coins || []).find((x) => x.mint === mint);
  const paper = st.mode === "PAPER" ? '<span class="pill paper">PAPER</span>' : "";
  if (!c) {
    el.innerHTML = `${sheetNav()}<div class="err hidden"></div><div class="coinhd"><h1>${cname(idx || { mint })}</h1>${paper}</div>
      <div class="empty">${failed ? "Can't read this coin right now." : "No data for this coin tonight."}</div>
      ${idx ? ext(idx.coinUrl, "Buy on FOMO", "cta") : ""}`;
    errRow(); return;
  }
  const p = c.position, age = ago(c.migratedAt);
  el.innerHTML = `${sheetNav()}<div class="err hidden"></div>
    <div class="coinhd"><h1>${cname(c)}</h1>${paper}</div>
    <div class="sec" style="display:flex;gap:8px;align-items:center;margin-top:4px">${esc(c.symbol || "—")} · Solana · ${age ? age + " old" : "age no data"}
      ${c.shield ? `<span class="chip ${c.shield === "8/8" ? "" : "bad"}">🛡 ${esc(c.shield)}</span>` : ""}</div>
    <div class="price num">${c.price == null ? ND : px(c.price)}</div>
    ${p && p.sinceEntryPct != null ? `<div class="${p.sinceEntryPct >= 0 ? "green" : "red"} num">${p.sinceEntryPct >= 0 ? "▲" : "▼"} ${Math.abs(p.sinceEntryPct).toFixed(2)}% since entry</div>` : ""}
    <div class="candles"><canvas id="candleCv"></canvas><div class="chart-empty hidden" id="candleEmpty" style="transform:none">No price data yet</div></div>
    <div class="stats">
      <div><span class="sec">Market cap</span><b class="num">${nn(c.stats.marketCap, compact)}</b></div>
      <div><span class="sec">Liquidity</span><b class="num">${nn(c.stats.liquidityUsd, compact)}</b></div>
      <div><span class="sec">24h volume</span><b class="num">${nn(c.stats.volume24h, compact)}</b></div>
      <div><span class="sec">Holders</span><b class="num">${c.stats.holders == null ? '<span class="ter">n/a</span>' : Number(c.stats.holders).toLocaleString("en-US")}</b></div>
    </div>
    ${p ? `<div class="card"><h3>Your position · ${usd(p.sizeUsd)} in · Executor</h3><div class="kv"><span class="sec">Entry</span><span class="num">${px(p.entryPrice)}</span></div>
      ${p.status === "exiting" ? '<div class="kv"><span class="orange">Exiting · waiting for your tap</span></div>' : ""}</div>
      <div class="card"><h3>Exit</h3>
      <div class="kv"><span class="sec">Stop line</span><span class="num red">${px(p.stopLine)} · -${p.stopPct}%</span></div>
      <div class="kv"><span class="sec">Trail line</span><span class="num">${p.trailLine == null ? `<span class="ter">not active yet</span>` : px(p.trailLine)}</span></div>
      <div class="kv"><span class="sec">Time left to timeout</span><span class="num">${timeLeft(p.timeoutAt)}</span></div></div>` : ""}
    ${ext(c.coinUrl, p ? "Sell on FOMO" : "Buy on FOMO", p ? "cta sell" : "cta")}`;
  const has = drawCandles($("#candleCv"), c.candles, p ? p.exitLine : null);
  $("#candleEmpty").classList.toggle("hidden", has);
  errRow();
}
function timeLeft(iso) { const ms = Date.parse(iso) - Date.now(); if (Number.isNaN(ms)) return ND; if (ms <= 0) return "0m"; const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${m % 60}m`; }

// ---- AUDITOR SCREEN ---------------------------------------------------------------------------------------------------
async function openAudit(mint) {
  closeSheets(); S.sheet = { kind: "audit", mint };
  const el = $("#audit"); el.classList.remove("hidden"); el.scrollTop = 0;
  el.innerHTML = `${sheetNav()}<div class="err hidden"></div><div class="sk" style="height:200px;width:200px;margin:20px auto"></div><div class="sk" style="height:300px"></div>`;
  let a = Desk.cache[`audit/${mint}.json`], failed = false;
  try { a = await Desk.get(`audit/${mint}.json`); } catch (e) { failed = true; S.failing = true; }
  if (!S.sheet || S.sheet.mint !== mint) return;
  renderAudit(el, a, failed, mint);
}
function renderAudit(el, a, failed, mint) {
  const paper = (D("state.json") || {}).mode === "PAPER" ? '<span class="pill paper">PAPER</span>' : "";
  const set = (D("settings.json") || { settings: {} }).settings, en = set["auditor.enabled"];
  const toggle = `<div class="card"><div class="set"><div class="top"><span>Take apart before buying</span>
    <span class="switch ro ${en && en.value ? "on" : ""}" role="switch" aria-checked="${!!(en && en.value)}" aria-disabled="true"></span></div>
    <div class="note">Read-only here. In Telegram: “set auditor.enabled off” (the desk asks twice before turning it off).</div></div></div>`;
  if (!a) {
    el.innerHTML = `${sheetNav()}<div class="err hidden"></div><div class="coinhd"><h1>Auditor</h1>${paper}</div>
      <div class="discs">${discs([])}</div><div class="empty">${failed ? "Can't read this audit right now." : "No coin taken apart yet"}</div>${toggle}`;
    errRow(); return;
  }
  const layers = [...Array(8).keys()].map((i) => a.layers.find((l) => l.n === i + 1) || { n: i + 1, name: `Layer ${i + 1}`, pass: null, value: null });
  const verdict = !a.complete ? '<div class="verdict">taking apart...</div>'
    : a.passed ? `<div class="verdict green">Cleared · 8/8 parts</div><div class="sec">${a.sentSizeUsd != null ? `Sent to Executor · ${usd(a.sentSizeUsd)}` : "Sent on to Analyst · not sized"}</div>`
    : `<div class="verdict red">Rejected · ${esc(a.reason)}</div><div class="sec">Grok Bot won't buy ${cname(a)}</div>`;
  el.innerHTML = `${sheetNav()}<div class="err hidden"></div><div class="coinhd"><h1>${cname(a)}</h1>${paper}</div>
    <div class="sec">${hhmm(a.ts)} · ${a.layersPassed}/8</div>
    <div class="discs" id="discs">${discs(layers)}<div class="beam" id="beam"></div></div>
    <div id="verdict" style="visibility:hidden">${verdict}</div>
    <div class="card">${layers.map((l) => `<div class="lrow ${l.pass == null ? "nc" : ""}"><span>${l.n} · ${esc(l.name)}</span>
      <b id="lv${l.n}" class="${l.pass === false ? "red" : ""}" style="${l.pass == null || REDUCED_MOTION ? "" : "visibility:hidden"}">${l.pass == null ? "not checked" : esc(l.value ?? "no data")}</b></div>`).join("")}</div>
    ${toggle}${ext(a.coinUrl, "Open on FOMO", "cta")}`;
  beam(layers);
  errRow();
}
function discs(layers) {
  return [...Array(8).keys()].map((i) => `<div class="disc" id="disc${i + 1}" style="top:${i * 21}px;z-index:${8 - i}">${i + 1}</div>`).join("");
}
function beam(layers) {
  // 350ms per layer top to bottom, then 150ms to green or red. Only layers the server sent (pass != null).
  const done = layers.filter((l) => l.pass != null);
  const paint = (l) => { const v = $(`#lv${l.n}`); if (v) v.style.visibility = "visible"; const d = $(`#disc${l.n}`); if (d) { d.classList.remove("scan"); d.classList.add(l.pass ? "ok" : "bad"); d.textContent = l.pass ? "✓" : "✕"; } };
  const show = () => { const v = $("#verdict"); if (v) v.style.visibility = "visible"; const b = $("#beam"); if (b) b.style.opacity = 0; };
  if (REDUCED_MOTION) { done.forEach(paint); show(); return; }
  const b = $("#beam"); let i = 0;
  const step = () => {
    if (!S.sheet || S.sheet.kind !== "audit") return;
    if (i >= done.length) { show(); return; }
    const l = done[i++], d = $(`#disc${l.n}`);
    b.style.opacity = 1; b.style.top = `${(l.n - 1) * 21 + 16}px`;
    if (d) d.classList.add("scan");
    setTimeout(() => { setTimeout(() => { paint(l); step(); }, 150); }, 350);
  };
  step();
}

// ---- SEARCH + BELL -----------------------------------------------------------------------------------------------------
$("#openSearch").onclick = () => { closeSheets(); S.sheet = { kind: "search" }; $("#searchSheet").classList.remove("hidden"); $("#searchIn").value = ""; search(""); $("#searchIn").focus(); };
$("#searchIn").oninput = (e) => search(e.target.value);
function search(q) {
  const list = (D("coins.json") || { coins: [] }).coins, s = q.trim().toLowerCase();
  const hits = !s ? list.slice(0, 30) : list.filter((c) => (c.name || "").toLowerCase().includes(s) || (c.symbol || "").toLowerCase().includes(s) || c.mint.toLowerCase().startsWith(s) || c.mint === q.trim());
  $("#searchOut").innerHTML = hits.length ? hits.slice(0, 50).map((c) => c.file
    ? `<button class="row" data-coin="${esc(c.mint)}"><div class="mid"><div class="t">${cname(c)}</div><div class="s">${esc(c.symbol || "")} · ${esc(short(c.mint))} · ${esc(c.verdict || "waiting")}</div></div><span class="chev">›</span></button>`
    : `<div class="row"><div class="mid"><div class="t">${cname(c)}</div><div class="s">${esc(short(c.mint))} · no data tonight</div></div>${ext(c.coinUrl, "FOMO", "link")}</div>`).join("")
    : `<div class="empty">${s ? "Not seen tonight. Paste the mint to look it up in Telegram: “buy &lt;mint&gt;”." : "No coins tonight yet"}</div>`;
}
$("#openBell").onclick = () => {
  closeSheets(); S.sheet = { kind: "bell" }; $("#bellSheet").classList.remove("hidden");
  const p = (D("state.json") || { pushes: [] }).pushes || [];
  $("#bellOut").innerHTML = p.length ? p.map((x) => `<div class="row"><div class="mid"><div class="sec" style="font-size:13px">Grok Bot · ${hhmm(x.ts)}${x.dryRun ? " · dry-run, not sent" : ""}</div>
    <div class="t" style="white-space:normal">${esc(x.text)}</div></div>${x.url ? ext(x.url, "FOMO", "link") : ""}</div>`).join("") : '<div class="empty">No pushes yet</div>';
  if (p.length) localStorage.setItem("bell_seen", p[0].ts);
  $("#bellDot").classList.add("hidden");
};

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
poll();
