// Menu Bandingkan — performa relatif hingga 6 saham (dinormalisasi ke 0%) + statistik risiko/return.
import { $, api, fmtN, cls, pct, esc, stockPicker, makeChart, disposeChart, loading, errBox, getUniverse } from '../core.js';

const COLORS = ['#22d3a6', '#5aa9ff', '#f5b942', '#b58cff', '#ff6b9d', '#4dd0e1'];
const DEF = ['BBCA', 'BBRI', 'BMRI'];
let range = 120;

function stats(rows) {
  const c = rows.map(r => r.close);
  const rets = c.slice(1).map((v, i) => v / c[i] - 1);
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length);
  let peak = c[0], mdd = 0;
  for (const v of c) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  const total = (c[c.length - 1] / c[0] - 1) * 100;
  return { total, vol: sd * Math.sqrt(250) * 100, mdd: mdd * 100, sharpe: sd ? (mean / sd) * Math.sqrt(250) : 0, up: (rets.filter(x => x > 0).length / rets.length) * 100, rets };
}
function corr(a, b) {
  const n = Math.min(a.length, b.length); a = a.slice(-n); b = b.slice(-n);
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export async function mount(el, { arg }) {
  let codes = (arg ? decodeURIComponent(arg).toUpperCase().split(',') : DEF).filter(c => /^[A-Z0-9]{3,6}$/.test(c)).slice(0, 6);
  let chart = null, alive = true;
  const setHash = () => history.replaceState(null, '', `#/bandingkan/${codes.join(',')}`);

  el.innerHTML = `<div class="page">
    <div class="phead"><div><h2>⚖️ Bandingkan Saham</h2><div class="flat">Hingga 6 saham · harga dinormalisasi ke 0% di awal periode</div></div>
      <div class="toolbar"><div class="vpick" id="cpick"></div>
      <div class="seg" id="crng">${[[120, '6 bln'], [250, '1 thn'], [500, '2 thn']].map(([v, t]) => `<button data-r="${v}" class="${v === range ? 'on' : ''}">${t}</button>`).join('')}</div></div>
    </div>
    <div class="chips" id="chips"></div>
    <div class="card"><div id="cchart" class="chart" style="height:400px"></div></div>
    <div id="cstats"></div>
    <div class="flat" style="font-size:11.5px">Periode 6 bln memakai cache yang sama dengan menu lain; 1 thn / 2 thn = 1 call per saham (di-cache).</div>
  </div>`;
  stockPicker($('#cpick'), { value: '', placeholder: 'Tambah saham…', onPick: c => { if (!codes.includes(c) && codes.length < 6) { codes.push(c); setHash(); load(); } $('#cpick input').value = ''; } });
  $('#crng').onclick = e => { const b = e.target.closest('[data-r]'); if (!b) return; range = Number(b.dataset.r); $('#crng').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); load(); };
  $('#chips').onclick = e => { const b = e.target.closest('[data-rm]'); if (b && codes.length > 1) { codes = codes.filter(c => c !== b.dataset.rm); setHash(); load(); } };

  const load = async () => {
    const u = await getUniverse().catch(() => null);
    const name = c => u?.data.find(s => s.code === c)?.name || '';
    $('#chips').innerHTML = codes.map((c, i) => `<span class="chip" style="border-color:${COLORS[i]}"><i style="background:${COLORS[i]}"></i><b>${c}</b> <small class="flat">${esc(name(c))}</small> <button data-rm="${c}" title="Hapus">✕</button></span>`).join('');
    $('#cstats').innerHTML = loading();
    disposeChart(chart); chart = null;
    try {
      const res = await Promise.all(codes.map(c => api(`/api/candles?code=${c}&limit=${range}`).then(j => ({ c, rows: [...j.rows].sort((a, b) => (a.date < b.date ? -1 : 1)) })).catch(e => ({ c, err: e.message }))));
      if (!alive) return;
      const ok = res.filter(r => !r.err && r.rows.length > 5);
      const start = ok.reduce((m, r) => (r.rows[0].date > m ? r.rows[0].date : m), '0000');
      ok.forEach(r => { r.rows = r.rows.filter(x => x.date >= start); r.st = stats(r.rows); });
      chart = makeChart($('#cchart'), 400, { localization: { priceFormatter: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` } });
      ok.forEach(r => {
        const i = codes.indexOf(r.c), base = r.rows[0].close;
        chart.addLineSeries({ color: COLORS[i], lineWidth: 2, title: r.c, priceLineVisible: false })
          .setData(r.rows.map(x => ({ time: x.date, value: (x.close / base - 1) * 100 })));
      });
      chart.timeScale().fitContent();
      const best = [...ok].sort((a, b) => b.st.total - a.st.total)[0];
      $('#cstats').innerHTML = `
        <div class="two">
          <div class="card"><h3>Statistik periode (sejak ${start})</h3><div class="tablewrap flush"><table class="mini">
            <tr><th>Saham</th><th class="r">Return</th><th class="r">Volatilitas/thn</th><th class="r">Max drawdown</th><th class="r">Sharpe*</th><th class="r">Hari naik</th></tr>
            ${ok.map(r => `<tr><td><i class="dot" style="background:${COLORS[codes.indexOf(r.c)]}"></i><b>${r.c}</b> ${r === best ? '🏆' : ''}</td>
              <td class="r ${cls(r.st.total)}">${pct(r.st.total, 1)}</td><td class="r">${fmtN(r.st.vol, 1)}%</td>
              <td class="r down">${fmtN(r.st.mdd, 1)}%</td><td class="r">${fmtN(r.st.sharpe, 2)}</td><td class="r">${fmtN(r.st.up, 0)}%</td></tr>`).join('')}
          </table></div><div class="flat" style="font-size:11px;margin-top:6px">*Sharpe tanpa risk-free rate, disetahunkan dari return harian.</div></div>
          <div class="card"><h3>Korelasi return harian</h3><div class="tablewrap flush"><table class="mini corr">
            <tr><th></th>${ok.map(r => `<th class="r">${r.c}</th>`).join('')}</tr>
            ${ok.map(a => `<tr><td><b>${a.c}</b></td>${ok.map(b => { const v = corr(a.st.rets, b.st.rets); return `<td class="r" style="background:rgba(90,169,255,${Math.max(0, v) * 0.45})">${fmtN(v, 2)}</td>`; }).join('')}</tr>`).join('')}
          </table></div><div class="flat" style="font-size:11px;margin-top:6px">Mendekati 1 = bergerak searah; mendekati 0 = tidak berhubungan (baik untuk diversifikasi).</div></div>
        </div>
        ${res.filter(r => r.err).map(r => `<div class="down">${r.c}: ${esc(r.err)}</div>`).join('')}`;
    } catch (e) { if (alive) $('#cstats').innerHTML = errBox(e); }
  };
  setHash();
  load();
  return () => { alive = false; disposeChart(chart); };
}
