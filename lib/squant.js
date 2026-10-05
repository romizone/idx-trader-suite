// Squant Screener — port Pine Script "squant screener" ke data EOD harian:
// 1) Elliott Wave motive (1)–(5) + korektif (a)(b)(c) + fib retracement dari ZigZag panjang 4/8/16.
//    Logika gelombang diadaptasi dari indikator LuxAlgo — CC BY-NC-SA 4.0 © LuxAlgo
//    (https://creativecommons.org/licenses/by-nc-sa/4.0/).
// 2) Sinyal SMA 3/5/10/20: F = Full (close di atas semua SMA), V = Volume (> 1,5× SMA20 volume),
//    C = Compressed (sebaran SMA < 2,5%), S = Soon (close di atas minimal 1 SMA, belum semua); FH = F+V+C. Plus anak tangga H2.
// 3) Trend Template 6 syarat: MA50/150/200, MA200 naik vs 1 bulan lalu, jarak dari low/high 52 minggu.

const round = (x, d = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
export const FIB = [0.5, 0.618, 0.764, 0.854];
export const EW_LENS = [4, 8, 16];
export const EW_FRESH = 30;

function smaSeries(arr, n) {
  const out = new Array(arr.length).fill(null);
  let s = 0;
  for (let i = 0; i < arr.length; i++) {
    s += arr[i];
    if (i >= n) s -= arr[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

// ---------------------------------------------------------------- 1) Elliott Wave
// ta.pivothigh/pivotlow(src, left, 1): bar i-1 menjadi pivot, dikonfirmasi pada bar i.
function isPivot(src, i, left, up) {
  const c = i - 1;
  if (c - left < 0) return false;
  const v = src[c];
  for (let k = c - left; k < c; k++) if (up ? src[k] > v : src[k] < v) return false;
  return up ? src[i] < v : src[i] > v;
}

// Menjalankan state machine per bar seperti draw() di Pine; hasil = gelombang terakhir (aEW[0]).
function elliott(rows, left) {
  const hi = rows.map(r => r.high), lo = rows.map(r => r.low);
  const zz = Array.from({ length: 11 }, () => ({ d: 0, x: -1, y: 0 })); // zz[0] = titik ZigZag terbaru
  const waves = []; // waves[0] = gelombang terbaru

  const step = (s, x2, y2) => { // s = 1 pivot high, -1 pivot low
    const g = waves[0];
    if (s === 1 ? zz[0].d < 1 : zz[0].d > -1) { zz.unshift({ d: s, x: x2, y: y2 }); zz.pop(); }
    else if (s * (y2 - zz[0].y) > 0) { zz[0].x = x2; zz[0].y = y2; }
    const P = [null, zz[5], zz[4], zz[3], zz[2], zz[1], { x: x2, y: y2 }].map(p => p && { x: p.x, y: p.y });
    if (P[1].x < 0) return; // ZigZag belum punya 6 titik nyata

    // ---- motive (1)-(5)
    const W5 = s * (P[6].y - P[5].y), W3 = s * (P[4].y - P[3].y), W1 = s * (P[2].y - P[1].y);
    const isWave = W3 !== Math.min(W1, W3, W5) && s * (P[6].y - P[4].y) > 0 && s * (P[3].y - P[1].y) > 0 && s * (P[5].y - P[2].y) > 0;
    const same = !!g && [1, 2, 3, 4].every(k => P[k].x === g.pts[k].x);
    if (isWave) {
      if (same) g.pts[6] = P[6];
      else waves.unshift({ dir: s, pts: P, on: true, abc: null, next: null });
    } else if (same && g.on) g.on = false;

    // ---- korektif (a)(b)(c) setelah motive arah berlawanan
    const w = waves[0];
    if (!w) return;
    const end = w.pts[6], diff = Math.abs(end.y - w.pts[1].y);
    if (w.dir === -s) {
      const same2 = P[1].x === w.pts[4].x && P[2].x === w.pts[5].x && P[3].x === end.x;
      const lim = end.y + s * diff * FIB[3];
      const valid = P[3].x === end.x && s * (lim - P[6].y) > 0 && s * (lim - P[4].y) > 0 && s * (P[5].y - end.y) > 0;
      const has = same2 && w.abc && w.abc.a[1].x > P[3].x;
      if (valid) {
        const width = P[6].x - P[2].x;
        if (has) { w.abc.c = P[6]; Object.assign(w.abc.box, { left: P[6].x, top: P[6].y, right: P[6].x + width }); }
        else w.abc = { a: [P[3], P[4]], b: P[5], c: P[6], valid: true, broken: null, box: { left: P[6].x, top: P[6].y, right: P[6].x + width, bottom: P[4].y } };
      } else if (has) w.abc.valid = false;
    } else if (w.dir === s && w.abc && P[5].x === w.abc.c.x && s * (P[6].y - end.y) > 0 && !w.next) {
      w.next = P[6]; // kemungkinan awal gelombang motive baru
    }
  };

  for (let b = 1; b < rows.length; b++) {
    if (isPivot(hi, b, left, true)) step(1, b - 1, hi[b - 1]);
    if (isPivot(lo, b, left, false)) step(-1, b - 1, lo[b - 1]);
    const w = waves[0], bx = w?.abc?.box;
    if (bx && b <= bx.right) {
      const cross = w.dir === 1 ? lo[b] < bx.bottom && lo[b - 1] >= bx.bottom : hi[b] > bx.top && hi[b - 1] <= bx.top;
      if (cross) w.abc.broken = b;
    }
  }

  const n = rows.length - 1, w = waves[0];
  if (!w) return { len: left, dir: 0, state: 'none', label: 'Belum ada pola', bias: 0 };
  const s = w.dir, end = w.pts[6], diff = Math.abs(end.y - w.pts[1].y);
  let fib = null;
  if (w.on && !(w.abc && w.abc.c.x > end.x)) {
    const levels = FIB.map(f => end.y - s * diff * f);
    let broken = false;
    for (let i = end.x; i <= n; i++) if (s === 1 ? lo[i] < levels[3] : hi[i] > levels[3]) { broken = true; break; }
    fib = { levels: levels.map(v => round(v)), broken, retrace: diff ? round((s * (end.y - rows[n].close) / diff) * 100, 1) : null };
  }
  const up = s === 1;
  let state, label, bias;
  if (w.abc && w.abc.broken != null) [state, label, bias] = ['abcBreak', up ? 'Kotak ABC jebol ke bawah' : 'Kotak ABC jebol ke atas', -s];
  else if (w.abc && !w.abc.valid) [state, label, bias] = ['abcInv', 'Koreksi ABC batal', 0];
  else if (w.next) [state, label, bias] = ['next', up ? 'Kemungkinan awal impuls naik baru' : 'Kemungkinan awal impuls turun baru', s];
  else if (w.abc) [state, label, bias] = ['abc', up ? 'Koreksi ABC selesai setelah impuls naik' : 'Koreksi ABC selesai setelah impuls turun', s];
  else if (!w.on) [state, label, bias] = ['inv', up ? 'Impuls naik batal' : 'Impuls turun batal', 0];
  else if (fib?.broken) [state, label, bias] = ['fibBreak', `Fib ${FIB[3]} jebol`, 0];
  else {
    const inZone = fib && fib.retrace >= FIB[0] * 100 && fib.retrace <= FIB[3] * 100;
    const beyond = fib && fib.retrace < 0 ? ` · harga ${up ? 'di atas' : 'di bawah'} titik (5)` : '';
    [state, label, bias] = ['impulse', `${up ? 'Impuls naik' : 'Impuls turun'} (1)–(5)${inZone ? ' · harga di zona fib' : beyond}`, s * (inZone ? 1 : 0.5)];
  }
  const pt = p => ({ date: rows[p.x].date, price: p.y });
  // Umur kejadian terakhir pola ini (titik 5, ujung C, awal baru, atau jebol kotak) dalam hari bursa.
  const lastX = Math.max(end.x, w.abc?.c.x ?? -1, w.next?.x ?? -1, w.abc?.broken ?? -1);
  return {
    len: left, dir: s, state, label, bias, on: w.on, age: n - lastX, fib,
    pts: w.pts.slice(1).map(pt),
    abc: w.abc && { a: pt(w.abc.a[1]), b: pt(w.abc.b), c: pt(w.abc.c), valid: w.abc.valid, broken: w.abc.broken != null ? rows[w.abc.broken].date : null,
      box: { from: rows[w.abc.box.left].date, top: w.abc.box.top, bottom: w.abc.box.bottom } },
    next: w.next && pt(w.next),
  };
}

// ---------------------------------------------------------------- 2) Breakout kompresi SMA
function breakoutSeries(rows) {
  const c = rows.map(r => r.close), v = rows.map(r => r.volume || 0);
  const ma = [3, 5, 10, 20].map(n => smaSeries(c, n)), v20 = smaSeries(v, 20);
  return rows.map((r, i) => {
    if (ma[3][i] == null) return null;
    const mx = Math.max(...ma.map(m => m[i])), mn = Math.min(...ma.map(m => m[i]));
    const comp = ((mx - mn) / mn) * 100, compressed = comp < 2.5, breakout = c[i] > mx, volB = v[i] > 1.5 * v20[i];
    // Soon: minimal 1 dari 4 SMA sudah ditembus (Pine asli memakai 2–3; disesuaikan dengan definisi sinyal pengguna).
    const cnt = ma.filter(m => c[i] > m[i]).length, soon = cnt >= 1 && cnt <= 3;
    const sig = breakout ? (volB && compressed ? 'FH' : volB ? 'FV' : compressed ? 'FC' : 'FO') : soon ? 'SOON' : null;
    let step = null;
    if (i > 0 && soon && c[i] > c[i - 1] && ((c[i] - c[i - 1]) / c[i - 1]) * 100 <= 4) {
      step = v[i] > v[i - 1] ? 'VOL' : r.open > c[i] && v[i - 1] >= v[i] ? 'EXH' : 'PRICE';
    }
    return { sig, step, comp: round(comp), volRatio: round(v20[i] ? v[i] / v20[i] : null), cnt };
  });
}

// ---------------------------------------------------------------- 3) Trend Template
function trendTemplate(rows) {
  const c = rows.map(r => r.close), n = c.length - 1, px = c[n];
  const at = (len, i = n) => (i + 1 < len ? null : mean(c.slice(i - len + 1, i + 1)));
  const ma50 = at(50), ma150 = at(150), ma200 = at(200), ma200m = at(200, n - 20);
  const win = rows.slice(-260); // 52 minggu (≈ 240 hari bursa BEI; histori 250 hari)
  const hi52 = Math.max(...win.map(r => r.high)), lo52 = Math.min(...win.map(r => r.low));
  const ok = x => x === true;
  const conds = [
    ['Harga > MA50, MA150 & MA200', ok(ma200 != null && px > ma50 && px > ma150 && px > ma200)],
    ['MA50 > MA150', ok(ma150 != null && ma50 > ma150)],
    ['MA150 > MA200', ok(ma200 != null && ma150 > ma200)],
    ['MA200 naik vs 1 bulan lalu', ok(ma200m != null && ma200 > ma200m)],
    ['Harga ≥ 25% di atas low 52 minggu', px > lo52 * 1.25],
    ['Harga ≤ 25% di bawah high 52 minggu', px > hi52 * 0.75],
  ].map(([t, pass]) => ({ t, pass }));
  return { pass: conds.filter(x => x.pass).length, conds, ma50: round(ma50), ma150: round(ma150), ma200: round(ma200), hi52, lo52, short: ma200m == null };
}

// ---------------------------------------------------------------- gabungan
const SIG = { FH: ['FH · Four Horsemen', 'good', 25], FV: ['FV · Full + Volume', 'hot', 20], FC: ['FC · Full + Compressed', 'warn', 15], FO: ['FO · Full', 'bad', 10], SOON: ['S · Soon', 'info', 5] };
const STEP = { VOL: ['Step↑ + Vol', 'good', 10], PRICE: ['Step↑', 'info', 6], EXH: ['Step↑ lelah', 'warn', 0] };

export function computeSquant({ code, name, hist, value }, detail = false) {
  if (!hist || hist.length < 30) return null;
  const rows = [...hist].sort((a, b) => (a.date < b.date ? -1 : 1));
  const n = rows.length - 1, last = rows[n];
  const bs = breakoutSeries(rows), now = bs[n] || {};
  let recent = null; // sinyal breakout (bukan "soon") terakhir dalam 10 hari
  for (let i = n; i >= Math.max(0, n - 9); i--) if (bs[i]?.sig && bs[i].sig !== 'SOON') { recent = { sig: bs[i].sig, age: n - i, date: rows[i].date }; break; }
  const tt = trendTemplate(rows);
  const ew = EW_LENS.map(l => elliott(rows, l));
  const avgVal20 = mean(rows.slice(-20).map(r => r.value || 0));

  // Skor 0–100 = Trend Template (35) + sinyal breakout (25; sinyal ≤ 5 hari lalu dapat separuh) + anak tangga (10)
  // + EW bullish (30; 10 per panjang ZigZag, hanya pola yang kejadian terakhirnya ≤ EW_FRESH hari).
  const sigPts = now.sig ? SIG[now.sig][2] : recent && recent.age <= 5 ? SIG[recent.sig][2] / 2 : 0;
  const fresh = ew.filter(e => e.dir && e.age <= EW_FRESH);
  const ewPts = fresh.reduce((s, e) => s + Math.max(0, e.bias) * 10, 0);
  const score = Math.round((tt.pass / 6) * 35 + sigPts + (now.step ? STEP[now.step][2] : 0) + ewPts);

  const tags = [];
  if (now.sig) tags.push({ t: SIG[now.sig][0], k: SIG[now.sig][1] });
  else if (recent) tags.push({ t: `${SIG[recent.sig][0]} ${recent.age}H lalu`, k: 'warm' });
  if (now.step) tags.push({ t: STEP[now.step][0], k: STEP[now.step][1] });
  if (tt.pass === 6) tags.push({ t: 'Trend Template ✔', k: 'good' });

  const out = {
    code, name, date: last.date, price: last.close, chg: round(last.change_pct), value: value ?? last.value, avgVal20,
    sig: now.sig || null, step: now.step || null, comp: now.comp ?? null, volRatio: now.volRatio ?? null, maAbove: now.cnt ?? null, recent,
    tt: detail ? tt : { pass: tt.pass, fails: tt.conds.filter(x => !x.pass).map(x => x.t), short: tt.short },
    ew: ew.map(e => (detail ? e : { len: e.len, dir: e.dir, state: e.state, label: e.label, bias: e.bias, age: e.age, retrace: e.fib?.retrace ?? null })),
    ewBull: fresh.filter(e => e.bias > 0).length, ewBear: fresh.filter(e => e.bias < 0).length,
    score, tags,
  };
  if (detail) {
    out.rows = rows.map(r => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
    out.signals = bs.map((x, i) => x && (x.sig || x.step) ? { date: rows[i].date, sig: x.sig, step: x.step } : null).filter(Boolean);
  }
  return out;
}
