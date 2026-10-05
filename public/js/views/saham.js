// Menu Analisa Saham — ringkasan 1 saham: harga, grafik + MA, plan, metrik, analisa otomatis, order flow.
import { $, api, fmtN, fmtRp, cls, pct, esc, miniMd, stockHeader, makeChart, disposeChart, candleSeries, loading, errBox, watchlist, toast } from '../core.js';
import { planCard, metricsCard, loadFlow } from './scalper.js';

export async function mount(el, { code }) {
  const body = stockHeader(el, 'saham', code);
  body.innerHTML = loading(`Memuat ${code}…`);
  let chart = null, alive = true;
  const cleanup = () => { alive = false; disposeChart(chart); };

  let q;
  try { q = await api('/api/quote?code=' + code); } catch (e) { body.innerHTML = errBox(e); return cleanup; }
  if (!alive || !el.isConnected) return cleanup; // pengguna sudah pindah menu/saham selagi data dimuat
  const r = q.row;
  if (!r) { body.innerHTML = errBox(new Error('Data histori saham ini belum cukup')); return cleanup; }

  body.innerHTML = `
    <div class="hero">
      <div>
        <div class="hero-code">${r.code} <button class="icon-btn big" id="wbtn" title="Watchlist">${watchlist.has(code) ? '★' : '☆'}</button></div>
        <div class="flat">${esc(r.name)}</div>
      </div>
      <div class="hero-price">
        <div class="hp ${cls(r.chg)}">${fmtN(r.price)}</div>
        <div class="${cls(r.chg)}">${r.price - r.prevClose >= 0 ? '+' : ''}${fmtN(r.price - r.prevClose)} (${pct(r.chg)})</div>
        <div class="flat" style="font-size:11.5px">${r.isLive ? 'LIVE' : 'Penutupan'} ${q.price?.source_date || r.date}${q.price?.freq ? ` · freq ${fmtN(q.price.freq)}` : ''}</div>
      </div>
      <div class="hero-stats">
        <div><span>Market cap</span><b>${fmtRp(r.marketCap)}</b></div>
        <div><span>Value</span><b>${fmtRp(r.value)}</b></div>
        <div><span>Skor scalping</span><b style="color:${r.score >= 70 ? 'var(--up)' : r.score >= 50 ? 'var(--warn)' : 'var(--down)'}">${r.score}</b></div>
        <div><span>Data sejak</span><b>${q.dataAvailable?.start || '—'}</b></div>
      </div>
    </div>
    <div class="split">
      <div class="col">
        <div class="card"><h3>Grafik harian <span class="legend"><i style="background:#f5b942"></i>MA20 <i style="background:#5aa9ff"></i>MA50 <i style="background:#b58cff"></i>MA200</span></h3><div id="chart" class="chart" style="height:380px"></div></div>
        <div class="card"><h3>Analisa otomatis IDX Edge PRO</h3><div id="ana">${loading('Menjalankan mesin analisa…')}</div></div>
      </div>
      <div class="col">
        ${planCard(r)}
        ${metricsCard(r)}
        <div class="card"><h3>Order flow <button class="btn small" id="btnFlow">Muat 300 trx · 3 call</button></h3><div id="flow" class="flat">HAKA vs HAKI, broker dominan, dan transaksi terbesar hari terakhir.</div></div>
      </div>
    </div>`;

  $('#wbtn').onclick = () => { const on = watchlist.toggle(code); $('#wbtn').textContent = on ? '★' : '☆'; toast(`${code} ${on ? 'ditambahkan ke' : 'dihapus dari'} watchlist`); };
  $('#btnFlow').onclick = () => loadFlow(code, $('#flow'), $('#btnFlow'), () => alive);

  api('/api/candles?code=' + code).then(j => {
    if (!alive) return;
    chart = makeChart($('#chart'), 380);
    const p = q.price;
    const { cs, rows } = candleSeries(chart, j.rows, p?.source_date ? { date: p.source_date, close: p.last_price, volume: (p.lot || 0) * 100 } : null);
    const ma = n => rows.map((x, i) => i < n - 1 ? null : { time: x.date, value: rows.slice(i - n + 1, i + 1).reduce((s, y) => s + y.close, 0) / n }).filter(Boolean);
    chart.addLineSeries({ color: '#f5b942', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ma(20));
    chart.addLineSeries({ color: '#5aa9ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ma(50));
    chart.addLineSeries({ color: '#b58cff', lineWidth: 2, priceLineVisible: false, lastValueVisible: false }).setData(ma(200));
    chart.timeScale().setVisibleLogicalRange({ from: rows.length - 130, to: rows.length + 2 });
    cs.createPriceLine({ price: r.plan.sl, color: '#f45b69', lineWidth: 1, lineStyle: 2, title: 'SL' });
    cs.createPriceLine({ price: r.plan.tp1, color: '#22d3a6', lineWidth: 1, lineStyle: 2, title: 'TP1' });
  }).catch(e => { if (alive) $('#chart').innerHTML = errBox(e); });

  api('/api/analysis?code=' + code).then(a => {
    if (alive) $('#ana').innerHTML = `<div class="analysis">${miniMd(a.output || '')}</div>`;
  }).catch(e => { if (alive) $('#ana').innerHTML = errBox(e); });

  return cleanup;
}
