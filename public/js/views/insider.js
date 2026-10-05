// Menu Insider — transaksi direksi/komisaris/pemegang saham utama.
import { $, api, fmtN, esc, stockHeader, loading, errBox } from '../core.js';

const S = { action: '', page: 1 };
const num = s => Number(String(s ?? '').replace(/[^0-9.+-]/g, '')) || 0;

export async function mount(el, { code }) {
  const body = stockHeader(el, 'insider', code);
  let alive = true, seq = 0;
  S.page = 1;
  body.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="ia">${[['', 'Semua'], ['buy', 'Beli'], ['sell', 'Jual'], ['cross', 'Cross']].map(([k, t]) => `<button data-a="${k}" class="${k === S.action ? 'on' : ''}">${t}</button>`).join('')}</div>
      <span class="hint">15 transaksi per halaman · 1 call per halaman</span>
    </div>
    <div id="ibody"></div>`;

  const load = async () => {
    const box = $('#ibody'), my = ++seq;
    box.innerHTML = loading('Memuat transaksi insider…');
    try {
      const j = await api(`/api/insiders?code=${code}&page=${S.page}${S.action ? '&action=' + S.action : ''}`);
      if (alive && my === seq) box.innerHTML = render(j);
    } catch (e) { if (alive && my === seq) box.innerHTML = errBox(e); }
  };
  $('#ia').onclick = e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    S.action = b.dataset.a; S.page = 1;
    $('#ia').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    load();
  };
  body.addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { S.page = Number(b.dataset.p); load(); } });
  load();
  return () => { alive = false; };
}

function render(j) {
  const items = j.items || [];
  if (!items.length) return '<div class="card empty">Tidak ada transaksi insider tercatat.</div>';
  const buys = items.filter(i => i.action_type === 'buy'), sells = items.filter(i => i.action_type === 'sell');
  const sumShares = a => a.reduce((s, i) => s + Math.abs(num(i.changes_value)), 0);
  const est = a => a.reduce((s, i) => s + Math.abs(num(i.changes_value)) * num(i.price_formatted), 0);
  const act = t => ({ buy: ['BELI', 'up'], sell: ['JUAL', 'down'], cross: ['CROSS', 'warn'] }[t] || [t?.toUpperCase() || '—', 'flat']);
  return `
    <div class="kpis inline">
      <div class="kpi"><div class="l">Total transaksi</div><div class="v">${fmtN(j.total)}</div><div class="s">halaman ${j.page} / ${j.total_pages}</div></div>
      <div class="kpi"><div class="l">Beli (halaman ini)</div><div class="v up">${buys.length}</div><div class="s">${fmtN(sumShares(buys))} lembar · ± Rp ${fmtN(est(buys) / 1e9, 1)} M</div></div>
      <div class="kpi"><div class="l">Jual (halaman ini)</div><div class="v down">${sells.length}</div><div class="s">${fmtN(sumShares(sells))} lembar · ± Rp ${fmtN(est(sells) / 1e9, 1)} M</div></div>
      <div class="kpi"><div class="l">Terbaru</div><div class="v" style="font-size:14px">${esc(items[0].name)}</div><div class="s">${items[0].date} · ${act(items[0].action_type)[0]}</div></div>
    </div>
    <div class="card"><div class="tablewrap flush"><table class="mini ins">
      <thead><tr><th>Tanggal</th><th>Nama</th><th>Aksi</th><th class="r">Perubahan</th><th class="r">Harga</th><th class="r">Sebelum</th><th class="r">Sesudah</th><th class="r">% kepemilikan</th><th>Broker</th></tr></thead>
      <tbody>${items.map(i => {
        const [t, c] = act(i.action_type);
        return `<tr>
          <td class="mono">${i.date}</td>
          <td><b>${esc(i.name)}</b> ${(i.badges || []).map(b => `<span class="tag info">${esc(b)}</span>`).join(' ')} ${i.nationality === 'foreign' ? '<span class="tag warm">Asing</span>' : ''}</td>
          <td><span class="tag ${c === 'up' ? 'good' : c === 'down' ? 'bad' : 'warn'}">${t}</span></td>
          <td class="r mono ${c}">${esc(i.changes_value)}</td>
          <td class="r mono">${esc(i.price_formatted || '—')}</td>
          <td class="r mono">${esc(i.previous_value)}</td>
          <td class="r mono">${esc(i.current_value)}</td>
          <td class="r mono">${esc(i.previous_percentage)}% → ${esc(i.current_percentage)}%</td>
          <td class="mono">${esc(i.broker_code || '—')}</td></tr>`;
      }).join('')}</tbody>
    </table></div>
    <div class="pager">
      <button class="btn small" data-p="${j.page - 1}" ${j.page <= 1 ? 'disabled' : ''}>‹ Baru</button>
      <span class="mono">${j.page} / ${j.total_pages}</span>
      <button class="btn small" data-p="${j.page + 1}" ${j.page >= j.total_pages ? 'disabled' : ''}>Lama ›</button>
    </div></div>`;
}
