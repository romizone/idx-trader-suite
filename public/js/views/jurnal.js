// Menu Jurnal Trading — catat trade (disimpan di browser), statistik performa, kurva ekuitas, ekspor CSV.
import { $, fmtN, cls, pct, esc, toast, makeChart, disposeChart } from '../core.js';

const KEY = 'idx_journal';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = a => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} };
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const FEE_B = 0.15, FEE_S = 0.25;

function pnl(t) {
  if (!t.exit) return null;
  const sh = t.lot * 100;
  const buy = t.entry * sh * (1 + FEE_B / 100), sell = t.exit * sh * (1 - FEE_S / 100);
  return { rp: sell - buy, pct: (sell / buy - 1) * 100 };
}

export function mount(el) {
  let list = load(), chart = null, edit = null;
  el.innerHTML = `<div class="page">
    <div class="phead"><div><h2>📓 Jurnal Trading</h2><div class="flat">Tersimpan di browser ini · P/L sudah termasuk fee beli ${FEE_B}% & jual ${FEE_S}%</div></div>
      <div class="toolbar"><button class="btn small" id="jcsv">⬇ Ekspor CSV</button><label class="btn small" style="cursor:pointer">⬆ Impor CSV<input type="file" id="jimp" accept=".csv" hidden></label></div></div>
    <div class="card"><h3 id="jtitle">Catat trade</h3>
      <form id="jf" class="jform">
        <label class="fld"><span>Kode</span><input class="inp" name="code" required maxlength="6" style="text-transform:uppercase"></label>
        <label class="fld"><span>Tgl masuk</span><input type="date" class="inp" name="dIn" required></label>
        <label class="fld"><span>Harga masuk</span><input type="number" class="inp" name="entry" required min="1"></label>
        <label class="fld"><span>Lot</span><input type="number" class="inp" name="lot" required min="1"></label>
        <label class="fld"><span>Tgl keluar</span><input type="date" class="inp" name="dOut"></label>
        <label class="fld"><span>Harga keluar</span><input type="number" class="inp" name="exit" min="1" placeholder="kosong = masih open"></label>
        <label class="fld"><span>Strategi</span><select class="inp" name="setup"><option>Scalping</option><option>Swing</option><option>Breakout</option><option>Pullback</option><option>Bandarmologi</option><option>Lainnya</option></select></label>
        <label class="fld wide"><span>Catatan</span><input class="inp" name="note" placeholder="alasan entry/exit, pelajaran…"></label>
        <div class="jbtn"><button class="btn primary">Simpan</button><button type="button" class="btn small" id="jcancel" hidden>Batal</button></div>
      </form></div>
    <div id="jstats"></div>
    <div class="card" id="jeq" hidden><h3>Kurva P/L kumulatif (Rp)</h3><div id="jchart" class="chart" style="height:220px"></div></div>
    <div class="card"><h3>Riwayat trade</h3><div class="tablewrap flush" id="jlist"></div></div>
  </div>`;
  const f = $('#jf');
  f.dIn.value = today();

  const draw = () => {
    save(list);
    const closed = list.filter(t => t.exit).map(t => ({ ...t, p: pnl(t) }));
    const wins = closed.filter(t => t.p.rp > 0), losses = closed.filter(t => t.p.rp <= 0);
    const total = closed.reduce((s, t) => s + t.p.rp, 0);
    const gp = wins.reduce((s, t) => s + t.p.rp, 0), gl = -losses.reduce((s, t) => s + t.p.rp, 0);
    const bySetup = {};
    closed.forEach(t => { const b = bySetup[t.setup] ||= { n: 0, w: 0, rp: 0 }; b.n++; if (t.p.rp > 0) b.w++; b.rp += t.p.rp; });
    $('#jstats').innerHTML = !list.length ? '' : `
      <div class="kpis inline">
        <div class="kpi"><div class="l">Total P/L (selesai)</div><div class="v ${cls(total)}">Rp ${fmtN(total)}</div><div class="s">${closed.length} trade selesai · ${list.length - closed.length} open</div></div>
        <div class="kpi"><div class="l">Win rate</div><div class="v">${closed.length ? fmtN(wins.length / closed.length * 100, 0) + '%' : '—'}</div><div class="s">${wins.length} menang · ${losses.length} kalah</div></div>
        <div class="kpi"><div class="l">Rata2 menang / kalah</div><div class="v" style="font-size:15px"><span class="up">${wins.length ? pct(wins.reduce((s, t) => s + t.p.pct, 0) / wins.length, 1) : '—'}</span> / <span class="down">${losses.length ? pct(losses.reduce((s, t) => s + t.p.pct, 0) / losses.length, 1) : '—'}</span></div></div>
        <div class="kpi"><div class="l">Profit factor</div><div class="v">${gl ? fmtN(gp / gl, 2) : wins.length ? '∞' : '—'}</div><div class="s">gross profit / gross loss</div></div>
        <div class="kpi"><div class="l">Per strategi</div><div class="s" style="margin-top:4px">${Object.entries(bySetup).map(([k, b]) => `${esc(k)}: <b class="${cls(b.rp)}">${fmtN(b.w / b.n * 100, 0)}%</b> (${b.n})`).join('<br>') || '—'}</div></div>
      </div>`;
    $('#jlist').innerHTML = !list.length ? '<div class="empty">Belum ada trade. Catat trade pertama di atas.</div>' : `<table class="mini">
      <tr><th>Kode</th><th>Masuk</th><th class="r">Harga</th><th class="r">Lot</th><th>Keluar</th><th class="r">Harga</th><th class="r">P/L</th><th class="r">%</th><th>Strategi</th><th>Catatan</th><th></th></tr>
      ${[...list].sort((a, b) => (b.dIn > a.dIn ? 1 : -1)).map(t => { const p = pnl(t); return `<tr>
        <td><a href="#/saham/${t.code}"><b>${t.code}</b></a></td><td class="mono">${t.dIn}</td><td class="r mono">${fmtN(t.entry)}</td><td class="r">${fmtN(t.lot)}</td>
        <td class="mono">${t.dOut || '<span class="tag warn">OPEN</span>'}</td><td class="r mono">${t.exit ? fmtN(t.exit) : '—'}</td>
        <td class="r ${cls(p?.rp)}">${p ? fmtN(p.rp) : '—'}</td><td class="r ${cls(p?.pct)}">${p ? pct(p.pct, 2) : '—'}</td>
        <td>${esc(t.setup)}</td><td class="flat" style="white-space:normal;max-width:260px">${esc(t.note || '')}</td>
        <td style="white-space:nowrap"><button class="icon-btn" data-ed="${t.id}" title="Ubah">✎</button><button class="icon-btn" data-del="${t.id}" title="Hapus">✕</button></td></tr>`; }).join('')}
    </table>`;
    disposeChart(chart); chart = null;
    $('#jeq').hidden = closed.length < 2;
    if (closed.length >= 2) {
      const pts = [], byDay = new Map();
      closed.sort((a, b) => ((a.dOut || a.dIn) < (b.dOut || b.dIn) ? -1 : 1)).forEach(t => { const d = t.dOut || t.dIn; byDay.set(d, (byDay.get(d) || 0) + t.p.rp); });
      let cum = 0;
      for (const [d, v] of [...byDay].sort()) pts.push({ time: d, value: (cum += v) });
      chart = makeChart($('#jchart'), 220);
      chart.addAreaSeries({ lineColor: cum >= 0 ? '#22d3a6' : '#f45b69', topColor: cum >= 0 ? 'rgba(34,211,166,.25)' : 'rgba(244,91,105,.25)', bottomColor: 'transparent', lineWidth: 2 }).setData(pts);
      chart.timeScale().fitContent();
    }
  };

  f.onsubmit = e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f));
    const t = { id: edit || Date.now().toString(36), code: d.code.toUpperCase().trim(), dIn: d.dIn, entry: Number(d.entry), lot: Number(d.lot),
      dOut: d.exit ? (d.dOut || today()) : '', exit: d.exit ? Number(d.exit) : null, setup: d.setup, note: d.note.trim() };
    list = edit ? list.map(x => (x.id === edit ? t : x)) : [...list, t];
    toast(edit ? 'Trade diperbarui' : 'Trade dicatat');
    edit = null; f.reset(); f.dIn.value = today(); $('#jtitle').textContent = 'Catat trade'; $('#jcancel').hidden = true;
    draw();
  };
  $('#jcancel').onclick = () => { edit = null; f.reset(); f.dIn.value = today(); $('#jtitle').textContent = 'Catat trade'; $('#jcancel').hidden = true; };
  el.addEventListener('click', e => {
    const del = e.target.closest('[data-del]'), ed = e.target.closest('[data-ed]');
    if (del && confirm('Hapus trade ini?')) { list = list.filter(t => t.id !== del.dataset.del); draw(); }
    if (ed) {
      const t = list.find(x => x.id === ed.dataset.ed); edit = t.id;
      for (const k of ['code', 'dIn', 'entry', 'lot', 'dOut', 'exit', 'setup', 'note']) f[k].value = t[k] ?? '';
      $('#jtitle').textContent = `Ubah trade ${t.code}`; $('#jcancel').hidden = false; f.scrollIntoView({ behavior: 'smooth' });
    }
  });
  const COLS = ['code', 'dIn', 'entry', 'lot', 'dOut', 'exit', 'setup', 'note'];
  $('#jcsv').onclick = () => {
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const csv = [COLS.join(','), ...list.map(t => COLS.map(k => q(t[k])).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `jurnal-trading-${today()}.csv`; a.click();
  };
  $('#jimp').onchange = async e => {
    const text = await e.target.files[0]?.text();
    if (!text) return;
    const rows = text.trim().split(/\r?\n/).slice(1).map(l => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')));
    const add = rows.filter(r => r[0]).map((r, i) => ({ id: Date.now().toString(36) + i, code: r[0].toUpperCase(), dIn: r[1], entry: Number(r[2]), lot: Number(r[3]), dOut: r[4], exit: r[5] ? Number(r[5]) : null, setup: r[6] || 'Lainnya', note: r[7] || '' }));
    list = [...list, ...add]; draw(); toast(`${add.length} trade diimpor`);
  };
  draw();
  return () => disposeChart(chart);
}
