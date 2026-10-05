// Menu Running Trade — rekaman transaksi done (tape) per saham, per tanggal, dengan ringkasan HAKA/HAKI.
import { $, api, fmtN, fmtRp, cls, esc, stockHeader, loading, errBox, toast, eodNote, wibToday } from '../core.js';

export async function mount(el, { code }) {
  const body = stockHeader(el, 'tape', code);
  let alive = true, timer = null, page = 1, data = null, loadedAt = 0;
  // Default selalu "Terbaru" (tanggal paling baru di sumber); auto-cek aktif kecuali pernah dimatikan pengguna.
  const S = { date: '', minLot: 0, broker: '', side: '' };
  let autoOn = true;
  try { autoOn = localStorage.getItem('idx_tape_auto') !== '0'; } catch {}

  body.innerHTML = `
    <div class="toolbar">
      <label>Tanggal <select class="inp" id="td"><option value="">Terbaru</option></select></label>
      <label>Lot ≥ <input type="number" class="inp n" id="tl" value="0"></label>
      <label>Broker <input class="inp n" id="tb" placeholder="mis. YP" maxlength="3" style="text-transform:uppercase"></label>
      <div class="seg" id="tside"><button data-s="" class="on">Semua</button><button data-s="BUY">HAKA</button><button data-s="SELL">HAKI</button></div>
      <label class="auto" title="Saat mode Terbaru: cek tiap 2 menit apakah sumber sudah menerbitkan tanggal baru"><input type="checkbox" id="tauto" ${autoOn ? 'checked' : ''}> Auto-cek tanggal baru</label>
      <span class="hint">1 call per halaman (100 transaksi)</span>
    </div>
    <div id="tsum"></div>
    <div class="card"><div class="tablewrap flush"><table class="mini tape" id="tt"><thead><tr>
      <th>Jam</th><th>Board</th><th class="r">Harga</th><th class="r">Lot</th><th class="r">Value</th><th>Aksi</th><th>Buyer</th><th>Seller</th>
    </tr></thead><tbody></tbody></table></div>
    <div class="pager" id="tp"></div></div>`;

  const load = async () => {
    if (!data) $('#tt tbody').innerHTML = `<tr><td colspan="8">${loading()}</td></tr>`;
    try {
      const j = await api(`/api/tape?code=${code}&page=${page}${S.date ? '&date=' + S.date : ''}`);
      if (!alive) return;
      const prev = data?.date;
      data = j; loadedAt = Date.now();
      // Pilihan tanggal = daftar tanggal yang tersedia di sumber; "Terbaru" selalu mengikuti tanggal paling baru.
      const dates = j.dates || [];
      $('#td').innerHTML = `<option value="">Terbaru${dates[0] ? ' · ' + dates[0] : ''}</option>` +
        [...new Set([...dates, S.date].filter(Boolean))].sort().reverse().map(d => `<option value="${d}">${d}</option>`).join('');
      $('#td').value = S.date;
      if (prev && !S.date && j.date > prev) toast(`Running trade ${j.date} sudah terbit`);
      draw();
    } catch (e) { if (alive) $('#tt tbody').innerHTML = `<tr><td colspan="8">${errBox(e)}</td></tr>`; }
  };

  const draw = () => {
    const j = data, s = j.summary;
    const b = S.broker.toUpperCase();
    const list = (j.data || []).filter(t => t.qty_num >= S.minLot && (!b || t.buyer === b || t.seller === b) && (!S.side || t.action === S.side));
    const avgLot = s.count ? (s.buyLot + s.sellLot) / s.count : 0;
    const pend = !S.date && eodNote(j.date);
    const note = !j.total ? `Sumber belum punya data running trade ${code} tanggal ${j.date}${j.date >= wibToday() ? ' — sumber tidak menyediakan running trade selama sesi; data hari ini terbit setelah pasar tutup' : ''}.`
      : pend ? (pend.startsWith('EOD')
        ? `Running trade ${wibToday()} belum terbit dari sumber (biasanya malam setelah pasar tutup — ${$('#tauto').checked ? 'dicek otomatis tiap 2 menit' : 'centang Auto-cek untuk dicek tiap 2 menit'}). Yang tampil: tanggal terbaru yang tersedia, ${j.date}.`
        : `Sumber tidak menyediakan running trade selama sesi; data hari ini terbit setelah pasar tutup. Yang tampil: tanggal terbaru yang tersedia, ${j.date}.`) : '';
    $('#tsum').innerHTML = `${note ? `<div class="hint" style="margin:0 0 8px">⚠ ${esc(note)}</div>` : ''}
      <div class="kpis inline">
        <div class="kpi"><div class="l">Tanggal · total trx</div><div class="v">${fmtN(j.total)}</div><div class="s">${j.date}${j.latest ? ' (terbaru)' : ''} · halaman ${j.page}/${fmtN(j.total_pages)}</div></div>
        <div class="kpi"><div class="l">HAKA vs HAKI (halaman ini)</div><div class="meter"><i style="width:${s.hakaPct ?? 50}%"></i></div><div class="s"><span class="up">${fmtN(s.hakaPct, 1)}%</span> · <span class="down">${fmtN(100 - (s.hakaPct ?? 50), 1)}%</span> · ${esc(s.verdict)}</div></div>
        <div class="kpi"><div class="l">Rentang waktu</div><div class="v" style="font-size:15px">${s.from || '—'} – ${s.to || '—'}</div><div class="s">${s.count} trx · rata2 ${fmtN(avgLot, 0)} lot</div></div>
        <div class="kpi"><div class="l">Range harga</div><div class="v" style="font-size:15px">${fmtN(s.low)} – ${fmtN(s.high)}</div><div class="s">VWAP ${fmtN(s.vwap, 1)}</div></div>
        <div class="kpi"><div class="l">Broker dominan</div><div class="v" style="font-size:15px"><span class="up">${s.topBuyers[0]?.code || '—'}</span> / <span class="down">${s.topSellers[0]?.code || '—'}</span></div><div class="s">net buyer / net seller</div></div>
      </div>`;
    const big = Math.max(avgLot * 5, 100);
    $('#tt tbody').innerHTML = list.map(t => `
      <tr class="${t.qty_num >= big ? 'bigtr' : ''}">
        <td class="mono">${t.time}</td><td class="flat">${t.market_board}</td>
        <td class="r mono ${t.action === 'BUY' ? 'up' : 'down'}">${fmtN(t.price_num)}</td>
        <td class="r mono">${fmtN(t.qty_num)}</td><td class="r mono">${fmtRp(t.value_raw)}</td>
        <td><span class="tag ${t.action === 'BUY' ? 'good' : 'bad'}">${t.action === 'BUY' ? 'HAKA' : 'HAKI'}</span></td>
        <td class="mono"><b>${t.buyer}</b> <small class="${t.buyer_type === 'F' ? 'warn' : 'flat'}">${t.buyer_type}</small></td>
        <td class="mono"><b>${t.seller}</b> <small class="${t.seller_type === 'F' ? 'warn' : 'flat'}">${t.seller_type}</small></td>
      </tr>`).join('') || '<tr><td colspan="8" class="empty">Tidak ada transaksi yang cocok di halaman ini.</td></tr>';
    $('#tp').innerHTML = `<span class="flat">${list.length} dari ${(j.data || []).length} transaksi ditampilkan · baris tebal = lot besar (≥ ${fmtN(big)})</span>
      <button class="btn small" data-p="1" ${page <= 1 ? 'disabled' : ''}>« Terbaru</button>
      <button class="btn small" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>
      <span class="mono">${page}</span>
      <button class="btn small" data-p="${page + 1}" ${page >= j.total_pages ? 'disabled' : ''}>Lebih lama ›</button>`;
  };

  $('#td').onchange = e => { S.date = e.target.value; page = 1; data = null; load(); };
  $('#tl').oninput = e => { S.minLot = Number(e.target.value) || 0; if (data) draw(); };
  $('#tb').oninput = e => { S.broker = e.target.value.trim(); if (data) draw(); };
  $('#tside').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; S.side = b.dataset.s; $('#tside').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); if (data) draw(); };
  $('#tp').onclick = e => { const b = e.target.closest('[data-p]'); if (b) { page = Number(b.dataset.p); load(); } };
  // Sumber hanya menerbitkan running trade per hari setelah pasar tutup, jadi cukup cek tiap 2 menit
  // (server & CDN menyimpan daftar tanggal sebentar saja selama tanggal terbaru belum terbit).
  const latestMode = () => page === 1 && !S.date;
  const setAuto = on => {
    clearInterval(timer); timer = null;
    if (on) timer = setInterval(() => { if (latestMode() && !document.hidden) load(); }, 120_000);
  };
  $('#tauto').onchange = e => { try { localStorage.setItem('idx_tape_auto', e.target.checked ? '1' : '0'); } catch {} setAuto(e.target.checked); };
  // Kembali ke tab setelah lama: langsung cek tanggal terbaru.
  const onVisible = () => { if (!document.hidden && latestMode() && Date.now() - loadedAt > 120_000) load(); };
  document.addEventListener('visibilitychange', onVisible);
  setAuto(autoOn);
  load();
  return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
}
