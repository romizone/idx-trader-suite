// Menu Kalkulator — position sizing, fee & break-even, ARA/ARB + tangga fraksi, average down/up. 0 kuota.
import { $, fmtN, cls, pct } from '../core.js';

const tick = p => (p < 200 ? 1 : p < 500 ? 2 : p < 2000 ? 5 : p < 5000 ? 10 : 25);
const floorT = x => Math.floor(x / tick(x)) * tick(x);
const ceilT = x => Math.ceil(x / tick(x)) * tick(x);
const araPct = p => (p <= 200 ? 35 : p <= 5000 ? 25 : 20);
const load = () => { try { return JSON.parse(localStorage.getItem('idx_calc') || '{}'); } catch { return {}; } };
const save = v => { try { localStorage.setItem('idx_calc', JSON.stringify(v)); } catch {} };

export function mount(el) {
  const v = { modal: 50e6, risk: 1, entry: 1000, sl: 950, tp: 1100, feeB: 0.15, feeS: 0.25, prev: 1000, arbPct: 15, avgRows: [[1000, 10], [900, 10]], ...load() };
  const num = (id, label, step = 1, suffix = '') => `<label class="fld"><span>${label}</span><input type="number" class="inp" data-k="${id}" value="${v[id]}" step="${step}">${suffix ? `<em>${suffix}</em>` : ''}</label>`;
  el.innerHTML = `<div class="page">
    <div class="phead"><div><h2>🧮 Kalkulator Trading</h2><div class="flat">Semua perhitungan lokal · 1 lot = 100 lembar · fraksi & ARA sesuai aturan BEI</div></div></div>
    <div class="two">
      <div class="card"><h3>Position sizing (berbasis risiko)</h3>
        <div class="form">${num('modal', 'Modal (Rp)', 1e6)}${num('risk', 'Risiko per trade', 0.25, '%')}${num('entry', 'Harga entry')}${num('sl', 'Stop loss')}${num('tp', 'Target')}</div>
        <div id="o1" class="out"></div></div>
      <div class="card"><h3>Fee & break-even</h3>
        <div class="form">${num('feeB', 'Fee beli', 0.01, '%')}${num('feeS', 'Fee jual (+PPh)', 0.01, '%')}</div>
        <div id="o2" class="out"></div></div>
    </div>
    <div class="two">
      <div class="card"><h3>ARA / ARB & tangga fraksi</h3>
        <div class="form">${num('prev', 'Harga acuan (prev close)')}${num('arbPct', 'Batas ARB', 1, '%')}</div>
        <div id="o3" class="out"></div></div>
      <div class="card"><h3>Average down / up</h3>
        <div id="avg" class="form"></div>
        <button class="btn small" id="addAvg">+ Tambah pembelian</button>
        <div id="o4" class="out"></div></div>
    </div>
  </div>`;

  const drawAvg = () => {
    $('#avg').innerHTML = v.avgRows.map(([p, l], i) => `<div class="avgrow"><label class="fld"><span>Harga #${i + 1}</span><input type="number" class="inp" data-a="${i}" data-f="0" value="${p}"></label>
      <label class="fld"><span>Lot</span><input type="number" class="inp" data-a="${i}" data-f="1" value="${l}"></label>
      ${v.avgRows.length > 1 ? `<button class="icon-btn" data-del="${i}">✕</button>` : ''}</div>`).join('');
  };

  const calc = () => {
    // 1. position sizing
    const riskRp = v.modal * v.risk / 100, perShare = v.entry - v.sl;
    const fee = v.entry * v.feeB / 100 + v.sl * v.feeS / 100;
    const lots = perShare > 0 ? Math.floor(riskRp / ((perShare + fee) * 100)) : 0;
    const maxLots = Math.floor(v.modal / (v.entry * 100 * (1 + v.feeB / 100)));
    const useLots = Math.min(lots, maxLots), cost = useLots * 100 * v.entry * (1 + v.feeB / 100);
    const gain = useLots * 100 * (v.tp * (1 - v.feeS / 100) - v.entry * (1 + v.feeB / 100));
    const loss = useLots * 100 * (v.sl * (1 - v.feeS / 100) - v.entry * (1 + v.feeB / 100));
    const rr = perShare > 0 ? (v.tp - v.entry) / perShare : null;
    $('#o1').innerHTML = perShare <= 0 ? '<div class="down">Stop loss harus di bawah harga entry.</div>' : `
      <div class="big-out"><span>Jumlah beli</span><b>${fmtN(useLots)} lot</b><em>${fmtN(useLots * 100)} lembar</em></div>
      <div class="grid">
        <div><span>Dana dipakai</span><b>Rp ${fmtN(cost)}</b></div><div><span>% modal</span><b>${fmtN(cost / v.modal * 100, 1)}%</b></div>
        <div><span>Risiko maksimal</span><b>Rp ${fmtN(riskRp)}</b></div>
        <div><span>Rugi jika kena SL</span><b class="down">Rp ${fmtN(loss)}</b></div><div><span>Untung jika kena target</span><b class="up">Rp ${fmtN(gain)}</b></div>
        <div><span>Risk : reward</span><b class="${rr >= 2 ? 'up' : rr >= 1 ? '' : 'down'}">1 : ${fmtN(rr, 2)}</b></div>
      </div>
      ${lots > maxLots ? `<div class="warn" style="font-size:12px;margin-top:6px">Dibatasi modal: berdasarkan risiko seharusnya ${fmtN(lots)} lot.</div>` : ''}
      <div class="flat" style="font-size:11.5px;margin-top:6px">SL ${pct((v.sl / v.entry - 1) * 100, 2)} (${fmtN(Math.round(perShare / tick(v.entry)))} tick) · target ${pct((v.tp / v.entry - 1) * 100, 2)}</div>`;

    // 2. fee & break-even
    const be = v.entry * (1 + v.feeB / 100) / (1 - v.feeS / 100), beT = ceilT(be);
    const rt = v.feeB + v.feeS;
    const ladder = [1, 2, 3, 5, 10].map(n => { let p = v.entry; for (let i = 0; i < n; i++) p += tick(p); return [n, p, (p * (1 - v.feeS / 100)) / (v.entry * (1 + v.feeB / 100)) - 1]; });
    $('#o2').innerHTML = `
      <div class="big-out"><span>Harga break-even</span><b>${fmtN(beT)}</b><em>${fmtN(be, 2)} tepat · ${fmtN(Math.ceil((beT - v.entry) / tick(v.entry)))} tick dari entry</em></div>
      <div class="grid"><div><span>Total biaya round-trip</span><b>${fmtN(rt, 2)}%</b></div><div><span>Biaya per lot</span><b>Rp ${fmtN(v.entry * 100 * rt / 100)}</b></div><div><span>Fraksi di ${fmtN(v.entry)}</span><b>${tick(v.entry)} (${fmtN(tick(v.entry) / v.entry * 100, 2)}%)</b></div></div>
      <table class="mini" style="margin-top:10px"><tr><th>Naik</th><th class="r">Harga jual</th><th class="r">Hasil bersih</th></tr>
      ${ladder.map(([n, p, r]) => `<tr><td>+${n} tick</td><td class="r mono">${fmtN(p)}</td><td class="r ${cls(r)}">${pct(r * 100, 2)}</td></tr>`).join('')}</table>`;

    // 3. ARA / ARB
    const ap = araPct(v.prev), ara = floorT(v.prev * (1 + ap / 100)), arb = Math.max(1, ceilT(v.prev * (1 - v.arbPct / 100)));
    const up = [], dn = [];
    let p = v.prev; for (let i = 0; i < 6; i++) { p += tick(p); up.push(p); }
    p = v.prev; for (let i = 0; i < 6 && p > 1; i++) { p -= tick(p - 1); dn.push(p); }
    $('#o3').innerHTML = `
      <div class="grid">
        <div><span>ARA (+${ap}%)</span><b class="up">${fmtN(ara)}</b></div>
        <div><span>ARB (−${v.arbPct}%)</span><b class="down">${fmtN(arb)}</b></div>
        <div><span>Rentang harian</span><b>${fmtN(arb)} – ${fmtN(ara)}</b></div>
      </div>
      <div class="flat" style="font-size:11.5px;margin:6px 0">Batas ARB mengikuti ketentuan BEI yang berlaku — sesuaikan persentasenya bila ada perubahan aturan.</div>
      <div class="ladder">${[...up.reverse().map(x => `<span class="up">${fmtN(x)}<em>${pct((x / v.prev - 1) * 100, 2)}</em></span>`), `<span class="cur">${fmtN(v.prev)}<em>acuan</em></span>`, ...dn.map(x => `<span class="down">${fmtN(x)}<em>${pct((x / v.prev - 1) * 100, 2)}</em></span>`)].join('')}</div>`;

    // 4. average
    const totL = v.avgRows.reduce((s, r) => s + r[1], 0), totV = v.avgRows.reduce((s, r) => s + r[0] * r[1] * 100, 0);
    const avg = totL ? totV / (totL * 100) : 0;
    $('#o4').innerHTML = `
      <div class="big-out"><span>Harga rata-rata</span><b>${fmtN(avg, 2)}</b><em>${fmtN(totL)} lot · Rp ${fmtN(totV)}</em></div>
      <div class="flat" style="font-size:12px">Break-even setelah fee: <b>${fmtN(ceilT(avg * (1 + v.feeB / 100) / (1 - v.feeS / 100)))}</b></div>`;
    save(v);
  };

  el.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.k) v[t.dataset.k] = Number(t.value) || 0;
    if (t.dataset.a) v.avgRows[Number(t.dataset.a)][Number(t.dataset.f)] = Number(t.value) || 0;
    calc();
  });
  el.addEventListener('click', e => {
    const d = e.target.closest('[data-del]');
    if (d) { v.avgRows.splice(Number(d.dataset.del), 1); drawAvg(); calc(); }
    if (e.target.id === 'addAvg') { const last = v.avgRows[v.avgRows.length - 1]; v.avgRows.push([floorT(last[0] * 0.95), last[1]]); drawAvg(); calc(); }
  });
  drawAvg(); calc();
}
