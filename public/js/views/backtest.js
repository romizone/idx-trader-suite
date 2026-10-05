// Menu Backtest — uji strategi sederhana di data harian (hingga 500 hari). Eksekusi di open hari berikutnya.
import { $, api, fmtN, cls, pct, esc, stockHeader, makeChart, disposeChart, candleSeries, loading, errBox } from '../core.js';

const STRATS = {
  ma: { name: 'MA Cross', params: [['fast', 'MA cepat', 10], ['slow', 'MA lambat', 30]] },
  rsi: { name: 'RSI Reversal', params: [['len', 'Periode', 14], ['lo', 'Beli jika RSI <', 30], ['hi', 'Jual jika RSI >', 65]] },
  bo: { name: 'Breakout', params: [['n', 'Beli: tembus high N hari', 20], ['m', 'Jual: tembus low M hari', 10]] },
  macd: { name: 'MACD Cross', params: [] },
};
const S = { strat: 'ma', p: {}, sl: 7, tp: 0, feeB: 0.15, feeS: 0.25, limit: 500 };

const sma = (a, n, i) => (i + 1 < n ? null : a.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n);
function ema(a, n) { const k = 2 / (n + 1), o = []; a.forEach((v, i) => o.push(i ? v * k + o[i - 1] * (1 - k) : v)); return o; }
function rsi(c, n) {
  const o = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= n) { g += u; l += w; if (i === n) { g /= n; l /= n; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } }
    else { g = (g * (n - 1) + u) / n; l = (l * (n - 1) + w) / n; o[i] = l ? 100 - 100 / (1 + g / l) : 100; }
  }
  return o;
}

// Sinyal per bar: 1 = beli, -1 = jual, 0 = tahan.
function signals(rows, strat, p) {
  const c = rows.map(r => r.close), h = rows.map(r => r.high), l = rows.map(r => r.low);
  const sig = Array(rows.length).fill(0);
  if (strat === 'ma') for (let i = 1; i < c.length; i++) {
    const f0 = sma(c, p.fast, i), s0 = sma(c, p.slow, i), f1 = sma(c, p.fast, i - 1), s1 = sma(c, p.slow, i - 1);
    if (f1 == null || s1 == null) continue;
    if (f1 <= s1 && f0 > s0) sig[i] = 1; else if (f1 >= s1 && f0 < s0) sig[i] = -1;
  }
  if (strat === 'rsi') { const r = rsi(c, p.len); for (let i = 1; i < c.length; i++) { if (r[i] == null) continue; if (r[i] < p.lo) sig[i] = 1; else if (r[i] > p.hi) sig[i] = -1; } }
  if (strat === 'bo') for (let i = Math.max(p.n, p.m); i < c.length; i++) {
    if (c[i] > Math.max(...h.slice(i - p.n, i))) sig[i] = 1; else if (c[i] < Math.min(...l.slice(i - p.m, i))) sig[i] = -1;
  }
  if (strat === 'macd') {
    const m = ema(c, 12).map((v, i) => v - ema(c, 26)[i]), s = ema(m, 9);
    for (let i = 27; i < c.length; i++) { const d0 = m[i] - s[i], d1 = m[i - 1] - s[i - 1]; if (d1 <= 0 && d0 > 0) sig[i] = 1; else if (d1 >= 0 && d0 < 0) sig[i] = -1; }
  }
  return sig;
}

function run(rows, sig) {
  const trades = [], equity = [];
  let cash = 100, pos = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (pos) {
      const stop = S.sl > 0 ? pos.entry * (1 - S.sl / 100) : null, take = S.tp > 0 ? pos.entry * (1 + S.tp / 100) : null;
      let exit = null, why = '';
      if (stop && r.low <= stop) { exit = Math.min(r.open, stop); why = 'Stop loss'; }
      else if (take && r.high >= take) { exit = Math.max(r.open, take); why = 'Take profit'; }
      else if (sig[i - 1] === -1) { exit = r.open; why = 'Sinyal jual'; }
      if (exit != null) {
        const ret = (exit * (1 - S.feeS / 100)) / (pos.entry * (1 + S.feeB / 100)) - 1;
        cash = pos.cash * (1 + ret);
        trades.push({ in: pos.date, out: r.date, entry: pos.entry, exit, ret: ret * 100, days: i - pos.i, why });
        pos = null;
      }
    }
    if (!pos && i > 0 && sig[i - 1] === 1) pos = { entry: r.open, date: r.date, i, cash };
    equity.push({ time: r.date, value: pos ? pos.cash * (r.close / pos.entry) * (1 - S.feeB / 100) : cash });
  }
  if (pos) { const last = rows[rows.length - 1]; trades.push({ in: pos.date, out: '(terbuka)', entry: pos.entry, exit: last.close, ret: (last.close / pos.entry - 1) * 100, days: rows.length - 1 - pos.i, why: 'Masih dipegang', open: true }); }
  let peak = 0, mdd = 0;
  for (const e of equity) { peak = Math.max(peak, e.value); mdd = Math.min(mdd, e.value / peak - 1); }
  const closed = trades.filter(t => !t.open), wins = closed.filter(t => t.ret > 0), losses = closed.filter(t => t.ret <= 0);
  const gp = wins.reduce((s, t) => s + t.ret, 0), gl = -losses.reduce((s, t) => s + t.ret, 0);
  const inMkt = trades.reduce((s, t) => s + t.days, 0);
  return {
    trades, equity, total: equity[equity.length - 1].value - 100, bh: (rows[rows.length - 1].close / rows[0].open - 1) * 100,
    mdd: mdd * 100, win: closed.length ? (wins.length / closed.length) * 100 : null,
    avgW: wins.length ? gp / wins.length : null, avgL: losses.length ? -gl / losses.length : null,
    pf: gl ? gp / gl : wins.length ? Infinity : null, exposure: (inMkt / rows.length) * 100, closed: closed.length,
  };
}

export async function mount(el, { code }) {
  const body = stockHeader(el, 'backtest', code);
  let c1 = null, c2 = null, alive = true, rows = null;
  const params = () => STRATS[S.strat].params.map(([k, t, d]) => `<label>${t} <input type="number" class="inp n" data-p="${k}" value="${S.p[S.strat + k] ?? d}"></label>`).join('');
  body.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="bs">${Object.entries(STRATS).map(([k, s]) => `<button data-s="${k}" class="${k === S.strat ? 'on' : ''}">${s.name}</button>`).join('')}</div>
      <span id="bp" class="toolbar">${params()}</span>
    </div>
    <div class="toolbar">
      <label>Stop loss % <input type="number" class="inp n" id="bsl" value="${S.sl}" step="0.5"></label>
      <label>Take profit % <input type="number" class="inp n" id="btp" value="${S.tp}" step="0.5"></label>
      <label>Fee beli % <input type="number" class="inp n" id="bfb" value="${S.feeB}" step="0.01"></label>
      <label>Fee jual % <input type="number" class="inp n" id="bfs" value="${S.feeS}" step="0.01"></label>
      <label>Data <select id="bl"><option value="250">1 thn</option><option value="500" selected>2 thn</option></select></label>
      <span class="hint">0 = nonaktif · 1 call untuk data (di-cache)</span>
    </div>
    <div id="bres">${loading('Memuat data histori…')}</div>`;
  $('#bl').value = String(S.limit);

  const readParams = () => {
    const p = {};
    body.querySelectorAll('[data-p]').forEach(i => { p[i.dataset.p] = Number(i.value); S.p[S.strat + i.dataset.p] = Number(i.value); });
    S.sl = Number($('#bsl').value) || 0; S.tp = Number($('#btp').value) || 0; S.feeB = Number($('#bfb').value) || 0; S.feeS = Number($('#bfs').value) || 0;
    return p;
  };
  const compute = () => {
    if (!rows) return;
    const p = readParams();
    const res = run(rows, signals(rows, S.strat, p));
    disposeChart(c1); disposeChart(c2);
    $('#bres').innerHTML = `
      <div class="kpis inline">
        <div class="kpi"><div class="l">Return strategi</div><div class="v ${cls(res.total)}">${pct(res.total, 1)}</div><div class="s">buy & hold ${pct(res.bh, 1)}</div></div>
        <div class="kpi"><div class="l">Selisih vs buy & hold</div><div class="v ${cls(res.total - res.bh)}">${pct(res.total - res.bh, 1)}</div><div class="s">${rows[0].date} → ${rows[rows.length - 1].date}</div></div>
        <div class="kpi"><div class="l">Win rate</div><div class="v">${res.win == null ? '—' : fmtN(res.win, 0) + '%'}</div><div class="s">${res.closed} trade selesai</div></div>
        <div class="kpi"><div class="l">Rata2 menang / kalah</div><div class="v" style="font-size:15px"><span class="up">${pct(res.avgW, 1)}</span> / <span class="down">${pct(res.avgL, 1)}</span></div><div class="s">profit factor ${res.pf === Infinity ? '∞' : fmtN(res.pf, 2)}</div></div>
        <div class="kpi"><div class="l">Max drawdown</div><div class="v down">${fmtN(res.mdd, 1)}%</div><div class="s">di pasar ${fmtN(res.exposure, 0)}% waktu</div></div>
      </div>
      <div class="card"><h3>Harga & titik entry/exit</h3><div id="bc1" class="chart" style="height:320px"></div></div>
      <div class="card"><h3>Kurva ekuitas (modal awal 100) <span class="legend"><i style="background:#22d3a6"></i>Strategi <i style="background:#7d8aa5"></i>Buy & hold</span></h3><div id="bc2" class="chart" style="height:200px"></div></div>
      <div class="card"><h3>Daftar trade (${res.trades.length})</h3><div class="tablewrap flush"><table class="mini">
        <tr><th>Masuk</th><th>Keluar</th><th class="r">Harga masuk</th><th class="r">Harga keluar</th><th class="r">Hari</th><th class="r">Return (net fee)</th><th>Alasan keluar</th></tr>
        ${res.trades.slice().reverse().map(t => `<tr><td class="mono">${t.in}</td><td class="mono">${t.out}</td><td class="r mono">${fmtN(t.entry)}</td><td class="r mono">${fmtN(t.exit)}</td><td class="r">${t.days}</td><td class="r ${cls(t.ret)}">${pct(t.ret, 2)}</td><td class="flat">${esc(t.why)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Tidak ada sinyal pada periode ini.</td></tr>'}
      </table></div></div>
      <div class="flat" style="font-size:11.5px">Simulasi historis dengan asumsi eksekusi di harga open hari setelah sinyal, tanpa slippage/antrian. Hasil masa lalu tidak menjamin hasil ke depan.</div>`;
    c1 = makeChart($('#bc1'), 320);
    const { cs } = candleSeries(c1, rows);
    cs.setMarkers(res.trades.flatMap(t => [
      { time: t.in, position: 'belowBar', color: '#22d3a6', shape: 'arrowUp', text: 'B' },
      ...(t.open ? [] : [{ time: t.out, position: 'aboveBar', color: t.ret > 0 ? '#5aa9ff' : '#f45b69', shape: 'arrowDown', text: `${t.ret > 0 ? '+' : ''}${t.ret.toFixed(1)}%` }]),
    ]).sort((a, b) => (a.time < b.time ? -1 : 1)));
    c1.timeScale().fitContent();
    c2 = makeChart($('#bc2'), 200);
    c2.addLineSeries({ color: '#7d8aa5', lineWidth: 1, priceLineVisible: false }).setData(rows.map(r => ({ time: r.date, value: (r.close / rows[0].open) * 100 })));
    c2.addAreaSeries({ lineColor: '#22d3a6', topColor: 'rgba(34,211,166,.25)', bottomColor: 'rgba(34,211,166,0)', lineWidth: 2, priceLineVisible: false }).setData(res.equity);
    c2.timeScale().fitContent();
  };
  const load = async () => {
    $('#bres').innerHTML = loading('Memuat data histori…');
    try {
      const j = await api(`/api/candles?code=${code}&limit=${S.limit}`);
      if (!alive) return;
      rows = [...j.rows].sort((a, b) => (a.date < b.date ? -1 : 1));
      compute();
    } catch (e) { if (alive) $('#bres').innerHTML = errBox(e); }
  };
  $('#bs').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; S.strat = b.dataset.s; $('#bs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); $('#bp').innerHTML = params(); compute(); };
  body.addEventListener('change', e => { if (e.target.id === 'bl') { S.limit = Number(e.target.value); load(); } else if (e.target.matches('input')) compute(); });
  load();
  return () => { alive = false; disposeChart(c1); disposeChart(c2); };
}
