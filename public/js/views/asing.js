// Menu Aliran Asing — net buy/sell investor asing (hari ini, 5H, 20H, 60H) atas saham paling likuid.
import { $, api, fmtN, fmtRp, cls, pct, esc, loading, errBox, dataDate } from '../core.js';
import { spark } from './scalper.js';

const S = { sortK: 'today', dir: -1 };

export async function mount(el) {
  el.innerHTML = `<div class="page">${loading('Menghitung aliran dana asing…')}</div>`;
  const page = $('.page', el);
  let j;
  try { j = await api('/api/foreign'); } catch (e) { page.innerHTML = errBox(e); return; }
  const rows = j.rows;
  const tot = k => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const top = (k, dir) => [...rows].sort((a, b) => (b[k] - a[k]) * dir).slice(0, 8);
  const mini = (list, k) => {
    const mx = Math.max(...list.map(r => Math.abs(r[k]))) || 1;
    return list.map(r => `<a class="barrow" href="#/bandar/${r.code}"><b>${r.code}</b><span class="bartrack"><i class="${r[k] < 0 ? 'neg' : ''}" style="width:${(Math.abs(r[k]) / mx) * 100}%"></i></span><em class="${cls(r[k])}">${fmtRp(r[k])}</em></a>`).join('');
  };

  page.innerHTML = `
    <div class="phead"><div><h2>🌏 Aliran Dana Asing</h2><div class="flat">${dataDate(j.date)} · ${rows.length} saham paling likuid · net = (beli asing − jual asing) × harga rata-rata</div></div></div>
    <div class="kpis inline">
      ${[['today', 'Net asing hari ini'], ['d5', 'Net asing 5 hari'], ['d20', 'Net asing 20 hari'], ['d60', 'Net asing 60 hari']].map(([k, t]) =>
        `<div class="kpi"><div class="l">${t}</div><div class="v ${cls(tot(k))}">${fmtRp(tot(k))}</div><div class="s">${rows.filter(r => r[k] > 0).length} net buy · ${rows.filter(r => r[k] < 0).length} net sell</div></div>`).join('')}
    </div>
    <div class="four">
      <div class="card"><h3>Top net buy hari ini</h3>${mini(top('today', 1), 'today')}</div>
      <div class="card"><h3>Top net sell hari ini</h3>${mini(top('today', -1), 'today')}</div>
      <div class="card"><h3>Akumulasi 20 hari</h3>${mini(top('d20', 1), 'd20')}</div>
      <div class="card"><h3>Distribusi 20 hari</h3>${mini(top('d20', -1), 'd20')}</div>
    </div>
    <div class="tablewrap flush"><table class="big" id="fa">
      <thead><tr>
        <th data-k="code">Saham</th><th data-k="price" class="r">Harga</th><th data-k="chg" class="r">Chg%</th>
        <th data-k="today" class="r">Hari ini</th><th data-k="d5" class="r">5H</th><th data-k="d20" class="r">20H</th><th data-k="d60" class="r">60H</th>
        <th data-k="streak" class="r" title="Hari berturut-turut net buy (+) / net sell (−)">Streak</th>
        <th data-k="part" class="r" title="Porsi transaksi asing hari ini">Porsi asing</th><th data-k="part20" class="r">Porsi 20H</th>
        <th data-k="ret20" class="r">Harga 20H</th><th>Kumulatif 20H</th>
      </tr></thead><tbody></tbody></table></div>`;

  const draw = () => {
    const k = S.sortK;
    const list = [...rows].sort((a, b) => (typeof a[k] === 'string' ? a[k].localeCompare(b[k]) : (a[k] ?? -1e18) - (b[k] ?? -1e18)) * S.dir);
    $('#fa tbody').innerHTML = list.map(r => `
      <tr data-code="${r.code}">
        <td class="code"><b>${r.code}</b><small>${esc(r.name)}</small></td>
        <td class="r">${fmtN(r.price)}</td><td class="r ${cls(r.chg)}">${pct(r.chg)}</td>
        <td class="r ${cls(r.today)}">${fmtRp(r.today)}</td><td class="r ${cls(r.d5)}">${fmtRp(r.d5)}</td>
        <td class="r ${cls(r.d20)}">${fmtRp(r.d20)}</td><td class="r ${cls(r.d60)}">${fmtRp(r.d60)}</td>
        <td class="r ${cls(r.streak)}">${r.streak > 0 ? '+' : ''}${r.streak}</td>
        <td class="r">${fmtN(r.part, 1)}%</td><td class="r">${fmtN(r.part20, 1)}%</td>
        <td class="r ${cls(r.ret20)}">${pct(r.ret20, 1)}</td><td>${spark(r.spark, 90)}</td>
      </tr>`).join('');
    document.querySelectorAll('#fa th').forEach(th => { const on = th.dataset.k === S.sortK; th.classList.toggle('sorted', on); th.dataset.dir = on ? (S.dir < 0 ? '▼' : '▲') : ''; });
  };
  draw();
  $('#fa thead').onclick = e => { const th = e.target.closest('th[data-k]'); if (!th) return; if (S.sortK === th.dataset.k) S.dir *= -1; else { S.sortK = th.dataset.k; S.dir = -1; } draw(); };
  $('#fa tbody').onclick = e => { const tr = e.target.closest('tr[data-code]'); if (tr) location.hash = `#/bandar/${tr.dataset.code}`; };
}
