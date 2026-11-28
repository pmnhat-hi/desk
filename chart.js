// Hand-drawn <canvas> charts (no library). Every canvas is devicePixelRatio aware.
const C = { green: "#00d35a", red: "#ff453a", orange: "#ff9f0a", cyan: "#64d2ff", blue: "#0a84ff",
  yellow: "#ffd60a", pink: "#ff6b9a", sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)",
  sep: "rgba(84,84,88,0.55)", card: "#1c1c1e", card2: "#2c2c2e" };
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FONT_TEXT = '-apple-system, "SF Pro Text", system-ui, sans-serif';

function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}

function animate(ms, step) {
  if (REDUCED || ms <= 0) { step(1); return; }
  const t0 = performance.now();
  const f = (t) => { const p = Math.min(1, (t - t0) / ms); step(p); if (p < 1) requestAnimationFrame(f); };
  requestAnimationFrame(f);
}

// ---- Home line chart ------------------------------------------------------------------------
// data: {points:[{ts,value}], start, marks:[{ts,label,color}]}; prev = previous data (for slide-in)
function drawLine(cv, data, opts = {}) {
  const pts = (data && data.points) || [];
  const prevN = opts.prevCount || pts.length;
  const grew = pts.length > prevN && prevN > 1;              // a new point slides in over 250ms
  const fade = !opts.marksSeen && (data.marks || []).length > 0;   // marks fade in over 200ms
  const ms = Math.max(grew ? 250 : 0, fade ? 200 : 0);
  animate(ms, (p) => _drawLine(cv, data, grew ? Math.min(1, (p * ms) / 250) : 1, prevN,
    fade ? Math.min(1, (p * ms) / 200) : 1));
}

function _drawLine(cv, data, slide, prevN, markAlpha = 1) {
  const { g, w, h } = fitCanvas(cv);
  const pts = data.points || [], marks = data.marks || [];
  const top = 34 + 22 * 2, bottom = h - 8;            // room for 3 rows of marks above the line
  const vals = pts.map((p) => p.value).concat(data.start != null ? [data.start] : []);
  if (!vals.length) return;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
  const t0 = pts.length ? Date.parse(pts[0].ts) : 0, t1 = pts.length ? Date.parse(pts[pts.length - 1].ts) : 1;
  const X = (ts) => (t1 === t0 ? w : ((Date.parse(ts) - t0) / (t1 - t0)) * w);
  const Y = (v) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  if (data.start != null) {                            // dashed line at the start value
    g.save(); g.setLineDash([4, 4]); g.strokeStyle = C.ter; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, Y(data.start)); g.lineTo(w, Y(data.start)); g.stroke(); g.restore();
  }
  if (pts.length < 2) return;
  let n = pts.length;
  const xy = pts.map((p) => [X(p.ts), Y(p.value)]);
  if (slide < 1 && prevN < n) {                        // new point slides in from the previous last point
    const [ax, ay] = xy[prevN - 1];
    for (let i = prevN; i < n; i++) xy[i] = [ax + (xy[i][0] - ax) * slide, ay + (xy[i][1] - ay) * slide];
  }
  const grad = g.createLinearGradient(0, top, 0, bottom);
  grad.addColorStop(0, "rgba(0,211,90,0.28)"); grad.addColorStop(1, "rgba(0,211,90,0)");
  g.beginPath(); xy.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.lineTo(xy[n - 1][0], bottom); g.lineTo(xy[0][0], bottom); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath(); xy.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.strokeStyle = C.green; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
  // marks above the line; a later mark that would overlap moves up a row
  g.font = `600 12px ${FONT_TEXT}`; g.textBaseline = "middle";
  const rows = [];
  const col = { blue: C.blue, green: C.green, red: C.red };
  g.globalAlpha = markAlpha;
  for (const m of marks) {
    const mx = Math.min(Math.max(X(m.ts), 0), w);
    const tw = g.measureText(m.label).width + 14;
    let x0 = Math.min(Math.max(mx - tw / 2, 0), w - tw);
    let row = 0;
    while ((rows[row] || []).some(([a, b]) => x0 < b + 4 && x0 + tw > a - 4)) row++;
    (rows[row] = rows[row] || []).push([x0, x0 + tw]);
    const yLine = Y(valueAt(pts, m.ts));
    const yb = Math.min(yLine - 16, top - 12) - row * 22;
    g.strokeStyle = col[m.color] || C.sec; g.lineWidth = 1;
    g.beginPath(); g.moveTo(mx, yb + 10); g.lineTo(mx, yLine); g.stroke();
    g.fillStyle = C.card2; roundRect(g, x0, yb - 10, tw, 20, 10); g.fill();
    g.fillStyle = col[m.color] || C.sec; g.fillText(m.label, x0 + 7, yb);
  }
  g.globalAlpha = 1;
}

function valueAt(pts, ts) {
  const t = Date.parse(ts);
  let best = pts[0];
  for (const p of pts) if (Date.parse(p.ts) <= t) best = p;
  return best ? best.value : 0;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---- Coin candles + volume --------------------------------------------------------------------
// candles: [{t,o,h,l,c,v}], exitLine: price | null
function drawCandles(cv, candles, exitLine) {
  const { g, w, h } = fitCanvas(cv);
  if (!candles || !candles.length) return false;
  const volH = h * 0.2, top = 10, bottom = h - volH - 10;
  const prices = candles.flatMap((c) => [c.h, c.l]).concat(exitLine != null ? [exitLine] : []);
  let lo = Math.min(...prices), hi = Math.max(...prices);
  if (hi - lo < hi * 1e-6) { lo *= 0.99; hi *= 1.01; }
  const Y = (p) => bottom - ((p - lo) / (hi - lo)) * (bottom - top);
  const slot = w / Math.max(candles.length, 20), bw = Math.max(2, slot * 0.6);
  const vmax = Math.max(0, ...candles.map((c) => c.v || 0));
  candles.forEach((c, i) => {
    const x = i * slot + slot / 2, up = c.c >= c.o;
    g.strokeStyle = g.fillStyle = up ? C.green : C.red;
    g.beginPath(); g.moveTo(x, Y(c.h)); g.lineTo(x, Y(c.l)); g.lineWidth = 1; g.stroke();
    const y0 = Y(Math.max(c.o, c.c)), y1 = Y(Math.min(c.o, c.c));
    g.fillRect(x - bw / 2, y0, bw, Math.max(1, y1 - y0));
    if (c.v != null && vmax > 0) {                      // null volume -> no bar (never invented)
      const vh = (c.v / vmax) * volH;
      g.globalAlpha = 0.45; g.fillRect(x - bw / 2, h - vh, bw, vh); g.globalAlpha = 1;
    }
  });
  if (exitLine != null) {
    const y = Y(exitLine);
    g.save(); g.setLineDash([6, 4]); g.strokeStyle = C.orange; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.restore();
    g.font = `600 11px ${FONT_TEXT}`; g.fillStyle = C.orange; g.textBaseline = "bottom";
    g.fillText("Risk trailing stop", 4, y - 3);
  }
  return true;
}

// ---- Analyst score ring ------------------------------------------------------------------------
function drawRing(cv, score, minScore) {
  const { g, w, h } = fitCanvas(cv);
  const r = Math.min(w, h) / 2 - 6, cx = w / 2, cy = h / 2;
  g.lineWidth = 8; g.lineCap = "round";
  g.strokeStyle = C.card2; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `600 ${Math.round(r * 0.7)}px -apple-system, "SF Pro Display", system-ui`;
  if (score == null) { g.fillStyle = C.ter; g.fillText("—", cx, cy); return; }
  g.strokeStyle = score >= minScore ? C.green : C.yellow;
  g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(0, Math.min(100, score))) / 100); g.stroke();
  g.fillStyle = "#fff"; g.fillText(String(score), cx, cy);
}

if (typeof module !== "undefined") module.exports = { drawLine, drawCandles, drawRing };
