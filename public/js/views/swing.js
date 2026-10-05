// Menu Swing — hasil /api/screener/latest (Screener V5 IDX Edge PRO), dikelompokkan per bucket.
import { $, api, fmtN, esc, miniMd, loading, errBox, watchlist, toast } from '../core.js';

export async function mount(el) {
  el.innerHTML = `<div class="page">${loading('Memuat screener swing…')}</div>`;
  const page = $('.page', el);
  let j;
  try { j = await api('/api/swing'); } catch (e) { page.innerHTML = errBox(e); return; }
  if (!el.isConnected) return; // pengguna sudah pindah menu selagi data dimuat

  const lines = (j.raw || '').split('\n');
  const title = (j.date || '').replace(/\*\*/g, '');
  const cond = lines.find(l => /MARKET/.test(l)) || '';
  const stats = lines.find(l => /terdata/.test(l)) || '';
  const legend = lines.find(l => /=akumulasi/.test(l)) || '';
  const groups = new Map();
  for (const r of j.rows || []) {
    if (!groups.has(r.bucket)) groups.set(r.bucket, []);
    groups.get(r.bucket).push(r);
  }
  const desc = new Map();
  lines.forEach(l => { const m = l.match(/^\*\*(.+?)\*\* — (.+)$/); if (m) desc.set(m[1], m[2]); });

  page.innerHTML = `
    <div class="phead">
      <div><h2>🎯 Screener Swing</h2><div class="flat">${esc(title)} · sumber ${esc(j.source || '')}</div></div>
      <button class="btn small" id="rawBtn">Lihat teks asli</button>
    </div>
    <div class="banner">${miniMd(cond)}<div class="flat" style="font-size:12px;margin-top:4px">${miniMd(stats)}</div></div>
    <div class="kpis inline">
      <div class="kpi"><div class="l">Total sinyal</div><div class="v">${(j.rows || []).length}</div></div>
      ${[...groups].map(([b, rs]) => `<div class="kpi"><div class="l">${esc(b)}</div><div class="v">${rs.length}</div></div>`).join('')}
    </div>
    ${[...groups].map(([b, rs]) => `
      <section class="card">
        <h3>${esc(b)} <span class="flat" style="text-transform:none;letter-spacing:0">${esc(desc.get(b) || '')}</span></h3>
        <div class="swing-grid">
          ${rs.map(r => `
            <div class="swing-card">
              <div class="sc-top">
                <a href="#/saham/${r.stock_code}" class="sc-code">${r.stock_code}</a>
                <button class="icon-btn" data-w="${r.stock_code}" title="Watchlist">${watchlist.has(r.stock_code) ? '★' : '☆'}</button>
              </div>
              <div class="flat sc-name">${esc(r.stock_name)}</div>
              <div class="sc-stats">
                <div><span>Win rate event</span><b class="${r.wr_event >= 65 ? 'up' : ''}">${fmtN(r.wr_event, 1)}%</b></div>
                <div><span>Potensi</span><b class="up">+${fmtN(r.potential, 0)}%</b></div>
                <div><span>Drawdown</span><b class="down">${fmtN(r.drawdown, 0)}%</b></div>
              </div>
              <div class="sc-sum">${esc(r.summary)}</div>
              ${r.note ? `<div class="tags">${r.note.split('|').map(n => `<span class="tag warn">${esc(n.trim())}</span>`).join('')}</div>` : ''}
              <div class="sc-links"><a href="#/saham/${r.stock_code}">Analisa</a><a href="#/bandar/${r.stock_code}">Bandar</a><a href="#/musiman/${r.stock_code}">Musiman</a></div>
            </div>`).join('')}
        </div>
      </section>`).join('')}
    <div class="card" id="rawCard" hidden><h3>Teks asli screener</h3><div class="analysis">${miniMd(j.raw || '')}</div></div>
    <div class="flat" style="font-size:12px">${miniMd(legend)}</div>`;

  $('#rawBtn').onclick = () => { const c = $('#rawCard'); c.hidden = !c.hidden; if (!c.hidden) c.scrollIntoView({ behavior: 'smooth' }); };
  page.addEventListener('click', e => {
    const b = e.target.closest('[data-w]');
    if (!b) return;
    const on = watchlist.toggle(b.dataset.w);
    b.textContent = on ? '★' : '☆';
    toast(`${b.dataset.w} ${on ? 'ditambahkan ke' : 'dihapus dari'} watchlist`);
  });
}
