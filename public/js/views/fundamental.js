// Menu Fundamental — laporan keuangan (laba rugi, neraca, arus kas) kuartalan/tahunan.
import { $, api, fmtN, fmtRp, cls, esc, niceKey, stockHeader, loading, errBox } from '../core.js';

const TYPES = [['INCOME_STATEMENT', 'Laba Rugi'], ['BALANCE_SHEET', 'Neraca'], ['CASH_FLOW_REPORT', 'Arus Kas']];
const S = { type: 'INCOME_STATEMENT', period: 'quarterly', limit: 8, hideZero: true };

export async function mount(el, { code }) {
  const body = stockHeader(el, 'fundamental', code);
  let alive = true, seq = 0;
  body.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="ft">${TYPES.map(([k, t]) => `<button data-t="${k}" class="${k === S.type ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="seg" id="fp"><button data-p="quarterly" class="${S.period === 'quarterly' ? 'on' : ''}">Kuartalan</button><button data-p="annually" class="${S.period === 'annually' ? 'on' : ''}">Tahunan</button></div>
      <label>Periode <select id="fl">${[4, 8, 12, 20].map(n => `<option ${n === S.limit ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="chk"><input type="checkbox" id="fz" ${S.hideZero ? 'checked' : ''}> Sembunyikan akun nol</label>
      <span class="hint">1 call per kombinasi (cache 24 jam)</span>
    </div>
    <div id="fbody"></div>`;

  const load = async () => {
    const box = $('#fbody'), my = ++seq;
    box.innerHTML = loading('Memuat laporan keuangan…');
    try {
      const j = await api(`/api/financials?code=${code}&type=${S.type}&period=${S.period}&limit=${S.limit}`);
      if (alive && my === seq) box.innerHTML = render(j);
    } catch (e) { if (alive && my === seq) box.innerHTML = errBox(e); }
  };
  $('#ft').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; S.type = b.dataset.t; seg('#ft', b); load(); };
  $('#fp').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; S.period = b.dataset.p; seg('#fp', b); load(); };
  $('#fl').onchange = e => { S.limit = Number(e.target.value); load(); };
  $('#fz').onchange = e => { S.hideZero = e.target.checked; load(); };
  load();
  return () => { alive = false; };
}
const seg = (sel, b) => $(sel).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));

const val = v => (typeof v === 'number' ? v : v && typeof v === 'object' ? (typeof v.total === 'number' ? v.total : null) : null);
function getPath(obj, path) { let o = obj; for (const k of path) { if (o == null) return null; o = o[k]; } return o; }

// Ratakan struktur akun bertingkat jadi baris tabel.
function flatten(items) {
  const rows = [], seen = new Set();
  const walk = (obj, path, depth, parentKey) => {
    for (const [k, v] of Object.entries(obj || {})) {
      // Anak bernama sama dengan grupnya hanya dilewati bila memang duplikat total grup; kalau nilainya beda,
      // itu pos tersendiri (mis. "beban operasional lainnya" di dalam grup bernama sama) dan harus tampil.
      if (k === 'total' || (k === parentKey && typeof v === 'number' && v === obj.total)) continue;
      const p = [...path, k], id = p.join('.');
      if (!seen.has(id)) { seen.add(id); rows.push({ id, path: p, label: niceKey(k), depth, group: v && typeof v === 'object' }); }
      if (v && typeof v === 'object') walk(v, p, depth + 1, k);
    }
  };
  items.forEach(it => walk(it.data, [], 0, null));
  return rows;
}

function render(j) {
  const items = j.items || [];
  if (!items.length) return '<div class="card empty">Belum ada data laporan keuangan untuk filter ini.</div>';
  let rows = flatten(items);
  const vals = r => items.map(it => val(getPath(it.data, r.path)));
  if (S.hideZero) rows = rows.filter(r => vals(r).some(v => v));
  const yoyGap = S.period === 'quarterly' ? 4 : 1;
  const hasYoy = items.length > yoyGap;
  const small = rows.every(r => vals(r).every(v => v == null || Math.abs(v) < 1e6));
  const fmt = v => (v == null ? '—' : Math.abs(v) < 10 && v % 1 ? fmtN(v, 4) : small ? fmtN(v) : fmtRp(v));

  // Ringkasan: akun level teratas sebagai mini bar chart (lama → baru).
  const tops = rows.filter(r => r.depth === 0 && vals(r).some(v => v)).slice(0, 8);
  const mini = r => {
    const v = vals(r).slice().reverse();
    const mx = Math.max(...v.map(x => Math.abs(x || 0))) || 1;
    const last = v[v.length - 1], prev = v[v.length - 1 - yoyGap];
    const ch = prev && last != null ? ((last - prev) / Math.abs(prev)) * 100 : null;
    return `<div class="fcard"><div class="fl">${esc(r.label)}</div><div class="fv ${cls(last)}">${fmt(last)}</div>
      <div class="fbars">${v.map(x => `<i class="${x < 0 ? 'neg' : ''}" style="height:${Math.max(2, (Math.abs(x || 0) / mx) * 100)}%"></i>`).join('')}</div>
      <div class="fs ${cls(ch)}">${ch == null ? '' : `${ch >= 0 ? '+' : ''}${fmtN(ch, 1)}% ${S.period === 'quarterly' ? 'YoY' : 'vs thn lalu'}`}</div></div>`;
  };

  return `
    <div class="fgrid">${tops.map(mini).join('')}</div>
    <div class="card">
      <h3>${esc(TYPES.find(t => t[0] === j.report_type)?.[1] || j.report_type)} · ${j.period === 'annually' ? 'Tahunan' : 'Kuartalan'} <span class="flat" style="text-transform:none">diambil ${esc(items[0].fetched_at || '')}</span></h3>
      <div class="tablewrap flush"><table class="mini fin">
        <thead><tr><th>Akun</th>${items.map(it => `<th class="r">${esc(it.label)}</th>`).join('')}${hasYoy ? `<th class="r">${S.period === 'quarterly' ? 'YoY' : 'Δ thn'}</th>` : ''}</tr></thead>
        <tbody>${rows.map(r => {
          const v = vals(r);
          const ch = hasYoy && v[0] != null && v[yoyGap] ? ((v[0] - v[yoyGap]) / Math.abs(v[yoyGap])) * 100 : null;
          return `<tr class="${r.group ? 'grp' : ''} d${Math.min(r.depth, 4)}"><td style="padding-left:${6 + r.depth * 16}px">${esc(r.label)}</td>
            ${v.map(x => `<td class="r ${x < 0 ? 'down' : ''}">${fmt(x)}</td>`).join('')}
            ${hasYoy ? `<td class="r ${cls(ch)}">${ch == null || !isFinite(ch) ? '—' : `${ch >= 0 ? '+' : ''}${fmtN(ch, 1)}%`}</td>` : ''}</tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>`;
}
