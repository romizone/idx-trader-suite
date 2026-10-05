// Menu Bandarmologi — broker summary (rentang tanggal & flow) + tren akumulasi broker historis.
import { $, api, fmtN, fmtRp, cls, esc, stockHeader, makeChart, disposeChart, loading, errBox, getUniverse, subDate } from '../core.js';

const RANGES = [['1H', 0], ['1M', 6], ['1B', 30], ['3B', 91], ['6B', 182]];
const COLORS = ['#22d3a6', '#5aa9ff', '#b58cff', '#f45b69', '#ff9f43', '#f5b942', '#4dd0e1', '#ff6b9d', '#9ccc65', '#90a4ae'];
const S = { range: 0, flow: 'all' };

export async function mount(el, { code }) {
  const body = stockHeader(el, 'bandar', code);
  let chart = null, alive = true;
  const u = await getUniverse().catch(() => null);
  const end0 = u?.date || new Date().toISOString().slice(0, 10);
  let start = subDate(end0, RANGES[S.range][1]), end = end0;

  body.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="rng">${RANGES.map(([t], i) => `<button class="${i === S.range ? 'on' : ''}" data-i="${i}">${t}</button>`).join('')}</div>
      <label>Dari <input type="date" class="inp" id="d1" value="${start}"></label>
      <label>s/d <input type="date" class="inp" id="d2" value="${end}"></label>
      <div class="seg" id="flw">${[['all', 'Semua'], ['F', 'Asing'], ['D', 'Domestik']].map(([k, t]) => `<button class="${k === S.flow ? 'on' : ''}" data-f="${k}">${t}</button>`).join('')}</div>
      <button class="btn primary" id="go">Terapkan</button>
      <span class="hint">1 call per kombinasi (di-cache)</span>
    </div>
    <div id="bsum">${loading()}</div>
    <div class="card"><h3>Tren akumulasi broker (kumulatif net value) <span class="legend" id="acclegend"></span></h3><div id="acc" class="chart" style="height:340px">${loading()}</div></div>`;

  const loadSummary = async () => {
    const box = $('#bsum');
    box.innerHTML = loading('Memuat broker summary…');
    try {
      const p = new URLSearchParams({ code, start_date: start, end_date: end });
      if (S.flow !== 'all') p.set('flow', S.flow);
      const j = await api('/api/broker-summary?' + p);
      if (alive) box.innerHTML = summaryHtml(j);
    } catch (e) { if (alive) box.innerHTML = errBox(e); }
  };

  const loadAccum = async () => {
    const box = $('#acc');
    disposeChart(chart); chart = null;
    box.innerHTML = loading('Memuat tren akumulasi…');
    try {
      const p = new URLSearchParams({ code, top: '3' });
      if (RANGES[S.range]?.[1] >= 30 || S.range === -1) { p.set('start_date', start); p.set('end_date', end); }
      const [j, c] = await Promise.all([api('/api/broker-accum?' + p), api('/api/candles?code=' + code).catch(() => null)]);
      if (!alive) return;
      box.innerHTML = '';
      if (!j.series?.length) { box.innerHTML = '<div class="empty">Tidak ada data akumulasi.</div>'; return; }
      chart = makeChart(box, 340, { leftPriceScale: { visible: true, borderColor: '#1c2740' } });
      const legend = [];
      j.series.forEach((s, i) => {
        const col = COLORS[i % COLORS.length];
        const ls = chart.addLineSeries({ color: col, lineWidth: 2, priceLineVisible: false, title: s.broker_code, priceFormat: { type: 'custom', formatter: v => fmtRp(v) } });
        ls.setData(s.points.map(pt => ({ time: pt.date, value: pt.cum_nval })));
        const last = s.points[s.points.length - 1]?.cum_nval;
        legend.push(`<i style="background:${col}"></i>${s.broker_code} <span class="${cls(last)}">${fmtRp(last)}</span>`);
      });
      if (c?.rows) {
        const from = j.start_date;
        const px = chart.addLineSeries({ color: 'rgba(219,228,243,.45)', lineWidth: 1, lineStyle: 2, priceScaleId: 'left', priceLineVisible: false, lastValueVisible: false, title: 'Harga' });
        px.setData([...c.rows].filter(x => x.date >= from).sort((a, b) => (a.date < b.date ? -1 : 1)).map(x => ({ time: x.date, value: x.close })));
        legend.push(`<i style="background:rgba(219,228,243,.45)"></i>Harga (kiri)`);
      }
      chart.timeScale().fitContent();
      $('#acclegend').innerHTML = legend.join(' ');
    } catch (e) { if (alive) box.innerHTML = errBox(e); }
  };

  $('#rng').onclick = e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    S.range = Number(b.dataset.i);
    start = subDate(end0, RANGES[S.range][1]); end = end0;
    $('#d1').value = start; $('#d2').value = end;
    $('#rng').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    loadSummary(); loadAccum();
  };
  $('#flw').onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    S.flow = b.dataset.f;
    $('#flw').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    loadSummary();
  };
  $('#go').onclick = () => {
    start = $('#d1').value; end = $('#d2').value;
    S.range = -1; $('#rng').querySelectorAll('button').forEach(x => x.classList.remove('on'));
    loadSummary(); loadAccum();
  };

  loadSummary(); loadAccum();
  return () => { alive = false; disposeChart(chart); };
}

function bandarSignal(brokers) {
  const buys = brokers.filter(b => b.nval > 0).sort((a, b) => b.nval - a.nval);
  const sells = brokers.filter(b => b.nval < 0).sort((a, b) => a.nval - b.nval);
  const top = (arr, n) => arr.slice(0, n).reduce((s, b) => s + Math.abs(b.nval), 0);
  const calc = n => { const b = top(buys, n), s = top(sells, n); return b + s ? (b - s) / (b + s) : 0; };
  const r3 = calc(3);
  const label = r3 >= 0.5 ? ['Big Accumulation', 'up'] : r3 >= 0.15 ? ['Accumulation', 'up'] : r3 <= -0.5 ? ['Big Distribution', 'down'] : r3 <= -0.15 ? ['Distribution', 'down'] : ['Neutral', 'flat'];
  return { r1: calc(1), r3, r5: calc(5), label, buys, sells };
}

function summaryHtml(j) {
  const brokers = j.brokers || [];
  if (!brokers.length) return '<div class="card empty">Tidak ada transaksi broker pada rentang ini.</div>';
  const sig = bandarSignal(brokers);
  const totB = brokers.reduce((s, b) => s + (b.bval || 0), 0);
  const gauge = v => `<div class="gauge"><i style="left:${(v + 1) * 50}%"></i></div><span class="${cls(v)}">${v >= 0 ? '+' : ''}${fmtN(v * 100, 0)}</span>`;
  const lv = j.broker_levels || [];
  const netRow = (b, side) => `<tr><td><b>${b.broker_code}</b> <small class="flat">${esc(b.broker_name || '')}</small></td>
    <td class="r ${side}">${fmtRp(Math.abs(b.nval))}</td><td class="r">${fmtN(Math.abs(b.nvol) / 100)}</td>
    <td class="r">${fmtN(side === 'up' ? b.bval / (b.bvol || 1) : b.sval / (b.svol || 1), 0)}</td></tr>`;
  return `
    <div class="kpis inline">
      <div class="kpi"><div class="l">Sinyal bandar (top 3)</div><div class="v ${sig.label[1]}">${sig.label[0]}</div><div class="s">${j.broker_start_date} s/d ${j.broker_end_date} · flow ${j.flow}</div></div>
      <div class="kpi"><div class="l">Top 1 / 3 / 5</div><div class="gauges"><div>T1 ${gauge(sig.r1)}</div><div>T3 ${gauge(sig.r3)}</div><div>T5 ${gauge(sig.r5)}</div></div></div>
      <div class="kpi"><div class="l">Total nilai beli</div><div class="v">${fmtRp(totB)}</div><div class="s">${brokers.length} broker aktif</div></div>
      <div class="kpi"><div class="l">Top net buyer</div><div class="v up">${sig.buys[0]?.broker_code || '—'}</div><div class="s">${fmtRp(sig.buys[0]?.nval)}</div></div>
      <div class="kpi"><div class="l">Top net seller</div><div class="v down">${sig.sells[0]?.broker_code || '—'}</div><div class="s">${fmtRp(sig.sells[0]?.nval)}</div></div>
    </div>
    <div class="two">
      <div class="card"><h3>Net buyer</h3><table class="mini"><tr><th>Broker</th><th class="r">Net value</th><th class="r">Net lot</th><th class="r">Avg beli</th></tr>${sig.buys.slice(0, 10).map(b => netRow(b, 'up')).join('')}</table></div>
      <div class="card"><h3>Net seller</h3><table class="mini"><tr><th>Broker</th><th class="r">Net value</th><th class="r">Net lot</th><th class="r">Avg jual</th></tr>${sig.sells.slice(0, 10).map(b => netRow(b, 'down')).join('')}</table></div>
    </div>
    <div class="card"><h3>Broker summary (gross)</h3>
      <div class="tablewrap flush"><table class="mini bsum">
        <tr><th>#</th><th>Buyer</th><th class="r">B.Val</th><th class="r">B.Lot</th><th class="r">B.Avg</th><th class="sepcol"></th><th>Seller</th><th class="r">S.Val</th><th class="r">S.Lot</th><th class="r">S.Avg</th></tr>
        ${lv.map((l, i) => `<tr><td class="flat">${i + 1}</td>
          <td class="up"><b>${l.buy?.broker_code || ''}</b></td><td class="r">${fmtRp(l.buy?.bval)}</td><td class="r">${fmtN((l.buy?.bvol || 0) / 100)}</td><td class="r">${fmtN(l.buy?.bavg, 0)}</td>
          <td class="sepcol"></td>
          <td class="down"><b>${l.sell?.broker_code || ''}</b></td><td class="r">${fmtRp(l.sell?.sval)}</td><td class="r">${fmtN((l.sell?.svol || 0) / 100)}</td><td class="r">${fmtN(l.sell?.savg, 0)}</td></tr>`).join('')}
      </table></div>
    </div>`;
}
