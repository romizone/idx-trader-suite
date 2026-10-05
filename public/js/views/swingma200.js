// Menu SwingMA200 — saham di atas MA200 harian, tetapi harga masih ≤ X% (default 12%) di atas MA200.
import { $, api, fmtN, fmtRp, cls, pct, esc, loading, errBox, scoreColor, eodNote, makeChart, disposeChart, candleSeries, watchlist, toast } from '../core.js';

const S = { maxDist: 12, minDist: 0, top: 120, rising: false, golden: false, minVal: 1, q: '', sortK: 'dist', dir: 1, sel: null };

// Sparkline harga (garis) + MA200 (putus-putus) dalam satu SVG.
function sparkMa(p, m, w = 110, h = 28) {
  const all = [...p, ...m.filter(x => x != null)];
  const mn = Math.min(...all), mx = Math.max(...all), rg = mx - mn || 1;
  const pt = (arr) => arr.map((v, i) => v == null ? null : `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - mn) / rg) * (h - 4)).toFixed(1)}`).filter(Boolean).join(' ');
  return `<svg class="spark" width="${w}" height="${h}"><polyline points="${pt(m)}" fill="none" stroke="#f5b942" stroke-width="1" stroke-dasharray="3 2"/><polyline points="${pt(p)}" fill="none" stroke="${p[p.length - 1] >= p[0] ? 'var(--up)' : 'var(--down)'}" stroke-width="1.5"/></svg>`;
}

// Bar posisi harga: 0% (MA200) sampai batas atas.
function distBar(d, max) {
  const x = Math.max(0, Math.min(100, (d / max) * 100));
  return `<span class="distbar" title="${pct(d)} dari MA200"><i style="left:${x}%"></i></span>`;
}

export async function mount(el) {
  let chart = null, alive = true, data = null;
  el.innerHTML = `<div class="page">
    <div class="phead">
      <div><h2>📏 SwingMA200</h2><div class="flat">Harga <b>di atas MA200 harian</b> tetapi masih <b>≤ <span id="mxl">${S.maxDist}</span>% di atas MA200</b> — area pullback/awal trend untuk swing</div></div>
    </div>
    <div class="toolbar">
      <input class="inp" id="mq" placeholder="Cari kode…" value="${esc(S.q)}">
      <label>Jarak dari MA200 <input type="number" class="inp n" id="mmin" value="${S.minDist}" step="0.5"> % s/d <input type="number" class="inp n" id="mmax" value="${S.maxDist}" step="0.5"> %</label>
      <label>Nilai rata2 ≥ <input type="number" class="inp n" id="mval" value="${S.minVal}" step="1"> M</label>
      <label class="chk"><input type="checkbox" id="mris" ${S.rising ? 'checked' : ''}> MA200 naik saja</label>
      <label class="chk"><input type="checkbox" id="mgc" ${S.golden ? 'checked' : ''}> MA50 &gt; MA200</label>
      <label>Universe <select id="mtop">${[[60, '60 paling likuid'], [120, '120 paling likuid'], [200, '200 paling likuid']].map(([v, t]) => `<option value="${v}" ${v === S.top ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <div id="mbody">${loading('Menghitung MA200 harian…')}</div>
  </div>`;

  const load = async () => {
    $('#mbody').innerHTML = loading(`Menghitung MA200 untuk ${S.top} saham…`);
    try {
      data = await api('/api/ma200?top=' + S.top);
      if (alive) draw();
    } catch (e) { if (alive) $('#mbody').innerHTML = errBox(e); }
  };

  const filtered = () => {
    const q = S.q.trim().toUpperCase();
    const list = data.rows.filter(r => r.dist > S.minDist && r.dist <= S.maxDist && r.avgVal20 >= S.minVal * 1e9 &&
      (!S.rising || r.slope > 0) && (!S.golden || r.ma50 > r.ma200) && (!q || r.code.includes(q) || r.name.toUpperCase().includes(q)));
    const k = S.sortK;
    return list.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (a[k] ?? -1e18) - (b[k] ?? -1e18)) * S.dir);
  };

  const draw = () => {
    const rows = data.rows, list = filtered();
    const above = rows.filter(r => r.dist > 0).length;
    // Histogram jarak ke MA200 seluruh universe.
    const bins = [];
    for (let b = -30; b < 60; b += 3) bins.push({ b, n: rows.filter(r => r.dist >= b && r.dist < b + 3).length });
    const mx = Math.max(...bins.map(x => x.n)) || 1;
    $('#mbody').innerHTML = `
      <div class="kpis inline">
        <div class="kpi"><div class="l">Lolos kriteria</div><div class="v up">${list.length}</div><div class="s">dari ${rows.length} saham dengan ≥ 200 hari data</div></div>
        <div class="kpi"><div class="l">Di atas MA200</div><div class="v">${above}</div><div class="s">${fmtN(above / rows.length * 100, 0)}% universe · breadth jangka panjang</div></div>
        <div class="kpi"><div class="l">Di bawah MA200</div><div class="v down">${rows.length - above}</div><div class="s">tidak masuk kriteria</div></div>
        <div class="kpi"><div class="l">Dekat MA200 (0–3%)</div><div class="v">${rows.filter(r => r.dist > 0 && r.dist <= 3).length}</div><div class="s">area retest paling rapat</div></div>
        <div class="kpi"><div class="l">Data</div><div class="v" style="font-size:15px">${data.date}</div><div class="s">${eodNote(data.date) ? `<span class="warn">${eodNote(data.date)}</span> · ` : ''}${data.scanned} di-scan · ${data.noData} histori &lt; 200 hari</div></div>
      </div>
      <div class="card"><h3>Sebaran jarak harga ke MA200 <span class="legend"><i style="background:var(--accent)"></i>zona kriteria</span></h3>
        <div class="hist">${bins.map(x => `<div class="hb ${x.b + 3 > S.minDist && x.b < S.maxDist ? 'in' : ''}" title="${x.b}% s/d ${x.b + 3}%: ${x.n} saham"><i style="height:${(x.n / mx) * 100}%"></i><span>${x.b % 15 === 0 ? x.b + '%' : ''}</span></div>`).join('')}</div>
      </div>
      <div id="mprev"></div>
      <div class="tablewrap flush"><table class="big" id="mt">
        <thead><tr>
          <th data-k="code">Saham</th><th data-k="price" class="r">Harga</th><th data-k="chg" class="r">Chg%</th><th>60H vs MA200</th>
          <th data-k="ma200" class="r">MA200</th><th data-k="dist" class="r">Jarak MA200</th><th>Posisi</th>
          <th data-k="slope" class="r" title="Perubahan MA200 dalam ~20 hari">Slope MA200</th><th data-k="ma50" class="r">MA50</th>
          <th data-k="above" class="r" title="Hari berturut-turut close di atas MA200">Hari &gt; MA200</th><th data-k="rsi" class="r">RSI</th>
          <th data-k="ret20" class="r">20H</th><th data-k="avgVal20" class="r">Value rata2</th><th data-k="score" class="r">Skor</th><th>Sinyal</th><th></th>
        </tr></thead>
        <tbody>${list.map(r => `
          <tr data-code="${r.code}" class="${S.sel === r.code ? 'sel' : ''}">
            <td class="code"><b>${r.code}</b><small>${esc(r.name)}</small></td>
            <td class="r">${fmtN(r.price)}</td><td class="r ${cls(r.chg)}">${pct(r.chg)}</td>
            <td>${sparkMa(r.spark, r.sparkMa)}</td>
            <td class="r">${fmtN(r.ma200, 0)}</td>
            <td class="r"><b class="${r.dist <= 3 ? 'info' : ''}">+${fmtN(r.dist, 2)}%</b></td>
            <td>${distBar(r.dist, S.maxDist)}</td>
            <td class="r ${cls(r.slope)}">${pct(r.slope, 2)}</td>
            <td class="r ${r.ma50 > r.ma200 ? 'up' : 'down'}">${fmtN(r.ma50, 0)}</td>
            <td class="r" title="${r.aboveCapped ? 'Batas data 250 hari — bisa lebih lama' : ''}">${r.above}${r.aboveCapped ? '+' : ''}</td>
            <td class="r ${r.rsi > 70 ? 'warn' : r.rsi < 40 ? 'info' : ''}">${fmtN(r.rsi, 0)}</td>
            <td class="r ${cls(r.ret20)}">${pct(r.ret20, 1)}</td>
            <td class="r">${fmtRp(r.avgVal20)}</td>
            <td class="r"><b style="color:${scoreColor(r.score)}">${r.score}</b></td>
            <td><div class="tags">${r.tags.map(t => `<span class="tag ${t.k}">${esc(t.t)}</span>`).join('')}</div></td>
            <td><button class="icon-btn" data-w="${r.code}" title="Watchlist">${watchlist.has(r.code) ? '★' : '☆'}</button></td>
          </tr>`).join('') || `<tr><td colspan="16" class="empty">Tidak ada saham yang memenuhi kriteria.</td></tr>`}</tbody>
      </table></div>
      <div class="flat" style="font-size:11.5px">Skor setup = kedekatan ke MA200 (30) + kemiringan MA200 (25) + MA50 &gt; MA200 (15) + harga &gt; MA20 (10) + RSI 40–65 (10) + likuiditas (10). Klik baris untuk melihat grafik.</div>`;
    document.querySelectorAll('#mt th').forEach(th => { const on = th.dataset.k === S.sortK; th.classList.toggle('sorted', on); th.dataset.dir = on ? (S.dir < 0 ? '▼' : '▲') : ''; });
    $('#mxl').textContent = S.maxDist;
    if (S.sel) preview(S.sel);
  };

  const preview = async code => {
    const r = data.rows.find(x => x.code === code);
    if (!r) return;
    disposeChart(chart); chart = null;
    $('#mprev').innerHTML = `<div class="card"><h3>${r.code} · ${esc(r.name)} — harga ${fmtN(r.price)}, MA200 ${fmtN(r.ma200, 0)} (+${fmtN(r.dist, 2)}%)
      <span class="links"><a class="btn small" href="#/saham/${code}">Analisa →</a><a class="btn small" href="#/bandar/${code}">Bandar →</a><a class="btn small" href="#/backtest/${code}">Backtest →</a><button class="btn small" id="mclose">✕</button></span></h3>
      <div class="legend" style="margin-bottom:6px"><i style="background:#5aa9ff"></i>MA50 <i style="background:#f5b942"></i>MA200 <i style="background:rgba(245,185,66,.4)"></i>Batas +${S.maxDist}%</div>
      <div id="mchart" class="chart" style="height:340px"></div></div>`;
    $('#mclose').onclick = () => { S.sel = null; disposeChart(chart); chart = null; $('#mprev').innerHTML = ''; document.querySelectorAll('#mt tr.sel').forEach(t => t.classList.remove('sel')); };
    try {
      const j = await api(`/api/candles?code=${code}&limit=500`);
      if (!alive || S.sel !== code) return;
      chart = makeChart($('#mchart'), 340);
      const { rows } = candleSeries(chart, j.rows);
      // (500 hari agar garis MA200 terlihat penuh pada 120+ candle terakhir)
      const c = rows.map(x => x.close);
      const ma = n => rows.map((x, i) => i < n - 1 ? null : { time: x.date, value: c.slice(i - n + 1, i + 1).reduce((s, y) => s + y, 0) / n }).filter(Boolean);
      const m200 = ma(200);
      chart.addLineSeries({ color: '#5aa9ff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ma(50));
      chart.addLineSeries({ color: '#f5b942', lineWidth: 2, priceLineVisible: false, title: 'MA200' }).setData(m200);
      chart.addLineSeries({ color: 'rgba(245,185,66,.4)', lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false })
        .setData(m200.map(p => ({ time: p.time, value: p.value * (1 + S.maxDist / 100) })));
      chart.timeScale().setVisibleLogicalRange({ from: rows.length - 120, to: rows.length + 2 });
    } catch (e) { if (alive) $('#mchart').innerHTML = errBox(e); }
  };

  const num = (id, key, def) => $(id).addEventListener('input', e => { S[key] = e.target.value === '' ? def : Number(e.target.value); if (data) draw(); });
  num('#mmin', 'minDist', 0); num('#mmax', 'maxDist', 12); num('#mval', 'minVal', 0);
  $('#mq').oninput = e => { S.q = e.target.value; if (data) draw(); };
  $('#mris').onchange = e => { S.rising = e.target.checked; if (data) draw(); };
  $('#mgc').onchange = e => { S.golden = e.target.checked; if (data) draw(); };
  $('#mtop').onchange = e => { S.top = Number(e.target.value); load(); };
  el.addEventListener('click', e => {
    const w = e.target.closest('[data-w]');
    if (w) { e.stopPropagation(); const on = watchlist.toggle(w.dataset.w); w.textContent = on ? '★' : '☆'; toast(`${w.dataset.w} ${on ? 'ditambahkan ke' : 'dihapus dari'} watchlist`); return; }
    const th = e.target.closest('#mt th[data-k]');
    if (th) { if (S.sortK === th.dataset.k) S.dir *= -1; else { S.sortK = th.dataset.k; S.dir = ['dist', 'code'].includes(th.dataset.k) ? 1 : -1; } draw(); return; }
    const tr = e.target.closest('#mt tr[data-code]');
    if (tr) {
      S.sel = tr.dataset.code;
      document.querySelectorAll('#mt tr.sel').forEach(t => t.classList.remove('sel')); tr.classList.add('sel');
      preview(S.sel);
      $('#mprev').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  load();
  return () => { alive = false; disposeChart(chart); };
}
