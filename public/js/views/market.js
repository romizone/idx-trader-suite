// Menu Market — seluruh saham BEI dari /api/market-cap (memakai cache universe, 0 call tambahan).
import { $, api, getUniverse, fmtN, fmtRp, cls, pct, esc, loading, errBox, dataDate } from '../core.js';

const PER = 50;
const S = { sortK: 'mcap', dir: -1, page: 1, q: '', minCap: 0 };

export async function mount(el) {
  el.innerHTML = `<div class="page">${loading('Memuat data pasar…')}</div>`;
  const page = $('.page', el);
  let u;
  try { u = await getUniverse(); } catch (e) { page.innerHTML = errBox(e); return; }
  // Chg% hanya tersedia untuk saham likuid hasil scan (memakai cache yang sama).
  const scan = await api('/api/scan').catch(() => null);
  const chg = new Map((scan?.rows || []).map(r => [r.code, r.chg]));
  const data = u.data.map(x => ({ ...x, chg: chg.get(x.code) ?? null }));
  const total = data.reduce((s, x) => s + (x.mcap || 0), 0);
  const totVal = data.reduce((s, x) => s + (x.value || 0), 0);
  data.forEach(x => (x.share = total ? (x.mcap / total) * 100 : 0));
  const byCap = [...data].sort((a, b) => b.mcap - a.mcap);
  const byVal = [...data].sort((a, b) => b.value - a.value);
  const byTurn = [...data].filter(x => x.mcap >= 1e12).sort((a, b) => b.turnover - a.turnover);
  const top10Share = byCap.slice(0, 10).reduce((s, x) => s + x.share, 0);
  const active = data.filter(x => x.turnover > 0).length;

  const barList = (list, val, fmt) => {
    const mx = Math.max(...list.map(val)) || 1;
    return list.map(x => `<a class="barrow" href="#/saham/${x.code}"><b>${x.code}</b><span class="bartrack"><i style="width:${(val(x) / mx) * 100}%"></i></span><em>${fmt(x)}</em></a>`).join('');
  };

  page.innerHTML = `
    <div class="phead"><div><h2>🏛 Market Overview</h2><div class="flat">${dataDate(u.date)} · ${data.length} emiten</div></div></div>
    <div class="kpis inline">
      <div class="kpi"><div class="l">Total market cap</div><div class="v">${fmtRp(total)}</div><div class="s">${data.length} emiten</div></div>
      <div class="kpi"><div class="l">Estimasi nilai transaksi</div><div class="v">${fmtRp(totVal)}</div><div class="s">turnover × market cap</div></div>
      <div class="kpi"><div class="l">Saham aktif ditransaksikan</div><div class="v">${active}</div><div class="s">${data.length - active} tanpa transaksi</div></div>
      <div class="kpi"><div class="l">Dominasi 10 terbesar</div><div class="v">${fmtN(top10Share, 1)}%</div><div class="s">dari total kapitalisasi</div></div>
    </div>
    <div class="three">
      <div class="card"><h3>Market cap terbesar</h3>${barList(byCap.slice(0, 12), x => x.mcap, x => `${fmtRp(x.mcap)} · ${fmtN(x.share, 1)}%`)}</div>
      <div class="card"><h3>Nilai transaksi terbesar</h3>${barList(byVal.slice(0, 12), x => x.value, x => fmtRp(x.value))}</div>
      <div class="card"><h3>Turnover tertinggi <span class="flat" style="text-transform:none">(mcap ≥ 1T)</span></h3>${barList(byTurn.slice(0, 12), x => x.turnover, x => fmtN(x.turnover * 100, 2) + '%')}</div>
    </div>
    <div class="card">
      <h3>Semua saham
        <span class="hfilters">
          <input class="inp" id="mq" placeholder="Cari kode / nama…" value="${esc(S.q)}">
          <select id="mcap">
            <option value="0">Semua cap</option><option value="1e14">≥ 100 T</option><option value="1e13">≥ 10 T</option>
            <option value="1e12">≥ 1 T</option><option value="1e11">≥ 100 M</option><option value="-1e11">&lt; 100 M</option>
          </select>
        </span>
      </h3>
      <div class="tablewrap flush"><table class="big" id="mt">
        <thead><tr>
          <th data-k="rank">#</th><th data-k="code">Saham</th><th data-k="close" class="r">Close</th><th data-k="chg" class="r" title="Hanya tersedia untuk saham yang sudah di-scan">Chg%</th>
          <th data-k="mcap" class="r">Market cap</th><th data-k="share" class="r">Bobot</th><th data-k="shares" class="r">Saham beredar</th>
          <th data-k="turnover" class="r">Turnover</th><th data-k="value" class="r">Est. value</th>
        </tr></thead><tbody></tbody></table></div>
      <div class="pager" id="pager"></div>
    </div>`;
  $('#mcap').value = String(S.minCap);

  const draw = () => {
    const q = S.q.trim().toUpperCase();
    let rows = data.filter(x => (!q || x.code.includes(q) || x.name.toUpperCase().includes(q)) &&
      (S.minCap >= 0 ? x.mcap >= S.minCap : x.mcap < -S.minCap));
    const k = S.sortK === 'rank' ? 'mcap' : S.sortK;
    rows.sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (a[k] ?? -Infinity) - (b[k] ?? -Infinity)) * S.dir);
    const pages = Math.max(1, Math.ceil(rows.length / PER));
    S.page = Math.min(S.page, pages);
    const slice = rows.slice((S.page - 1) * PER, S.page * PER);
    $('#mt tbody').innerHTML = slice.map((x, i) => `
      <tr data-code="${x.code}">
        <td class="flat">${(S.page - 1) * PER + i + 1}</td>
        <td class="code"><b>${x.code}</b><small>${esc(x.name)}</small></td>
        <td class="r">${fmtN(x.close)}</td>
        <td class="r ${cls(x.chg)}">${x.chg == null ? '<span class="flat">—</span>' : pct(x.chg)}</td>
        <td class="r">${fmtRp(x.mcap)}</td>
        <td class="r">${fmtN(x.share, 2)}%</td>
        <td class="r">${fmtN(x.shares / 1e6, 0)} jt</td>
        <td class="r">${fmtN(x.turnover * 100, 3)}%</td>
        <td class="r">${fmtRp(x.value)}</td>
      </tr>`).join('') || `<tr><td colspan="9" class="empty">Tidak ada hasil.</td></tr>`;
    document.querySelectorAll('#mt th').forEach(th => { const on = th.dataset.k === S.sortK; th.classList.toggle('sorted', on); th.dataset.dir = on ? (S.dir < 0 ? '▼' : '▲') : ''; });
    $('#pager').innerHTML = `<span class="flat">${rows.length} saham</span>
      <button class="btn small" data-p="${S.page - 1}" ${S.page <= 1 ? 'disabled' : ''}>‹</button>
      <span class="mono">${S.page} / ${pages}</span>
      <button class="btn small" data-p="${S.page + 1}" ${S.page >= pages ? 'disabled' : ''}>›</button>`;
  };
  draw();
  $('#mq').addEventListener('input', e => { S.q = e.target.value; S.page = 1; draw(); });
  $('#mcap').addEventListener('change', e => { S.minCap = Number(e.target.value); S.page = 1; draw(); });
  $('#pager').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { S.page = Number(b.dataset.p); draw(); } });
  $('#mt thead').addEventListener('click', e => {
    const th = e.target.closest('th[data-k]'); if (!th) return;
    if (S.sortK === th.dataset.k) S.dir *= -1; else { S.sortK = th.dataset.k; S.dir = th.dataset.k === 'code' ? 1 : -1; }
    draw();
  });
  $('#mt tbody').addEventListener('click', e => { const tr = e.target.closest('tr[data-code]'); if (tr) location.hash = `#/saham/${tr.dataset.code}`; });
}
