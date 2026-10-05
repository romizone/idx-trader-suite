// Menu Squant Screener — Elliott Wave (ZigZag 4/8/16) + breakout kompresi SMA 3/5/10/20 + Trend Template 6 syarat.
import { $, api, fmtN, fmtRp, cls, pct, esc, loading, errBox, scoreColor, dataDate, makeChart, disposeChart, candleSeries, watchlist, toast } from '../core.js';

const S = {
  top: 120, q: '', sig: 'all', tt: 0, ew: 'all', step: false, minVal: 1, sortK: 'score', dir: -1, sel: null,
  show: { ew4: true, ew8: true, ew16: true, ma: true },
  // Sinyal yang ditampilkan di grafik (pilihan disimpan di browser).
  sigs: { FH: true, FV: true, FC: true, FO: true, SOON: false, VOL: true, PRICE: true, EXH: false },
};
try { Object.assign(S.sigs, JSON.parse(localStorage.getItem('idx_squant_sigs') || '{}')); } catch {}
const saveSigs = () => { try { localStorage.setItem('idx_squant_sigs', JSON.stringify(S.sigs)); } catch {} };
const EW_FRESH = 30; // sama dengan lib/squant.js
const EW_COL = { 4: '#f45b69', 8: '#5aa9ff', 16: '#e6edf7' };
// [label, kelas tag, warna marker, deskripsi]. F = Full, V = Volume, C = Compressed, S = Soon.
const SIG = {
  FH: ['FH · Four Horsemen', 'good', '#22d3a6', 'Full + Volume + Compressed — semua kriteria terpenuhi (sinyal terkuat)'],
  FV: ['FV · Full + Volume', 'hot', '#ff7a45', 'Full: close di atas semua SMA 3/5/10/20 · Volume: > 1,5× rata-rata volume 20 hari'],
  FC: ['FC · Full + Compressed', 'warn', '#f5b942', 'Full: close di atas semua SMA 3/5/10/20 · Compressed: SMA menyempit < 2,5% (volatilitas rendah beberapa hari)'],
  FO: ['FO · Full', 'bad', '#f45b69', 'Full: close di atas semua SMA 3/5/10/20, tanpa volume & kompresi'],
  SOON: ['S · Soon', 'info', '#9aa6bf', 'Soon: harga mulai menembus ke atas minimal 1 SMA (belum semua)'],
};
const STEP = {
  VOL: ['Step↑ + Vol', 'good', '#d946ef', 'Anak tangga: naik ≤ 4% saat Soon, volume lebih besar dari kemarin'],
  PRICE: ['Step↑', 'info', '#5aa9ff', 'Anak tangga: naik ≤ 4% saat Soon, volume tidak naik'],
  EXH: ['Step↑ lelah', 'warn', '#7d8aa5', 'Anak tangga lelah: naik ≤ 4% tapi candle merah & volume turun'],
};
const sigTag = (m, k, suffix = '', faded = false) => `<span class="tag ${faded ? 'warm' : m[k][1]}" title="${esc(m[k][3])}">${esc(m[k][0])}${suffix}</span>`;
const EW_SHORT = { impulse: '5', abc: 'ABC', next: 'baru', abcBreak: 'jebol', abcInv: 'ABC✕', inv: 'batal', fibBreak: 'fib✕' };

const BREAKOUT = new Set(['FH', 'FV', 'FC', 'FO']);
const SIG_FILTERS = [
  ['all', 'Semua'], ['breakout', 'Full hari ini (FH/FV/FC/FO)'], ['FH', 'FH · Four Horsemen'], ['fhfv', 'Full + Volume (FH/FV)'],
  ['recent', 'Full ≤ 5 hari'], ['SOON', 'S · Soon'],
];
const EW_FILTERS = [
  ['all', 'Semua'], ['bull', 'Bullish (pola ≤ 30 hari)'], ['zone', 'Koreksi di zona fib 0,5–0,854'], ['abc', 'ABC selesai / awal impuls naik'], ['bear', 'Bearish'],
];

const fresh = e => e.dir && e.age <= EW_FRESH;
function ewBadge(e) {
  if (!e.dir) return '<span class="flat">—</span>';
  const k = e.bias > 0 ? 'good' : e.bias < 0 ? 'bad' : 'warn';
  const txt = `${e.dir > 0 ? '↑' : '↓'}${EW_SHORT[e.state] || ''}${e.state === 'impulse' && e.retrace != null && e.retrace >= 0 ? ` ${fmtN(e.retrace, 0)}%` : ''}`;
  return `<span class="tag ${k}" style="${fresh(e) ? '' : 'opacity:.4'}" title="${esc(e.label)} · ${e.age} hari lalu${e.retrace != null ? ` · retrace ${fmtN(e.retrace, 1)}%` : ''}">${txt}</span>`;
}
function ttDots(tt) {
  return `<span class="ttd" title="${tt.pass}/6 syarat${tt.fails.length ? '\nGagal: ' + esc(tt.fails.join(', ')) : ''}${tt.short ? '\n(histori < 220 hari)' : ''}">${[0, 1, 2, 3, 4, 5].map(i => `<i class="${i < tt.pass ? 'on' : ''}"></i>`).join('')}<b>${tt.pass}</b></span>`;
}

export async function mount(el) {
  let chart = null, alive = true, data = null;
  el.innerHTML = `<div class="page">
    <div class="phead">
      <div><h2>🧭 Squant Screener</h2><div class="flat" id="qsub">Elliott Wave (ZigZag 4/8/16 + fib) · breakout kompresi SMA 3/5/10/20 · Trend Template 6 syarat</div></div>
    </div>
    <div class="toolbar">
      <input class="inp" id="qq" placeholder="Cari kode…" value="${esc(S.q)}">
      <label>Sinyal <select id="qsig">${SIG_FILTERS.map(([v, t]) => `<option value="${v}" ${v === S.sig ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label>Trend Template ≥ <select id="qtt">${[0, 1, 2, 3, 4, 5, 6].map(v => `<option value="${v}" ${v === S.tt ? 'selected' : ''}>${v}/6</option>`).join('')}</select></label>
      <label>Elliott Wave <select id="qew">${EW_FILTERS.map(([v, t]) => `<option value="${v}" ${v === S.ew ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="qstep" ${S.step ? 'checked' : ''}> Anak tangga (Step↑)</label>
      <label>Value rata2 ≥ <input type="number" class="inp n" id="qval" value="${S.minVal}" step="1"> M</label>
      <label>Universe <select id="qtop">${[[60, '60 paling likuid'], [120, '120 paling likuid'], [200, '200 paling likuid']].map(([v, t]) => `<option value="${v}" ${v === S.top ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <div id="qbody">${loading('Menghitung Squant…')}</div>
  </div>`;

  const load = async () => {
    $('#qbody').innerHTML = loading(`Menghitung Squant untuk ${S.top} saham…`);
    try {
      data = await api('/api/squant?top=' + S.top);
      if (alive) draw();
    } catch (e) { if (alive) $('#qbody').innerHTML = errBox(e); }
  };

  const filtered = () => {
    const q = S.q.trim().toUpperCase();
    const list = data.rows.filter(r => {
      if (q && !r.code.includes(q) && !r.name.toUpperCase().includes(q)) return false;
      if (r.avgVal20 < S.minVal * 1e9 || r.tt.pass < S.tt || (S.step && !r.step)) return false;
      if (S.sig === 'breakout' && !BREAKOUT.has(r.sig)) return false;
      if (S.sig === 'FH' && r.sig !== 'FH') return false;
      if (S.sig === 'fhfv' && r.sig !== 'FH' && r.sig !== 'FV') return false;
      if (S.sig === 'SOON' && r.sig !== 'SOON') return false;
      if (S.sig === 'recent' && !BREAKOUT.has(r.sig) && !(r.recent && r.recent.age <= 5)) return false;
      if (S.ew === 'bull' && !r.ewBull) return false;
      if (S.ew === 'bear' && !r.ewBear) return false;
      if (S.ew === 'zone' && !r.ew.some(e => fresh(e) && e.dir === 1 && e.state === 'impulse' && e.retrace >= 50 && e.retrace <= 85.4)) return false;
      if (S.ew === 'abc' && !r.ew.some(e => fresh(e) && e.dir === 1 && (e.state === 'abc' || e.state === 'next'))) return false;
      return true;
    });
    const k = S.sortK;
    const val = r => (k === 'tt' ? r.tt.pass : k === 'sig' ? ({ FH: 5, FV: 4, FC: 3, FO: 2, SOON: 1 }[r.sig] || 0) : r[k]);
    return list.sort((a, b) => (typeof val(a) === 'string' ? val(a).localeCompare(val(b)) : (val(a) ?? -1e18) - (val(b) ?? -1e18)) * S.dir);
  };

  const draw = () => {
    const rows = data.rows, list = filtered();
    const n = f => rows.filter(f).length;
    $('#qsub').innerHTML = `${dataDate(data.date)} · ${data.scanned} saham paling likuid · Elliott Wave (ZigZag 4/8/16 + fib) · breakout kompresi SMA 3/5/10/20 · Trend Template 6 syarat`;
    $('#qbody').innerHTML = `
      <div class="kpis inline">
        <div class="kpi"><div class="l">Lolos filter</div><div class="v up">${list.length}</div><div class="s">dari ${rows.length} saham</div></div>
        <div class="kpi"><div class="l">FH · Four Horsemen</div><div class="v">${n(r => r.sig === 'FH')}</div><div class="s">Full + Volume + Compressed hari ini</div></div>
        <div class="kpi"><div class="l">Full hari ini</div><div class="v">${n(r => BREAKOUT.has(r.sig))}</div><div class="s">FH/FV/FC/FO · ${n(r => r.sig === 'SOON')} Soon</div></div>
        <div class="kpi"><div class="l">Trend Template 6/6</div><div class="v up">${n(r => r.tt.pass === 6)}</div><div class="s">${n(r => r.tt.pass >= 5)} saham ≥ 5/6</div></div>
        <div class="kpi"><div class="l">EW bullish</div><div class="v">${n(r => r.ewBull > 0)}</div><div class="s">${n(r => r.ewBear > 0)} bearish · pola ≤ ${EW_FRESH} hari</div></div>
      </div>
      <div id="qprev"></div>
      <div class="tablewrap flush"><table class="big" id="qt">
        <thead><tr>
          <th data-k="code">Saham</th><th data-k="price" class="r">Harga</th><th data-k="chg" class="r">Chg%</th>
          <th data-k="sig">Sinyal</th><th data-k="comp" class="r" title="Selisih SMA 3/5/10/20 tertinggi vs terendah; &lt; 2,5% = terkompresi">Kompresi</th>
          <th data-k="volRatio" class="r" title="Volume hari ini ÷ SMA20 volume; &gt; 1,5× = breakout volume">Vol/MA20</th>
          <th data-k="tt">Trend Template</th><th title="ZigZag panjang 4">EW 4</th><th title="ZigZag panjang 8">EW 8</th><th title="ZigZag panjang 16">EW 16</th>
          <th data-k="avgVal20" class="r">Value rata2</th><th data-k="score" class="r">Skor</th><th></th>
        </tr></thead>
        <tbody>${list.map(r => `
          <tr data-code="${r.code}" class="${S.sel === r.code ? 'sel' : ''}">
            <td class="code"><b>${r.code}</b><small>${esc(r.name)}</small></td>
            <td class="r">${fmtN(r.price)}</td><td class="r ${cls(r.chg)}">${pct(r.chg)}</td>
            <td><div class="tags">${[r.sig ? sigTag(SIG, r.sig) : r.recent ? sigTag(SIG, r.recent.sig, ` ${r.recent.age}H lalu`, true) : '', r.step ? sigTag(STEP, r.step) : ''].join('') || '<span class="flat">—</span>'}</div></td>
            <td class="r ${r.comp != null && r.comp < 2.5 ? 'info' : ''}">${r.comp == null ? '—' : fmtN(r.comp, 2) + '%'}</td>
            <td class="r ${r.volRatio > 1.5 ? 'warn' : ''}">${r.volRatio == null ? '—' : fmtN(r.volRatio, 2) + '×'}</td>
            <td>${ttDots(r.tt)}</td>
            ${r.ew.map(e => `<td>${ewBadge(e)}</td>`).join('')}
            <td class="r">${fmtRp(r.avgVal20)}</td>
            <td class="r"><b style="color:${scoreColor(r.score)}">${r.score}</b></td>
            <td><button class="icon-btn" data-w="${r.code}" title="Watchlist">${watchlist.has(r.code) ? '★' : '☆'}</button></td>
          </tr>`).join('') || `<tr><td colspan="13" class="empty">Tidak ada saham yang memenuhi filter.</td></tr>`}</tbody>
      </table></div>
      <div class="flat" style="font-size:11.5px;line-height:1.6">
        <b>Sinyal</b>: <b>F</b> = Full, close di atas semua SMA 3/5/10/20 · <b>V</b> = Volume &gt; 1,5× rata-rata 20 hari · <b>C</b> = Compressed, SMA menyempit &lt; 2,5% (volatilitas rendah) ·
        <b>S</b> = Soon, harga mulai menembus ke atas minimal 1 SMA · <b>FH</b> = F + V + C, sinyal terkuat; FV = F + V; FC = F + C; FO = F saja ·
        Step↑ = naik ≤ 4% saat Soon (+Vol: volume naik; lelah: candle merah &amp; volume turun).
        <b>EW</b>: ↑/↓ arah impuls (1)–(5) terakhir; angka % = retrace dari titik (5); ABC = koreksi selesai; baru = kemungkinan awal impuls baru; jebol/batal = pola gagal. Pudar = kejadian terakhir &gt; ${EW_FRESH} hari lalu.
        <b>Skor</b> = Trend Template (35) + sinyal breakout (25) + anak tangga (10) + EW bullish (30). Klik baris untuk grafik.
        Logika Elliott Wave diadaptasi dari indikator LuxAlgo (<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a>).
      </div>`;
    document.querySelectorAll('#qt th').forEach(th => { const on = th.dataset.k === S.sortK; th.classList.toggle('sorted', on); th.dataset.dir = on ? (S.dir < 0 ? '▼' : '▲') : ''; });
    if (S.sel) preview(S.sel);
  };

  const preview = async code => {
    disposeChart(chart); chart = null;
    const r0 = data.rows.find(x => x.code === code);
    $('#qprev').innerHTML = `<div class="card">${loading(`Memuat grafik ${code}…`)}</div>`;
    let d;
    try { d = await api('/api/squant-chart?code=' + code); } catch (e) { if (alive) $('#qprev').innerHTML = `<div class="card">${errBox(e)}</div>`; return; }
    if (!alive || S.sel !== code) return;
    const tog = (k, t) => `<label class="chk"><input type="checkbox" data-show="${k}" ${S.show[k] ? 'checked' : ''}> ${t}</label>`;
    $('#qprev').innerHTML = `<div class="card"><h3>${d.code} · ${esc(d.name)} — ${fmtN(d.price)} <span class="${cls(d.chg)}">${pct(d.chg)}</span> · skor ${r0?.score ?? d.score}
      <span class="links"><a class="btn small" href="#/saham/${code}">Analisa →</a><a class="btn small" href="#/bandar/${code}">Bandar →</a><a class="btn small" href="#/backtest/${code}">Backtest →</a><button class="btn small" id="qclose">✕</button></span></h3>
      <div class="toolbar" style="margin:0 0 6px;gap:12px">
        ${tog('ew4', `<span style="color:${EW_COL[4]}">■</span> EW 4`)}${tog('ew8', `<span style="color:${EW_COL[8]}">■</span> EW 8`)}${tog('ew16', `<span style="color:${EW_COL[16]}">■</span> EW 16`)}
        ${tog('ma', 'SMA 3/5/10/20')}
        <span class="legend"><i style="background:#ff9f43"></i>MA50 <i style="background:#2dd4bf"></i>MA150 <i style="background:#b58cff"></i>MA200</span>
      </div>
      <div class="sigpick"><span class="flat">Sinyal di grafik:</span>
        ${[...Object.entries(SIG), ...Object.entries(STEP)].map(([k, m]) => `<label class="chk" title="${esc(m[3])}"><input type="checkbox" data-sig="${k}" ${S.sigs[k] ? 'checked' : ''}> <i style="background:${m[2]}"></i>${esc(m[0])}</label>`).join('')}
        <button class="btn small" data-sigall="1">Semua</button><button class="btn small" data-sigall="0">Kosongkan</button>
      </div>
      <div class="split">
        <div class="col"><div id="qchart" class="chart" style="height:420px"></div></div>
        <div class="col">${sidePanel(d)}</div>
      </div></div>`;
    $('#qclose').onclick = () => { S.sel = null; disposeChart(chart); chart = null; $('#qprev').innerHTML = ''; document.querySelectorAll('#qt tr.sel').forEach(t => t.classList.remove('sel')); };
    const redraw = () => { disposeChart(chart); chart = drawChart($('#qchart'), d); };
    document.querySelectorAll('#qprev [data-show]').forEach(c => { c.onchange = () => { S.show[c.dataset.show] = c.checked; redraw(); }; });
    document.querySelectorAll('#qprev [data-sig]').forEach(c => { c.onchange = () => { S.sigs[c.dataset.sig] = c.checked; saveSigs(); redraw(); }; });
    document.querySelectorAll('#qprev [data-sigall]').forEach(b => { b.onclick = () => {
      const on = b.dataset.sigall === '1';
      for (const k in S.sigs) S.sigs[k] = on;
      document.querySelectorAll('#qprev [data-sig]').forEach(c => { c.checked = on; });
      saveSigs(); redraw();
    }; });
    chart = drawChart($('#qchart'), d);
  };

  const num = (id, key, def) => $(id).addEventListener('input', e => { S[key] = e.target.value === '' ? def : Number(e.target.value); if (data) draw(); });
  num('#qval', 'minVal', 0);
  $('#qq').oninput = e => { S.q = e.target.value; if (data) draw(); };
  $('#qsig').onchange = e => { S.sig = e.target.value; if (data) draw(); };
  $('#qtt').onchange = e => { S.tt = Number(e.target.value); if (data) draw(); };
  $('#qew').onchange = e => { S.ew = e.target.value; if (data) draw(); };
  $('#qstep').onchange = e => { S.step = e.target.checked; if (data) draw(); };
  $('#qtop').onchange = e => { S.top = Number(e.target.value); load(); };
  el.addEventListener('click', e => {
    const w = e.target.closest('[data-w]');
    if (w) { e.stopPropagation(); const on = watchlist.toggle(w.dataset.w); w.textContent = on ? '★' : '☆'; toast(`${w.dataset.w} ${on ? 'ditambahkan ke' : 'dihapus dari'} watchlist`); return; }
    const th = e.target.closest('#qt th[data-k]');
    if (th) { if (S.sortK === th.dataset.k) S.dir *= -1; else { S.sortK = th.dataset.k; S.dir = ['code', 'comp'].includes(th.dataset.k) ? 1 : -1; } draw(); return; }
    const tr = e.target.closest('#qt tr[data-code]');
    if (tr) {
      S.sel = tr.dataset.code;
      document.querySelectorAll('#qt tr.sel').forEach(t => t.classList.remove('sel')); tr.classList.add('sel');
      preview(S.sel);
      $('#qprev').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  });
  load();
  return () => { alive = false; disposeChart(chart); };
}

function sidePanel(d) {
  const tt = d.tt;
  const ewRow = e => {
    if (!e.dir) return `<div class="flat" style="margin:6px 0"><b style="color:${EW_COL[e.len]}">EW ${e.len}</b> — belum ada pola (histori 250 hari)</div>`;
    const f = e.fib;
    return `<div style="margin:8px 0">
      <div><b style="color:${EW_COL[e.len]}">EW ${e.len}</b> ${ewBadge(e)} <span class="flat" style="font-size:11.5px">${e.age} hari lalu</span></div>
      <div style="font-size:12px;margin-top:2px">${esc(e.label)}</div>
      <div class="flat mono" style="font-size:11px">(1) ${e.pts[1].date} ${fmtN(e.pts[1].price)} → (5) ${e.pts[5].date} ${fmtN(e.pts[5].price)}</div>
      ${e.abc ? `<div class="flat mono" style="font-size:11px">(a) ${fmtN(e.abc.a.price)} · (b) ${fmtN(e.abc.b.price)} · (c) ${e.abc.c.date} ${fmtN(e.abc.c.price)}${e.abc.broken ? ` · jebol ${e.abc.broken}` : ''}</div>` : ''}
      ${f ? `<div class="mono" style="font-size:11px">Fib ${f.levels.map((v, i) => `${[0.5, 0.618, 0.764, 0.854][i]}: ${fmtN(v)}`).join(' · ')}<br>retrace ${fmtN(f.retrace, 1)}% · ${f.broken ? '<span class="down">0,854 jebol</span>' : '<span class="up">0,854 utuh</span>'}</div>` : ''}
    </div>`;
  };
  const m = d.maAbove ?? 0;
  const crit = [
    ['F', 'Full', m === 4, `close di atas ${m}/4 SMA 3/5/10/20`],
    ['V', 'Volume', d.volRatio > 1.5, `volume ${d.volRatio == null ? '—' : fmtN(d.volRatio, 2) + '×'} rata-rata 20 hari (syarat > 1,5×)`],
    ['C', 'Compressed', d.comp != null && d.comp < 2.5, `sebaran SMA ${d.comp == null ? '—' : fmtN(d.comp, 2) + '%'} (syarat < 2,5%)`],
    ['S', 'Soon', m >= 1 && m <= 3, m === 4 ? 'sudah Full (di atas semua SMA)' : `menembus ${m} SMA (syarat ≥ 1, belum semua)`],
  ];
  return `
    <div class="card" style="background:var(--panel)"><h3>Sinyal hari ini (${d.date})</h3>
      <div class="tags">${d.sig ? sigTag(SIG, d.sig) : '<span class="flat">Tidak ada sinyal</span>'}${d.step ? sigTag(STEP, d.step) : ''}</div>
      ${crit.map(([k, t, ok, s]) => `<div style="font-size:12.5px;margin:4px 0"><span class="${ok ? 'up' : 'down'}">${ok ? '✔' : '✘'}</span> <b>${k}</b> ${t} <span class="flat" style="font-size:11.5px">· ${s}</span></div>`).join('')}
      <div class="flat" style="font-size:11.5px;margin-top:4px">${d.sig ? esc(SIG[d.sig][3]) : 'FH = F + V + C (sinyal terkuat)'}${d.recent && !['FH', 'FV', 'FC', 'FO'].includes(d.sig) ? ` · Full terakhir: ${SIG[d.recent.sig][0]} ${d.recent.date}` : ''}</div>
    </div>
    <div class="card" style="background:var(--panel)"><h3>Trend Template ${tt.pass}/6</h3>
      ${tt.conds.map(c => `<div style="font-size:12.5px;margin:3px 0"><span class="${c.pass ? 'up' : 'down'}">${c.pass ? '✔' : '✘'}</span> ${esc(c.t)}</div>`).join('')}
      <div class="flat mono" style="font-size:11px;margin-top:4px">MA50 ${fmtN(tt.ma50, 0)} · MA150 ${fmtN(tt.ma150, 0)} · MA200 ${fmtN(tt.ma200, 0)}<br>52M: low ${fmtN(tt.lo52)} · high ${fmtN(tt.hi52)}${tt.short ? ' · histori &lt; 220 hari' : ''}</div>
    </div>
    <div class="card" style="background:var(--panel)"><h3>Elliott Wave</h3>${d.ew.map(ewRow).join('')}</div>`;
}

function drawChart(box, d) {
  const ch = makeChart(box, 420);
  const { cs, rows } = candleSeries(ch, d.rows);
  const c = rows.map(x => x.close);
  const sma = n => rows.map((x, i) => (i < n - 1 ? null : { time: x.date, value: c.slice(i - n + 1, i + 1).reduce((s, y) => s + y, 0) / n })).filter(Boolean);
  const line = (data, color, width = 1, style = 0, extra = {}) => {
    const s = ch.addLineSeries({ color, lineWidth: width, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
    s.setData(data);
    return s;
  };
  if (S.show.ma) [[3, 'rgba(244,91,105,.55)'], [5, 'rgba(255,159,67,.55)'], [10, 'rgba(90,169,255,.55)'], [20, 'rgba(181,140,255,.55)']].forEach(([n, col]) => line(sma(n), col));
  line(sma(50), '#ff9f43', 1.5); line(sma(150), '#2dd4bf', 1.5); line(sma(200), '#b58cff', 2);
  cs.createPriceLine({ price: d.tt.hi52, color: 'rgba(34,211,166,.5)', lineWidth: 1, lineStyle: 1, title: '52M high' });
  cs.createPriceLine({ price: d.tt.lo52, color: 'rgba(244,91,105,.5)', lineWidth: 1, lineStyle: 1, title: '52M low' });

  const markers = [];
  for (const s of d.signals) {
    if (s.sig && S.sigs[s.sig]) markers.push({ time: s.date, position: 'belowBar', color: SIG[s.sig][2], shape: s.sig === 'SOON' ? 'circle' : 'arrowUp', text: s.sig === 'SOON' ? 'S' : s.sig });
    if (s.step && S.sigs[s.step]) markers.push({ time: s.date, position: 'aboveBar', color: STEP[s.step][2], shape: s.step === 'EXH' ? 'arrowDown' : 'arrowUp', text: s.step === 'EXH' ? 'Exh' : s.step === 'VOL' ? 'Step↑V' : 'Step↑' });
  }
  const lastDate = rows[rows.length - 1].date;
  for (const e of d.ew) {
    if (!e.dir || !S.show['ew' + e.len]) continue;
    const col = EW_COL[e.len], up = e.dir === 1;
    const wave = line(e.pts.map(p => ({ time: p.date, value: p.price })), col, 2, e.on ? 0 : 1);
    // Label (1)…(5) di titik 2…6; puncak di atas, lembah di bawah (dibalik untuk impuls turun).
    wave.setMarkers(e.pts.slice(1).map((p, i) => ({ time: p.date, position: (i % 2 === 0) === up ? 'aboveBar' : 'belowBar', color: col, shape: 'circle', size: 0.4, text: `(${i + 1})` })));
    if (e.abc) {
      const pts = [e.pts[5], e.abc.a, e.abc.b, e.abc.c];
      const s = line(pts.map(p => ({ time: p.date, value: p.price })), e.abc.valid ? col : 'rgba(125,138,165,.6)', 1.5, 2);
      s.setMarkers(['a', 'b', 'c'].map((t, i) => ({ time: pts[i + 1].date, position: (i % 2 === 0) === up ? 'belowBar' : 'aboveBar', color: col, shape: 'circle', size: 0.4, text: `(${t})` })));
      if (e.abc.broken) markers.push({ time: e.abc.broken, position: up ? 'belowBar' : 'aboveBar', color: '#f45b69', shape: 'square', text: '✕' });
    }
    if (e.next) markers.push({ time: e.next.date, position: up ? 'aboveBar' : 'belowBar', color: col, shape: 'circle', text: 'baru' });
    if (e.fib && e.pts[5].date < lastDate) {
      e.fib.levels.forEach((v, i) => line([{ time: e.pts[5].date, value: v }, { time: lastDate, value: v }],
        e.fib.broken ? 'rgba(244,91,105,.45)' : `rgba(34,211,166,${[0.35, 0.5, 0.7, 0.85][i]})`, 1, e.fib.broken ? 1 : 0,
        { lastValueVisible: true, title: `${e.len}·${[0.5, 0.618, 0.764, 0.854][i]}` }));
    }
  }
  markers.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  cs.setMarkers(markers);
  ch.timeScale().setVisibleLogicalRange({ from: rows.length - 150, to: rows.length + 3 });
  return ch;
}
