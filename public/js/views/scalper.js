// Menu Scalper — screener intraday dengan skor, plan, live price, dan order flow.
import { $, api, fmtN, fmtRp, cls, sign, scoreColor, esc, toast, app, miniMd, makeChart, disposeChart, candleSeries, eodNote, watchlist, STOCK_MENUS } from '../core.js';

const LIVE_N = 20;
const S = { rows: [], sortK: 'score', sortDir: -1, live: new Set(), autoTimer: null, current: null, chart: null, meta: null, filters: null };

const TEMPLATE = `
  <section class="controls">
    <div class="actions">
      <button id="btnScan" class="btn primary">⟳ Scan ulang</button>
      <button id="btnLive" class="btn" title="Ambil harga realtime untuk N teratas (1 call/saham)">⚡ Update live <span class="mono">Top ${LIVE_N}</span></button>
      <label class="auto"><input type="checkbox" id="autoLive" /> Auto-live
        <select id="autoInt">
          <option value="30">30 dtk</option><option value="60">60 dtk</option>
          <option value="120">2 mnt</option><option value="300" selected>5 mnt</option>
        </select>
      </label>
      <span class="hint" id="costHint"></span>
      <span class="hint" id="scanInfo" style="margin-left:auto"></span>
    </div>
    <div class="filters">
      <input id="fSearch" placeholder="Cari kode…" class="inp" />
      <label>Harga <input id="fPmin" type="number" class="inp n" placeholder="min" /> – <input id="fPmax" type="number" class="inp n" placeholder="max" /></label>
      <label>Value ≥ <input id="fVal" type="number" class="inp n" value="5" step="1" /> M</label>
      <label>ATR% ≥ <input id="fAtr" type="number" class="inp n" value="0" step="0.5" /></label>
      <label>RVOL ≥ <input id="fRvol" type="number" class="inp n" value="0" step="0.1" /></label>
      <label>Skor ≥ <input id="fScore" type="number" class="inp n" value="0" step="5" /></label>
      <label class="chk"><input type="checkbox" id="fVwap" /> &gt; VWAP</label>
      <label class="chk"><input type="checkbox" id="fBo" /> Breakout</label>
      <label class="chk"><input type="checkbox" id="fFor" /> Asing buy</label>
      <label class="chk"><input type="checkbox" id="fAra" checked /> Buang dekat ARA</label>
      <label class="chk"><input type="checkbox" id="fUp" /> Hijau saja</label>
    </div>
  </section>
  <section class="kpis" id="kpis"></section>
  <div class="tablewrap">
    <table id="tbl" class="big">
      <thead><tr>
        <th data-k="rank">#</th><th data-k="code">Saham</th><th data-k="price" class="r">Harga</th><th data-k="chg" class="r">Chg%</th>
        <th data-k="spark">20H</th><th data-k="value" class="r">Value</th>
        <th data-k="rvol" class="r" title="Value hari ini / rata-rata 20 hari">RVOL</th>
        <th data-k="atrPct" class="r" title="Average True Range 14 hari (% harga)">ATR%</th>
        <th data-k="tickPct" class="r" title="Biaya 1 tick (% harga)">Tick%</th>
        <th data-k="freq" class="r">Freq</th>
        <th data-k="closePos" class="r" title="Posisi close di range hari ini (0 = low, 100 = high)">Pos</th>
        <th data-k="fnetVal" class="r">Asing</th><th data-k="score" class="r">Skor</th>
        <th data-k="plan">Plan (SL · TP1 · TP2)</th><th>Sinyal</th>
      </tr></thead>
      <tbody id="tbody"><tr><td colspan="15" class="empty"><span class="spin"></span> Memuat data…</td></tr></tbody>
    </table>
  </div>
  <aside id="drawer" class="drawer" aria-hidden="true">
    <div class="dhead">
      <div><div class="dcode" id="dCode">—</div><div class="dname" id="dName"></div></div>
      <div style="display:flex;gap:6px"><button class="btn small" id="dWatch">☆ Watchlist</button><button class="btn ghost" id="dClose" aria-label="Tutup">✕</button></div>
    </div>
    <div class="dbody" id="dBody"></div>
  </aside>
  <div id="backdrop" class="backdrop"></div>`;

export function mount(el) {
  el.innerHTML = TEMPLATE;
  wire(el);
  if (S.filters) for (const [id, v] of Object.entries(S.filters)) { const i = $('#' + id); if (i) i.type === 'checkbox' ? (i.checked = v) : (i.value = v); }
  setAuto();
  if (S.rows.length) { render(); showInfo(); }
  scan(false);
  return () => {
    clearInterval(S.autoTimer); S.autoTimer = null;
    disposeChart(S.chart); S.chart = null; S.current = null;
    S.filters = Object.fromEntries([...el.querySelectorAll('.filters input')].map(i => [i.id, i.type === 'checkbox' ? i.checked : i.value]));
  };
}

function wire(el) {
  el.querySelectorAll('thead th[data-k]').forEach(th => th.addEventListener('click', () => {
    const k = th.dataset.k;
    if (k === 'spark' || k === 'plan') return;
    const key = k === 'rank' ? 'score' : k;
    if (S.sortK === key) S.sortDir *= -1; else { S.sortK = key; S.sortDir = key === 'code' ? 1 : -1; }
    render();
  }));
  $('#tbody').addEventListener('click', e => { const tr = e.target.closest('tr[data-code]'); if (tr) openDetail(tr.dataset.code); });
  $('.filters', el).addEventListener('input', () => render());
  $('#btnScan').onclick = () => scan(true);
  $('#btnLive').onclick = liveUpdate;
  $('#autoLive').onchange = setAuto;
  $('#autoInt').onchange = setAuto;
  $('#dClose').onclick = closeDetail;
  $('#backdrop').onclick = closeDetail;
  $('#dWatch').onclick = () => { const on = watchlist.toggle(S.current); updWatchBtn(); toast(on ? `${S.current} ditambahkan ke watchlist` : `${S.current} dihapus dari watchlist`); };
  el.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
}

function showInfo() {
  const j = S.meta;
  if (!j) return;
  const note = eodNote(j.date), pending = note ? ` (${note})` : '';
  $('#scanInfo').textContent = `EOD ${j.date}${pending} · ${j.universeCount} saham · ${j.candidateCount} paling likuid · scan ${new Date(j.at).toLocaleTimeString('id-ID')}`;
}

async function scan(force = false) {
  const b = $('#btnScan'); if (!b) return;
  b.disabled = true; b.textContent = '⟳ Scanning…';
  try {
    const j = await api('/api/scan' + (force ? '?force=1' : ''));
    S.meta = j; S.rows = j.rows; S.live.clear(); // baris kembali ke data EOD → tidak ada lagi yang "live"
    if (!$('#tbody')) return;
    showInfo(); render();
  } catch (e) { toast('Gagal scan: ' + e.message, true); }
  finally { if ($('#btnScan')) { b.disabled = false; b.textContent = '⟳ Scan ulang'; } }
}

async function liveUpdate() {
  const codes = filtered().slice(0, LIVE_N).map(r => r.code);
  if (!codes.length || S.liveBusy) return;
  S.liveBusy = true;
  const b = $('#btnLive'); b.disabled = true;
  try {
    const j = await api('/api/live?codes=' + codes.join(','));
    const errs = j.rows.filter(r => r.error);
    for (const r of j.rows) {
      if (r.error) continue;
      const i = S.rows.findIndex(x => x.code === r.code);
      if (i >= 0) S.rows[i] = r;
      S.live.add(r.code);
    }
    if (!$('#tbody')) return;
    render(new Set(j.rows.map(r => r.code)));
    toast(`Live: ${j.rows.length - errs.length} saham diperbarui ${new Date(j.at).toLocaleTimeString('id-ID')}` + (errs.length ? ` (${errs.length} gagal)` : ''));
    if (S.current) openDetail(S.current, true);
  } catch (e) { toast('Gagal update live: ' + e.message, true); }
  finally { S.liveBusy = false; if ($('#btnLive')) b.disabled = false; }
}

function setAuto() {
  clearInterval(S.autoTimer); S.autoTimer = null;
  const on = $('#autoLive').checked;
  const sec = Number($('#autoInt').value);
  $('#costHint').textContent = on ? `≈ ${fmtN(Math.round((3600 / sec) * LIVE_N))} call/jam — hanya jalan saat pasar buka` : `Update live = ${LIVE_N} call`;
  if (!on) return;
  S.autoTimer = setInterval(() => {
    if (app.quota?.remaining != null && app.quota.remaining < 100) {
      $('#autoLive').checked = false; setAuto();
      toast('Auto-live dimatikan: sisa kuota < 100 call', true);
      return;
    }
    // Tab tidak sedang dilihat → jangan habiskan kuota (tiap update = banyak call ke sumber).
    if (document.hidden) return;
    if (app.market?.open === false) { api('/api/status').catch(() => {}); return; }
    liveUpdate();
  }, sec * 1000);
}

function filtered() {
  const v = id => $('#' + id);
  const q = v('fSearch').value.trim().toUpperCase();
  const pmin = Number(v('fPmin').value) || 0, pmax = Number(v('fPmax').value) || Infinity;
  const vmin = (Number(v('fVal').value) || 0) * 1e9;
  const atr = Number(v('fAtr').value) || 0, rvol = Number(v('fRvol').value) || 0, sc = Number(v('fScore').value) || 0;
  const vw = v('fVwap').checked, bo = v('fBo').checked, fo = v('fFor').checked, ara = v('fAra').checked, up = v('fUp').checked;
  const rows = S.rows.filter(r =>
    (!q || r.code.includes(q) || r.name.toUpperCase().includes(q)) &&
    r.price >= pmin && r.price <= pmax && r.avgVal20 >= vmin && r.atrPct >= atr && r.rvol >= rvol && r.score >= sc &&
    (!vw || r.aboveVwap) && (!bo || r.breakout) && (!fo || r.fnetVal > 0) && (!ara || r.distAra >= 2) && (!up || r.chg > 0));
  const k = S.sortK, d = S.sortDir;
  rows.sort((a, b) => {
    const x = a[k], y = b[k];
    if (typeof x === 'string') return x.localeCompare(y) * d;
    return ((x ?? -Infinity) - (y ?? -Infinity)) * d;
  });
  return rows;
}

export function spark(arr, w = 70, h = 22) {
  if (!arr?.length) return '';
  const mn = Math.min(...arr), mx = Math.max(...arr), rg = mx - mn || 1;
  const pts = arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / rg) * (h - 4)).toFixed(1)}`).join(' ');
  const c = arr[arr.length - 1] >= arr[0] ? 'var(--up)' : 'var(--down)';
  return `<svg class="spark" width="${w}" height="${h}"><polyline points="${pts}" fill="none" stroke="${c}" stroke-width="1.5"/></svg>`;
}

export const scoreCell = s => `<span class="score"><span class="bar"><i style="width:${s}%;background:${scoreColor(s)}"></i></span><b style="color:${scoreColor(s)}">${s}</b></span>`;
export const planCell = p => `<span class="sl">${fmtN(p.sl)}</span> · <span class="tp">${fmtN(p.tp1)}</span> · <span class="tp">${fmtN(p.tp2)}</span> <span class="flat">R:R ${fmtN(p.rr, 1)}</span>`;
export const tagsCell = (tags, n = 4) => `<div class="tags">${tags.slice(0, n).map(t => `<span class="tag ${t.k}">${esc(t.t)}</span>`).join('')}</div>`;

function render(flash = new Set()) {
  const rows = filtered();
  document.querySelectorAll('#tbl thead th').forEach(th => {
    const on = th.dataset.k === S.sortK;
    th.classList.toggle('sorted', on);
    th.dataset.dir = on ? (S.sortDir < 0 ? '▼' : '▲') : '';
  });
  renderKpis(rows);
  if (!rows.length) { $('#tbody').innerHTML = `<tr><td colspan="15" class="empty">Tidak ada saham yang lolos filter.</td></tr>`; return; }
  $('#tbody').innerHTML = rows.map((r, i) => `
    <tr data-code="${r.code}" class="${flash.has(r.code) ? 'flash' : ''}">
      <td class="flat">${i + 1}</td>
      <td class="code"><b>${r.code}</b>${r.isLive ? '<span class="live-badge">LIVE</span>' : ''}${watchlist.has(r.code) ? ' <span class="star">★</span>' : ''}<small>${esc(r.name)}</small></td>
      <td class="r">${fmtN(r.price)}</td>
      <td class="r ${cls(r.chg)}">${sign(r.chg)}${fmtN(r.chg, 2)}%</td>
      <td>${spark(r.spark)}</td>
      <td class="r">${fmtRp(r.value)}</td>
      <td class="r ${r.rvol >= 2 ? 'up' : r.rvol < 0.7 ? 'flat' : ''}">${fmtN(r.rvol, 2)}x</td>
      <td class="r">${fmtN(r.atrPct, 1)}%</td>
      <td class="r ${r.tickPct > 1.5 ? 'down' : ''}">${fmtN(r.tickPct, 2)}%</td>
      <td class="r">${fmtN(r.freq)}</td>
      <td class="r">${r.closePos == null ? '—' : Math.round(r.closePos * 100)}</td>
      <td class="r ${cls(r.fnetVal)}">${fmtRp(r.fnetVal)}</td>
      <td class="r">${scoreCell(r.score)}</td>
      <td class="plan">${planCell(r.plan)}</td>
      <td>${tagsCell(r.tags)}</td>
    </tr>`).join('');
}

function renderKpis(rows) {
  const all = S.rows;
  if (!all.length) { $('#kpis').innerHTML = ''; return; }
  const adv = all.filter(r => r.chg > 0).length, dec = all.filter(r => r.chg < 0).length;
  const hot = all.filter(r => r.rvol >= 2).length;
  const top = rows[0];
  const avgScore = rows.length ? rows.reduce((s, r) => s + r.score, 0) / rows.length : 0;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="l">Lolos filter</div><div class="v">${rows.length}<span class="s"> / ${all.length}</span></div><div class="s">rata-rata skor ${fmtN(avgScore, 0)}</div></div>
    <div class="kpi"><div class="l">Breadth (likuid)</div><div class="v"><span class="up">${adv}</span> / <span class="down">${dec}</span></div><div class="s">naik / turun</div></div>
    <div class="kpi"><div class="l">Volume spike (RVOL ≥ 2)</div><div class="v">${hot}</div><div class="s">saham ramai hari ini</div></div>
    <div class="kpi"><div class="l">Kandidat teratas</div><div class="v">${top ? top.code : '—'}</div><div class="s">${top ? `skor ${top.score} · ${sign(top.chg)}${fmtN(top.chg, 2)}%` : ''}</div></div>
    <div class="kpi"><div class="l">Live terpantau</div><div class="v">${S.live.size}</div><div class="s">${app.market?.label || ''}</div></div>`;
}

function updWatchBtn() { $('#dWatch').textContent = watchlist.has(S.current) ? '★ Di watchlist' : '☆ Watchlist'; }

// Kartu metrik + plan dipakai juga oleh menu Analisa Saham.
export function planCard(r) {
  const p = r.plan;
  const pc = x => `${sign(x - p.entry)}${fmtN(((x - p.entry) / p.entry) * 100, 1)}%`;
  return `<div class="card"><h3>Rencana scalping (ATR-based)</h3>
    <div class="planrow">
      <div><span>Entry</span><b>${fmtN(p.entry)}</b></div>
      <div><span>Stop loss</span><b class="down">${fmtN(p.sl)}</b><span>${pc(p.sl)}</span></div>
      <div><span>TP 1</span><b class="up">${fmtN(p.tp1)}</b><span>${pc(p.tp1)}</span></div>
      <div><span>TP 2</span><b class="up">${fmtN(p.tp2)}</b><span>${pc(p.tp2)}</span></div>
    </div>
    <div class="flat" style="margin-top:8px;font-size:11.5px">R:R ${fmtN(p.rr, 2)} · fraksi ${r.tick} (${fmtN(r.tickPct, 2)}%) · ARA ${fmtN(r.ara)} (${fmtN(r.distAra, 1)}% lagi)</div>
  </div>`;
}
export function metricsCard(r) {
  return `<div class="card"><h3>Metrik</h3>
    <div class="grid">
      <div><span>Open / High / Low</span><b>${fmtN(r.open)} / ${fmtN(r.high)} / ${fmtN(r.low)}</b></div>
      <div><span>Prev close</span><b>${fmtN(r.prevClose)}</b></div>
      <div><span>VWAP</span><b class="${r.aboveVwap ? 'up' : 'down'}">${fmtN(r.vwap, 1)}</b></div>
      <div><span>Value hari ini</span><b>${fmtRp(r.value)}</b></div>
      <div><span>Rata2 value 20H</span><b>${fmtRp(r.avgVal20)}</b></div>
      <div><span>RVOL</span><b>${fmtN(r.rvol, 2)}x</b></div>
      <div><span>ATR 14</span><b>${fmtN(r.atr, 1)} (${fmtN(r.atrPct, 2)}%)</b></div>
      <div><span>Frekuensi</span><b>${fmtN(r.freq)}</b></div>
      <div><span>Lot / transaksi</span><b>${fmtN(r.lotPerTrade, 1)}</b></div>
      <div><span>Asing net</span><b class="${cls(r.fnetVal)}">${fmtRp(r.fnetVal)}</b></div>
      <div><span>Market cap</span><b>${fmtRp(r.marketCap)}</b></div>
      <div><span>Posisi close</span><b>${r.closePos == null ? '—' : Math.round(r.closePos * 100) + '%'}</b></div>
    </div>
    <div style="margin-top:10px" class="parts">
      <span>Skor ${r.score}</span><span>Likuiditas ${r.parts.liq}/25</span><span>Volatilitas ${r.parts.vol}/20</span><span>RVOL ${r.parts.rvol}/20</span>
      <span>Momentum ${r.parts.mom}/20</span><span>Biaya tick ${r.parts.cost}/15</span><span>Bonus ${sign(r.parts.bonus)}${r.parts.bonus}</span>
    </div>
    <div class="tags" style="margin-top:10px;max-width:none">${r.tags.map(t => `<span class="tag ${t.k}">${esc(t.t)}</span>`).join('')}</div>
    ${r.swing ? `<div style="margin-top:10px;font-size:12px" class="flat">Screener swing: <b style="color:var(--info)">${esc(r.swing.bucket)}</b> — ${esc(r.swing.summary)}</div>` : ''}
  </div>`;
}

function openDetail(code, refreshOnly = false) {
  const r = S.rows.find(x => x.code === code);
  if (!r) return;
  S.current = code;
  updWatchBtn();
  $('#drawer').classList.add('open'); $('#backdrop').classList.add('open');
  $('#dCode').innerHTML = `${r.code} <span class="${cls(r.chg)}" style="font-size:15px">${fmtN(r.price)} (${sign(r.chg)}${fmtN(r.chg, 2)}%)</span>`;
  $('#dName').textContent = r.name + (r.isLive ? ' · LIVE' : ` · EOD ${r.date}`);
  if (refreshOnly && $('#chart')) return;
  $('#dBody').innerHTML = `
    <div class="links">${STOCK_MENUS.map(([k, t]) => `<a class="btn small" href="#/${k}/${code}">${t} →</a>`).join('')}</div>
    <div class="card"><h3>Grafik harian <span class="flat" id="chartInfo"></span></h3><div id="chart" class="chart"></div></div>
    ${planCard(r)}
    ${metricsCard(r)}
    <div class="card" id="flowCard"><h3>Order flow (done details) <button class="btn small" id="btnFlow">Muat 300 transaksi terakhir · 3 call</button></h3><div id="flow" class="flat">Lihat siapa yang agresif: HAKA vs HAKI, broker dominan, transaksi besar.</div></div>
    <div class="card"><h3>Analisa otomatis <button class="btn small" id="btnAna">Muat · 1 call</button></h3><div id="ana" class="flat">Analisa teknikal + bandarmologi dari IDX Edge PRO.</div></div>`;
  $('#btnFlow').onclick = () => loadFlow(code, $('#flow'), $('#btnFlow'), () => S.current === code);
  $('#btnAna').onclick = () => loadAnalysis(code);
  loadChart(code, r);
}
function closeDetail() {
  S.current = null;
  $('#drawer')?.classList.remove('open'); $('#backdrop')?.classList.remove('open');
  disposeChart(S.chart); S.chart = null;
}

async function loadChart(code, r) {
  try {
    const j = await api('/api/candles?code=' + code);
    if (S.current !== code || !window.LightweightCharts) return;
    disposeChart(S.chart);
    const ch = S.chart = makeChart($('#chart'), 300);
    const { cs, rows } = candleSeries(ch, j.rows, r.isLive ? { date: r.date, close: r.price, volume: r.volume } : null);
    const line = (price, color, title) => cs.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title });
    line(r.plan.sl, '#f45b69', 'SL'); line(r.plan.tp1, '#22d3a6', 'TP1'); line(r.plan.tp2, '#22d3a6', 'TP2');
    ch.timeScale().setVisibleLogicalRange({ from: rows.length - 60, to: rows.length + 2 });
    $('#chartInfo').textContent = `${rows.length} candle`;
  } catch (e) { if (S.current === code && $('#chart')) $('#chart').innerHTML = `<div class="empty">Gagal memuat grafik: ${esc(e.message)}</div>`; }
}

// Order flow dipakai juga oleh menu Analisa Saham.
export async function loadFlow(code, box, b, alive = () => true) {
  b.disabled = true; b.textContent = 'Memuat…';
  try {
    const f = await api('/api/flow?code=' + code + '&pages=3');
    if (!alive()) return;
    const brokerRows = list => list.map(x => `<tr><td><b>${x.code}</b></td><td class="r">${fmtN(Math.abs(x.lot))}</td><td class="r">${fmtRp(Math.abs(x.val))}</td></tr>`).join('');
    box.innerHTML = `
      <div style="display:flex;justify-content:space-between;font-size:12px;gap:8px;flex-wrap:wrap"><span>Tanggal ${f.date} · ${f.count} trx (${f.from || '—'}–${f.to || '—'}) dari ${fmtN(f.totalTrades)}</span><b>${esc(f.verdict)}</b></div>
      <div class="meter"><i style="width:${f.hakaPct ?? 50}%"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:12px;gap:8px;flex-wrap:wrap"><span class="up">HAKA ${fmtN(f.hakaPct, 1)}% · ${fmtRp(f.buyVal)}</span><span>50 trx terakhir: <b class="${f.recentHaka >= 50 ? 'up' : 'down'}">${fmtN(f.recentHaka, 1)}% HAKA</b></span><span class="down">HAKI ${fmtN(f.hakaPct == null ? null : 100 - f.hakaPct, 1)}% · ${fmtRp(f.sellVal)}</span></div>
      <div class="grid" style="margin:12px 0">
        <div><span>Last</span><b>${fmtN(f.last)}</b></div><div><span>Range</span><b>${fmtN(f.low)} – ${fmtN(f.high)}</b></div><div><span>VWAP window</span><b>${fmtN(f.vwap, 1)}</b></div>
        <div><span>Asing net (window)</span><b class="${cls(f.fNet)}">${fmtRp(f.fNet)}</b></div>
      </div>
      <div class="two">
        <div><div class="up" style="font-size:11px;font-weight:700">NET BUYER</div><table class="mini"><tr><th>Broker</th><th class="r">Lot</th><th class="r">Value</th></tr>${brokerRows(f.topBuyers)}</table></div>
        <div><div class="down" style="font-size:11px;font-weight:700">NET SELLER</div><table class="mini"><tr><th>Broker</th><th class="r">Lot</th><th class="r">Value</th></tr>${brokerRows(f.topSellers)}</table></div>
      </div>
      <div style="margin-top:12px;font-size:11px;font-weight:700" class="flat">TRANSAKSI TERBESAR</div>
      <table class="mini"><tr><th>Jam</th><th class="r">Harga</th><th class="r">Lot</th><th class="r">Value</th><th>Aksi</th><th>B / S</th></tr>
        ${f.bigTrades.map(t => `<tr><td>${t.time}</td><td class="r">${fmtN(t.price)}</td><td class="r">${fmtN(t.lot)}</td><td class="r">${fmtRp(t.val)}</td><td class="${t.action === 'BUY' ? 'up' : 'down'}">${t.action === 'BUY' ? 'HAKA' : 'HAKI'}</td><td>${t.buyer} / ${t.seller}</td></tr>`).join('')}
      </table>`;
    b.textContent = 'Refresh';
  } catch (e) { box.textContent = 'Gagal: ' + e.message; b.textContent = 'Coba lagi'; }
  finally { b.disabled = false; }
}

async function loadAnalysis(code) {
  const b = $('#btnAna'); b.disabled = true; b.textContent = 'Memuat…';
  try {
    const a = await api('/api/analysis?code=' + code);
    if (S.current !== code) return;
    $('#ana').innerHTML = `<div class="analysis">${miniMd(a.output || JSON.stringify(a, null, 2))}</div>`;
    b.style.display = 'none';
  } catch (e) { if (S.current !== code || !$('#ana')) return; $('#ana').textContent = 'Gagal: ' + e.message; b.textContent = 'Coba lagi'; b.disabled = false; }
}
