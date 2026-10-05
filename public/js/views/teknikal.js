// Menu Teknikal — screener indikator (trend MA, RSI, MACD, breakout) atas saham paling likuid.
import { $, api, fmtN, fmtRp, cls, pct, esc, loading, errBox, scoreColor, dataDate } from '../core.js';
import { spark } from './scalper.js';

const S = { sortK: 'score', dir: -1, trend: '', sig: '', rsiMin: 0, rsiMax: 100, q: '' };

export async function mount(el) {
  el.innerHTML = `<div class="page">${loading('Menghitung indikator teknikal…')}</div>`;
  const page = $('.page', el);
  let j;
  try { j = await api('/api/tech'); } catch (e) { page.innerHTML = errBox(e); return; }
  const rows = j.rows;
  const sigNames = [...new Set(rows.flatMap(r => r.signals.map(s => s.t)))].sort();
  const count = t => rows.filter(r => r.trend[0] === t).length;

  page.innerHTML = `
    <div class="phead"><div><h2>📐 Screener Teknikal</h2><div class="flat">${dataDate(j.date)} · ${rows.length} saham paling likuid · MA5/20/50, RSI 14, MACD 12/26/9</div></div></div>
    <div class="kpis inline">
      <div class="kpi"><div class="l">Uptrend kuat</div><div class="v up">${count('Uptrend kuat')}</div></div>
      <div class="kpi"><div class="l">Uptrend</div><div class="v up">${count('Uptrend')}</div></div>
      <div class="kpi"><div class="l">Sideways</div><div class="v">${count('Sideways')}</div></div>
      <div class="kpi"><div class="l">Downtrend</div><div class="v down">${count('Downtrend')}</div></div>
      <div class="kpi"><div class="l">RSI rata-rata</div><div class="v">${fmtN(rows.reduce((s, r) => s + r.rsi, 0) / rows.length, 1)}</div></div>
    </div>
    <div class="toolbar">
      <input class="inp" id="tq" placeholder="Cari kode…" value="${esc(S.q)}">
      <label>Trend <select id="tt"><option value="">Semua</option>${['Uptrend kuat', 'Uptrend', 'Sideways', 'Downtrend'].map(t => `<option ${t === S.trend ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Sinyal <select id="ts"><option value="">Semua</option>${sigNames.map(t => `<option ${t === S.sig ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label>RSI <input type="number" class="inp n" id="r1" value="${S.rsiMin}"> – <input type="number" class="inp n" id="r2" value="${S.rsiMax}"></label>
    </div>
    <div class="tablewrap flush"><table class="big" id="tt-tbl">
      <thead><tr>
        <th data-k="code">Saham</th><th data-k="price" class="r">Harga</th><th data-k="chg" class="r">Chg%</th><th>30H</th>
        <th data-k="trend">Trend</th><th data-k="rsi" class="r">RSI</th><th data-k="macdHist" class="r">MACD hist</th>
        <th data-k="ret5" class="r">5H</th><th data-k="ret20" class="r">20H</th><th data-k="ret60" class="r">60H</th>
        <th data-k="distHi" class="r" title="Jarak ke high 120 hari">vs High</th><th data-k="volRatio" class="r">Vol/avg</th>
        <th data-k="score" class="r">Skor</th><th>Sinyal</th>
      </tr></thead><tbody></tbody></table></div>
    <div class="flat" style="font-size:11.5px">Skor teknikal = trend MA (30) + RSI sehat 50–70 (20) + MACD positif (15) + return 20 hari (15) + volume (10) + dekat high (10).</div>`;

  const draw = () => {
    const q = S.q.trim().toUpperCase();
    const list = rows.filter(r => (!q || r.code.includes(q)) && (!S.trend || r.trend[0] === S.trend) &&
      (!S.sig || r.signals.some(s => s.t === S.sig)) && r.rsi >= S.rsiMin && r.rsi <= S.rsiMax);
    const k = S.sortK;
    list.sort((a, b) => (k === 'trend' ? a.trend[0].localeCompare(b.trend[0]) : typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (a[k] ?? -1e18) - (b[k] ?? -1e18)) * S.dir);
    $('#tt-tbl tbody').innerHTML = list.map(r => `
      <tr data-code="${r.code}">
        <td class="code"><b>${r.code}</b><small>${esc(r.name)}</small></td>
        <td class="r">${fmtN(r.price)}</td><td class="r ${cls(r.chg)}">${pct(r.chg)}</td><td>${spark(r.spark)}</td>
        <td><span class="tag ${r.trend[1]}">${r.trend[0]}</span></td>
        <td class="r"><span class="rsi"><i style="left:${r.rsi}%"></i></span> <b class="${r.rsi > 70 ? 'warn' : r.rsi < 30 ? 'info' : ''}">${fmtN(r.rsi, 0)}</b></td>
        <td class="r ${cls(r.macdHist)}">${fmtN(r.macdHist, 1)}</td>
        <td class="r ${cls(r.ret5)}">${pct(r.ret5, 1)}</td><td class="r ${cls(r.ret20)}">${pct(r.ret20, 1)}</td><td class="r ${cls(r.ret60)}">${pct(r.ret60, 1)}</td>
        <td class="r">${pct(r.distHi, 1)}</td><td class="r ${r.volRatio >= 1.5 ? 'up' : ''}">${fmtN(r.volRatio, 2)}x</td>
        <td class="r"><b style="color:${scoreColor(r.score)}">${r.score}</b></td>
        <td><div class="tags">${r.signals.map(s => `<span class="tag ${s.k}">${esc(s.t)}</span>`).join('')}</div></td>
      </tr>`).join('') || '<tr><td colspan="14" class="empty">Tidak ada saham yang cocok.</td></tr>';
    document.querySelectorAll('#tt-tbl th').forEach(th => { const on = th.dataset.k === S.sortK; th.classList.toggle('sorted', on); th.dataset.dir = on ? (S.dir < 0 ? '▼' : '▲') : ''; });
  };
  draw();
  $('#tq').oninput = e => { S.q = e.target.value; draw(); };
  $('#tt').onchange = e => { S.trend = e.target.value; draw(); };
  $('#ts').onchange = e => { S.sig = e.target.value; draw(); };
  $('#r1').oninput = e => { S.rsiMin = Number(e.target.value) || 0; draw(); };
  $('#r2').oninput = e => { S.rsiMax = Number(e.target.value) || 100; draw(); };
  $('#tt-tbl thead').onclick = e => { const th = e.target.closest('th[data-k]'); if (!th) return; if (S.sortK === th.dataset.k) S.dir *= -1; else { S.sortK = th.dataset.k; S.dir = -1; } draw(); };
  $('#tt-tbl tbody').onclick = e => { const tr = e.target.closest('tr[data-code]'); if (tr) location.hash = `#/saham/${tr.dataset.code}`; };
}
