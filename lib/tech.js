// Indikator teknikal & analisa aliran dana asing dari data histori harian.

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const round = (x, d = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const asc = hist => [...hist].sort((a, b) => (a.date < b.date ? -1 : 1));
const sma = (arr, n, i = arr.length - 1) => (i + 1 < n ? null : mean(arr.slice(i - n + 1, i + 1)));

function emaSeries(arr, n) {
  const k = 2 / (n + 1), out = [];
  arr.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}
export function rsiSeries(closes, n = 14) {
  const out = new Array(closes.length).fill(null);
  let g = 0, l = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
  }
  return out;
}
export function macdSeries(closes) {
  const e12 = emaSeries(closes, 12), e26 = emaSeries(closes, 26);
  const macd = closes.map((_, i) => e12[i] - e26[i]);
  const signal = emaSeries(macd, 9);
  return { macd, signal, hist: macd.map((m, i) => m - signal[i]) };
}

export function computeTech({ code, name, hist }) {
  if (!hist || hist.length < 55) return null;
  const rows = asc(hist).slice(-120); // semantik "120 hari" tetap walau histori 250
  const c = rows.map(r => r.close), n = c.length - 1, last = rows[n];
  const ma5 = sma(c, 5), ma20 = sma(c, 20), ma50 = sma(c, 50);
  const rsi = rsiSeries(c), { hist: mh, macd } = macdSeries(c);
  const ret = k => (c[n - k] ? ((c[n] - c[n - k]) / c[n - k]) * 100 : null);
  const hi = Math.max(...rows.map(r => r.high)), lo = Math.min(...rows.map(r => r.low));
  const vol20 = mean(rows.slice(-21, -1).map(r => r.volume || 0));
  const volRatio = vol20 ? (last.volume || 0) / vol20 : null;
  const hi20prev = Math.max(...rows.slice(-21, -1).map(r => r.high));

  const crossed = (a, b, days) => {
    for (let i = n; i > n - days && i > 50; i--) {
      const a0 = sma(c, a, i), b0 = sma(c, b, i), a1 = sma(c, a, i - 1), b1 = sma(c, b, i - 1);
      if (a1 <= b1 && a0 > b0) return 'up';
      if (a1 >= b1 && a0 < b0) return 'down';
    }
    return null;
  };
  const cross2050 = crossed(20, 50, 5);
  let macdCross = null;
  for (let i = n; i > n - 3; i--) {
    if (mh[i - 1] <= 0 && mh[i] > 0) { macdCross = 'up'; break; }
    if (mh[i - 1] >= 0 && mh[i] < 0) { macdCross = 'down'; break; }
  }

  let trend;
  if (c[n] > ma5 && ma5 > ma20 && ma20 > ma50) trend = ['Uptrend kuat', 'good'];
  else if (c[n] > ma20 && ma20 > ma50) trend = ['Uptrend', 'good'];
  else if (c[n] < ma20 && ma20 < ma50) trend = ['Downtrend', 'bad'];
  else trend = ['Sideways', 'flat'];

  const signals = [];
  if (cross2050 === 'up') signals.push({ t: 'Golden cross MA20/50', k: 'good' });
  if (cross2050 === 'down') signals.push({ t: 'Death cross MA20/50', k: 'bad' });
  if (macdCross === 'up') signals.push({ t: 'MACD cross naik', k: 'good' });
  if (macdCross === 'down') signals.push({ t: 'MACD cross turun', k: 'bad' });
  if (rsi[n] < 30) signals.push({ t: 'RSI oversold', k: 'warn' });
  if (rsi[n] > 70) signals.push({ t: 'RSI overbought', k: 'warn' });
  if (last.high >= hi) signals.push({ t: 'High baru 120H', k: 'hot' });
  if (c[n] > hi20prev && volRatio > 1.5) signals.push({ t: 'Breakout 20H + volume', k: 'hot' });
  if (ma20 > ma50 && Math.abs(c[n] / ma20 - 1) < 0.02 && ret(5) < 0) signals.push({ t: 'Pullback ke MA20', k: 'info' });

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const score = Math.round(
    ({ 'Uptrend kuat': 30, Uptrend: 22, Sideways: 10, Downtrend: 0 })[trend[0]] +
    (rsi[n] >= 50 && rsi[n] <= 70 ? 20 : rsi[n] > 70 ? 10 : clamp((rsi[n] - 30) / 20) * 12) +
    (mh[n] > 0 ? 15 : 0) +
    clamp((ret(20) + 5) / 20) * 15 +
    clamp(((volRatio || 0) - 0.8) / 1.7) * 10 +
    clamp(1 - Math.abs(c[n] / hi - 1) / 0.2) * 10);

  return {
    code, name, date: last.date, price: c[n], chg: round(last.change_pct),
    ma5: round(ma5), ma20: round(ma20), ma50: round(ma50), rsi: round(rsi[n], 1),
    macd: round(macd[n], 2), macdHist: round(mh[n], 2),
    ret5: round(ret(5)), ret20: round(ret(20)), ret60: round(ret(60)),
    distHi: round((c[n] / hi - 1) * 100), distLo: round((c[n] / lo - 1) * 100), hi, lo,
    volRatio: round(volRatio), value: last.value, trend, signals, score,
    spark: c.slice(-30),
  };
}

export function computeForeign({ code, name, hist }) {
  if (!hist || hist.length < 21) return null;
  const rows = asc(hist);
  const f = rows.map(r => (r.n_foreign || 0) * (r.avg || r.close));
  const n = f.length - 1, last = rows[n];
  const sum = k => f.slice(-k).reduce((s, x) => s + x, 0);
  let streak = 0;
  const sgn = Math.sign(f[n]);
  for (let i = n; i >= 0 && Math.sign(f[i]) === sgn && sgn !== 0; i--) streak++;
  const part = r => (r.volume ? ((r.f_buy || 0) + (r.f_sell || 0)) / (2 * r.volume) * 100 : null);
  let cum = 0;
  const cum20 = f.slice(-20).map(x => (cum += x));
  return {
    code, name, date: last.date, price: last.close, chg: round(last.change_pct), value: last.value,
    today: f[n], d5: sum(5), d20: sum(20), d60: sum(Math.min(60, f.length)),
    streak: streak * sgn, part: round(part(last), 1), part20: round(mean(rows.slice(-20).map(part).filter(x => x != null)), 1),
    ret20: rows[n - 20] ? round((last.close / rows[n - 20].close - 1) * 100) : null,
    spark: cum20,
  };
}

// Screener SwingMA200: posisi harga terhadap MA200 harian + konteks trend.
export function computeMA200({ code, name, hist, value }) {
  if (!hist || hist.length < 200) return null;
  const rows = asc(hist);
  const c = rows.map(r => r.close), n = c.length - 1, last = rows[n];
  const ma200 = sma(c, 200), ma50 = sma(c, 50), ma20 = sma(c, 20);
  const ma200prev = n >= 219 ? sma(c, 200, n - 20) : sma(c, 200, 199);
  const slope = ((ma200 - ma200prev) / ma200prev) * 100; // perubahan MA200 ~20 hari
  const dist = (c[n] / ma200 - 1) * 100;
  // Hari berturut-turut close di atas MA200 (dihitung selama MA200 tersedia).
  let above = 0;
  for (let i = n; i >= 199 && c[i] > sma(c, 200, i); i--) above++;
  // Jarak terdekat ke MA200 dalam 10 hari terakhir (deteksi pantulan/retest).
  let minDist10 = Infinity;
  for (let i = Math.max(199, n - 9); i <= n; i++) minDist10 = Math.min(minDist10, (rows[i].low / sma(c, 200, i) - 1) * 100);
  const rsi = rsiSeries(c)[n];
  const ret = k => (c[n - k] ? ((c[n] - c[n - k]) / c[n - k]) * 100 : null);
  const avgVal20 = mean(rows.slice(-20).map(r => r.value || 0));
  const vol20 = mean(rows.slice(-21, -1).map(r => r.volume || 0));

  const tags = [];
  if (slope > 0) tags.push({ t: 'MA200 naik', k: 'good' }); else tags.push({ t: 'MA200 turun', k: 'bad' });
  if (ma50 > ma200) tags.push({ t: 'MA50 > MA200', k: 'good' });
  if (above > 0 && above <= 10) tags.push({ t: `Baru tembus MA200 (${above}H)`, k: 'hot' });
  if (dist > 0 && dist <= 3) tags.push({ t: 'Dekat MA200', k: 'info' });
  if (minDist10 <= 1 && dist > 0) tags.push({ t: 'Retest MA200', k: 'info' });
  if (c[n] > ma20) tags.push({ t: '> MA20', k: 'good' });
  if (rsi < 40) tags.push({ t: 'RSI rendah', k: 'warn' });
  if (rsi > 70) tags.push({ t: 'RSI overbought', k: 'warn' });

  // Skor setup swing: dekat MA200 + MA200 naik + struktur MA sehat + likuid.
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const score = Math.round(
    (dist > 0 ? clamp(1 - dist / 12) * 30 : 0) +
    clamp((slope + 1) / 4) * 25 +
    (ma50 > ma200 ? 15 : 0) + (c[n] > ma20 ? 10 : 0) +
    (rsi >= 40 && rsi <= 65 ? 10 : 4) +
    clamp((Math.log10(Math.max(avgVal20, 1)) - 9) / 1.7) * 10);

  return {
    code, name, date: last.date, price: c[n], chg: round(last.change_pct),
    ma200: round(ma200), ma50: round(ma50), ma20: round(ma20), dist: round(dist), slope: round(slope),
    above, aboveCapped: above > 0 && above === n - 198, minDist10: round(minDist10), rsi: round(rsi, 1), ret20: round(ret(20)), ret60: round(ret(60)),
    avgVal20, volRatio: round(vol20 ? (last.volume || 0) / vol20 : null), value: value ?? last.value,
    tags, score, spark: c.slice(-60), sparkMa: c.slice(-60).map((_, i) => round(sma(c, 200, n - 59 + i))),
  };
}
