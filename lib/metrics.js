// Engine metrik scalping. Semua perhitungan murni (tanpa I/O) supaya gampang dites.

// Fraksi harga (tick size) BEI.
export function tickSize(p) {
  if (p < 200) return 1;
  if (p < 500) return 2;
  if (p < 2000) return 5;
  if (p < 5000) return 10;
  return 25;
}
export const floorTick = x => { const t = tickSize(x); return Math.floor(x / t) * t; };
export const ceilTick = x => { const t = tickSize(x); return Math.ceil(x / t) * t; };

// Batas Auto Reject Atas berdasarkan harga acuan (penutupan sebelumnya).
function araPct(prev) {
  if (prev <= 200) return 0.35;
  if (prev <= 5000) return 0.25;
  return 0.20;
}

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const round = (x, d = 2) => (x == null || !isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export function computeRow({ code, name, marketCap, hist, live, swing }) {
  if (!hist || hist.length < 6) return null;
  const rows = [...hist].sort((a, b) => (a.date < b.date ? -1 : 1));
  let today = rows[rows.length - 1];
  let past = rows.slice(0, -1);
  let isLive = false;

  if (live && live.last_price) {
    if (live.source_date > today.date && live.freq > 0) {
      // Hari baru yang belum masuk histori: bentuk candle parsial dari data realtime.
      past = rows;
      const vol = live.lot * 100;
      today = { date: live.source_date, close: live.last_price, open: null, high: null, low: null,
        value: live.value, volume: vol, freq: live.freq, avg: vol ? live.value / vol : live.last_price, n_foreign: null };
      isLive = true;
    } else if (live.source_date === today.date && live.freq >= (today.freq || 0)) {
      const c = live.last_price;
      today = { ...today, close: c, high: Math.max(today.high ?? c, c), low: Math.min(today.low ?? c, c),
        value: live.value || today.value, volume: live.lot ? live.lot * 100 : today.volume, freq: live.freq || today.freq };
      isLive = true;
    }
  }
  const prev = past[past.length - 1];
  if (!prev?.close) return null;

  const price = today.close;
  const prevClose = prev.close;
  const chg = ((price - prevClose) / prevClose) * 100;
  const p20 = past.slice(-20);
  const avgVal20 = mean(p20.map(r => r.value || 0));
  const value = today.value || 0;
  const rvol = avgVal20 ? value / avgVal20 : 0;

  // ATR 14 dari candle lengkap sebelumnya.
  const trs = [];
  for (let i = Math.max(1, past.length - 14); i < past.length; i++) {
    const r = past[i], pc = past[i - 1].close;
    trs.push(Math.max(r.high - r.low, Math.abs(r.high - pc), Math.abs(r.low - pc)));
  }
  const atr = mean(trs);
  const atrPct = (atr / prevClose) * 100;

  const tick = tickSize(price);
  const tickPct = (tick / price) * 100;
  const hasRange = today.high != null && today.low != null;
  const closePos = hasRange ? (today.high > today.low ? (price - today.low) / (today.high - today.low) : 0.5) : null;
  const vwap = today.avg || null;
  const aboveVwap = vwap ? price >= vwap : null;
  const hi5 = Math.max(...past.slice(-5).map(r => r.high));
  const breakout = price > hi5;
  const fnetVal = today.n_foreign != null && vwap ? today.n_foreign * vwap : null;
  const lotPerTrade = today.freq ? today.volume / 100 / today.freq : null;
  const ara = floorTick(prevClose * (1 + araPct(prevClose)));
  const distAra = ((ara - price) / price) * 100;
  // Termasuk candle hari ini (bisa candle live), bukan hanya histori mentah.
  const closes = [...past.map(r => r.close), price];
  let upStreak = 0;
  for (let i = closes.length - 1; i > 0 && closes[i] > closes[i - 1]; i--) upStreak++;

  // ---- Skor scalping (0–100)
  const sLiq = clamp((Math.log10(Math.max(avgVal20, 1)) - 9) / (Math.log10(5e10) - 9)) * 25; // 1M → 50M
  let sVol;
  if (atrPct < 2) sVol = clamp(atrPct / 2) * 8;
  else if (atrPct < 4) sVol = 8 + ((atrPct - 2) / 2) * 12;
  else if (atrPct <= 8) sVol = 20;
  else sVol = Math.max(8, 20 - (atrPct - 8) * 2); // terlalu liar → risiko
  const sRvol = clamp((rvol - 0.8) / 2.2) * 20;
  const sMom = clamp(chg / 5, -1, 1) * 8 + (closePos ?? 0.5) * 7 + (aboveVwap ? 5 : 0);
  const sCost = clamp((2 - tickPct) / 1.7) * 15;
  let bonus = 0;
  if (breakout) bonus += 5;
  if (fnetVal > 0) bonus += 3;
  if (swing) bonus += 3;
  if (distAra < 2) bonus -= 12; // antri ARA, susah dapat barang / keluar
  if (chg <= -7) bonus -= 5;
  const score = clamp(sLiq + sVol + sRvol + sMom + sCost + bonus, 0, 100);

  // ---- Tag sinyal
  const tags = [];
  if (rvol >= 2) tags.push({ t: `RVOL ${rvol.toFixed(1)}x`, k: 'hot' });
  else if (rvol >= 1.3) tags.push({ t: `Vol naik ${rvol.toFixed(1)}x`, k: 'warm' });
  if (breakout) tags.push({ t: 'Breakout 5H', k: 'good' });
  if (aboveVwap) tags.push({ t: '> VWAP', k: 'good' });
  else if (aboveVwap === false) tags.push({ t: '< VWAP', k: 'bad' });
  if (closePos != null && closePos >= 0.8) tags.push({ t: 'Tutup dekat high', k: 'good' });
  if (fnetVal > 0) tags.push({ t: 'Asing net buy', k: 'good' });
  else if (fnetVal < 0 && Math.abs(fnetVal) > value * 0.1) tags.push({ t: 'Asing net sell', k: 'bad' });
  if (distAra < 2) tags.push({ t: 'Dekat ARA', k: 'warn' });
  if (lotPerTrade != null && lotPerTrade >= 50) tags.push({ t: 'Lot besar', k: 'warm' });
  if (upStreak >= 3) tags.push({ t: `Naik ${upStreak} hari`, k: 'warm' });
  if (tickPct > 1.5) tags.push({ t: 'Fraksi mahal', k: 'warn' });
  if (swing) tags.push({ t: 'Swing: ' + swing.bucket.replace(/^\S+\s/, ''), k: 'info' });

  // ---- Rencana trading scalping (berbasis ATR + minimal tick)
  const entry = price;
  const sl = floorTick(price - Math.max(2 * tick, 0.4 * atr));
  const tp1 = Math.min(ara, ceilTick(price + Math.max(3 * tick, 0.6 * atr)));
  const tp2 = Math.min(ara, ceilTick(price + Math.max(5 * tick, 1.0 * atr)));
  const rr = entry > sl ? (tp1 - entry) / (entry - sl) : null;

  return {
    code, name, marketCap, date: today.date, isLive,
    price, prevClose, chg: round(chg), open: today.open, high: today.high, low: today.low,
    value, avgVal20, rvol: round(rvol), freq: today.freq, volume: today.volume, lotPerTrade: round(lotPerTrade, 1),
    atr: round(atr), atrPct: round(atrPct), tick, tickPct: round(tickPct), closePos: round(closePos),
    vwap: round(vwap), aboveVwap, breakout, fnetVal, ara, distAra: round(distAra), upStreak,
    score: Math.round(score),
    parts: { liq: round(sLiq, 1), vol: round(sVol, 1), rvol: round(sRvol, 1), mom: round(sMom, 1), cost: round(sCost, 1), bonus },
    tags, plan: { entry, sl, tp1, tp2, rr: round(rr) },
    spark: closes.slice(-20),
    swing: swing ? { bucket: swing.bucket, summary: swing.summary, wr: swing.wr_event, potential: swing.potential } : null,
  };
}

// Analisa order flow dari done details (trade terbaru di atas).
export function computeFlow(trades) {
  let buyVal = 0, sellVal = 0, buyLot = 0, sellLot = 0, fNet = 0;
  const brokers = new Map();
  const add = (b, lot, val) => {
    const x = brokers.get(b) || { code: b, lot: 0, val: 0 };
    x.lot += lot; x.val += val; brokers.set(b, x);
  };
  for (const t of trades) {
    const lot = t.qty_num || 0, val = t.value_raw || 0;
    if (t.action === 'BUY') { buyVal += val; buyLot += lot; } else if (t.action === 'SELL') { sellVal += val; sellLot += lot; }
    add(t.buyer, lot, val); add(t.seller, -lot, -val);
    if (t.buyer_type === 'F') fNet += val;
    if (t.seller_type === 'F') fNet -= val;
  }
  const tot = buyVal + sellVal;
  const hakaPct = tot ? (buyVal / tot) * 100 : null;
  const recent = trades.slice(0, Math.min(50, trades.length));
  const rb = recent.filter(t => t.action === 'BUY').reduce((s, t) => s + (t.value_raw || 0), 0);
  const rt = recent.reduce((s, t) => s + (t.action ? t.value_raw || 0 : 0), 0);
  const recentHaka = rt ? (rb / rt) * 100 : null;
  const prices = trades.map(t => t.price_num).filter(Boolean);
  const totLot = trades.reduce((s, t) => s + (t.qty_num || 0), 0);
  const vwap = totLot ? trades.reduce((s, t) => s + t.price_num * t.qty_num, 0) / totLot : null;
  const bl = [...brokers.values()];
  const verdict = hakaPct == null ? 'Tidak ada data'
    : hakaPct >= 60 ? 'Buyer agresif (HAKA dominan)'
    : hakaPct <= 40 ? 'Seller agresif (HAKI dominan)' : 'Seimbang';
  return {
    count: trades.length,
    from: trades[trades.length - 1]?.time, to: trades[0]?.time,
    last: prices[0] ?? null, high: prices.length ? Math.max(...prices) : null, low: prices.length ? Math.min(...prices) : null,
    vwap: vwap && Math.round(vwap * 100) / 100,
    buyVal, sellVal, buyLot, sellLot, hakaPct: hakaPct && Math.round(hakaPct * 10) / 10,
    recentHaka: recentHaka && Math.round(recentHaka * 10) / 10, fNet, verdict,
    topBuyers: bl.filter(b => b.lot > 0).sort((a, b) => b.val - a.val).slice(0, 5),
    topSellers: bl.filter(b => b.lot < 0).sort((a, b) => a.val - b.val).slice(0, 5),
    bigTrades: [...trades].sort((a, b) => b.value_raw - a.value_raw).slice(0, 8)
      .map(t => ({ time: t.time, price: t.price_num, lot: t.qty_num, val: t.value_raw, action: t.action, buyer: t.buyer, seller: t.seller })),
  };
}
