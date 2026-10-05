// Menu Watchlist — daftar pantauan pribadi (disimpan di browser) dengan metrik + plan yang sama dengan Scalper.
import { $, api, fmtN, fmtRp, cls, pct, esc, toast, stockPicker, watchlist, loading, errBox, app } from '../core.js';
import { spark, scoreCell, planCell, tagsCell } from './scalper.js';

const SUGGEST = ['BBCA', 'BBRI', 'BMRI', 'TLKM', 'ASII', 'ADRO', 'ANTM', 'GOTO'];
let rows = [];

export async function mount(el) {
  el.innerHTML = `<div class="page">
    <div class="phead">
      <div><h2>⭐ Watchlist</h2><div class="flat">Disimpan di browser ini · data EOD dari cache, harga live 1 call/saham</div></div>
      <div class="actions">
        <div class="vpick" id="wpick"></div>
        <button class="btn primary" id="wLive">⚡ Update live</button>
      </div>
    </div>
    <div id="wbody"></div>
  </div>`;
  stockPicker($('#wpick'), { value: '', placeholder: 'Tambah saham…', onPick: c => { if (!watchlist.has(c)) watchlist.toggle(c); $('#wpick input').value = ''; load(false); } });
  $('#wLive').onclick = () => load(true);
  $('#wbody').addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { e.stopPropagation(); watchlist.toggle(rm.dataset.rm); rows = rows.filter(r => r.code !== rm.dataset.rm); draw(); return; }
    const add = e.target.closest('[data-add]');
    if (add) { watchlist.toggle(add.dataset.add); load(false); return; }
    const tr = e.target.closest('tr[data-code]');
    if (tr) location.hash = `#/saham/${tr.dataset.code}`;
  });
  load(false);
}

async function load(live) {
  const codes = watchlist.get();
  const body = $('#wbody');
  if (!body) return;
  if (!codes.length) { rows = []; return draw(); }
  if (live && app.market && !app.market.open) toast('Pasar sedang tutup — harga live = harga penutupan terakhir');
  if (!rows.length) body.innerHTML = loading();
  const b = $('#wLive'); b.disabled = true;
  try {
    const j = await api(`/api/watch?codes=${codes.join(',')}${live ? '&live=1' : ''}`);
    rows = j.rows;
    draw();
    if (live) toast(`Live diperbarui ${new Date(j.at).toLocaleTimeString('id-ID')} · ${codes.length} call`);
  } catch (e) { body.innerHTML = errBox(e); }
  finally { if ($('#wLive')) b.disabled = false; }
}

function draw() {
  const body = $('#wbody');
  if (!body) return;
  if (!rows.length) {
    body.innerHTML = `<div class="card empty-state">
      <div style="font-size:30px">⭐</div><b>Watchlist masih kosong</b>
      <div class="flat">Tambah saham lewat kotak di atas, tombol ☆ di menu Scalper/Swing, atau pilih cepat:</div>
      <div class="links" style="justify-content:center">${SUGGEST.map(c => `<button class="btn small" data-add="${c}">+ ${c}</button>`).join('')}</div>
    </div>`;
    return;
  }
  const ok = rows.filter(r => !r.error);
  const up = ok.filter(r => r.chg > 0).length, down = ok.filter(r => r.chg < 0).length;
  const best = [...ok].sort((a, b) => b.chg - a.chg)[0];
  body.innerHTML = `
    <div class="kpis inline">
      <div class="kpi"><div class="l">Saham dipantau</div><div class="v">${rows.length}</div></div>
      <div class="kpi"><div class="l">Naik / turun</div><div class="v"><span class="up">${up}</span> / <span class="down">${down}</span></div></div>
      <div class="kpi"><div class="l">Terkuat</div><div class="v">${best ? best.code : '—'}</div><div class="s ${cls(best?.chg)}">${best ? pct(best.chg) : ''}</div></div>
      <div class="kpi"><div class="l">Rata-rata skor scalping</div><div class="v">${ok.length ? fmtN(ok.reduce((s, r) => s + r.score, 0) / ok.length) : '—'}</div></div>
    </div>
    <div class="tablewrap flush"><table class="big">
      <thead><tr><th>Saham</th><th class="r">Harga</th><th class="r">Chg%</th><th>20H</th><th class="r">Value</th><th class="r">RVOL</th><th class="r">ATR%</th><th class="r">Asing</th><th class="r">Skor</th><th>Plan (SL · TP1 · TP2)</th><th>Sinyal</th><th></th></tr></thead>
      <tbody>${rows.map(r => r.error ? `
        <tr><td class="code"><b>${r.code}</b></td><td colspan="10" class="down">${esc(r.error)}</td><td><button class="icon-btn" data-rm="${r.code}" title="Hapus">✕</button></td></tr>` : `
        <tr data-code="${r.code}">
          <td class="code"><b>${r.code}</b>${r.isLive ? '<span class="live-badge">LIVE</span>' : ''}<small>${esc(r.name)}</small></td>
          <td class="r">${fmtN(r.price)}</td>
          <td class="r ${cls(r.chg)}">${pct(r.chg)}</td>
          <td>${spark(r.spark)}</td>
          <td class="r">${fmtRp(r.value)}</td>
          <td class="r">${fmtN(r.rvol, 2)}x</td>
          <td class="r">${fmtN(r.atrPct, 1)}%</td>
          <td class="r ${cls(r.fnetVal)}">${fmtRp(r.fnetVal)}</td>
          <td class="r">${scoreCell(r.score)}</td>
          <td class="plan">${planCell(r.plan)}</td>
          <td>${tagsCell(r.tags, 3)}</td>
          <td><button class="icon-btn" data-rm="${r.code}" title="Hapus dari watchlist">✕</button></td>
        </tr>`).join('')}</tbody>
    </table></div>`;
}
