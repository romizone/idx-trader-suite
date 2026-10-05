// Menu Heatmap — treemap saham likuid: luas = nilai transaksi / market cap, warna = % perubahan.
import { $, api, fmtN, fmtRp, pct, esc, loading, errBox, dataDate } from '../core.js';

const S = { size: 'value', color: 'chg' };

// Squarified treemap (Bruls et al.) — kembalikan kotak {x,y,w,h} per item.
function squarify(items, x, y, w, h) {
  const out = [];
  const total = items.reduce((s, i) => s + i.v, 0);
  if (!total) return out;
  const scale = (w * h) / total;
  let rest = items.map(i => ({ ...i, a: i.v * scale }));
  while (rest.length) {
    const short = Math.min(w, h);
    let row = [], best = Infinity;
    for (const it of rest) {
      const tr = [...row, it], s = tr.reduce((a, b) => a + b.a, 0);
      const worst = Math.max(...tr.map(r => Math.max((short * short * r.a) / (s * s), (s * s) / (short * short * r.a))));
      if (worst > best) break;
      row = tr; best = worst;
    }
    const s = row.reduce((a, b) => a + b.a, 0), thick = s / short;
    let off = 0;
    for (const r of row) {
      const len = r.a / thick;
      out.push(w >= h ? { ...r, x, y: y + off, w: thick, h: len } : { ...r, x: x + off, y, w: len, h: thick });
      off += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    rest = rest.slice(row.length);
  }
  return out;
}

function color(v, max) {
  if (v == null || !isFinite(v)) return '#1c2740';
  const t = Math.min(1, Math.abs(v) / max);
  const [r, g, b] = v >= 0 ? [34, 211, 166] : [244, 91, 105];
  const mix = (c, base) => Math.round(base + (c - base) * (0.25 + 0.75 * t));
  return `rgb(${mix(r, 28)},${mix(g, 36)},${mix(b, 56)})`;
}

export async function mount(el) {
  el.innerHTML = `<div class="page">${loading('Menyusun heatmap…')}</div>`;
  const page = $('.page', el);
  let j;
  try { j = await api('/api/scan'); } catch (e) { page.innerHTML = errBox(e); return; }
  if (!el.isConnected) return; // pengguna sudah pindah menu selagi data dimuat
  const rows = j.rows;

  page.innerHTML = `
    <div class="phead">
      <div><h2>🟩 Heatmap Pasar</h2><div class="flat">${dataDate(j.date)} · ${rows.length} saham paling likuid · klik kotak untuk analisa</div></div>
      <div class="toolbar">
        <label>Ukuran <div class="seg" id="hs"><button data-s="value">Nilai transaksi</button><button data-s="marketCap">Market cap</button><button data-s="flat">Sama rata</button></div></label>
        <label>Warna <div class="seg" id="hc"><button data-c="chg">Chg% hari ini</button><button data-c="rvol">RVOL</button><button data-c="score">Skor scalping</button></div></label>
      </div>
    </div>
    <div class="treemap" id="tm"></div>
    <div class="hm-legend" id="hl"></div>`;

  const draw = () => {
    $('#hs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.s === S.size));
    $('#hc').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.c === S.color));
    const box = $('#tm');
    const W = box.clientWidth, H = Math.max(420, Math.min(720, W * 0.55));
    box.style.height = H + 'px';
    const items = rows.map(r => ({ r, v: S.size === 'flat' ? 1 : Math.max(r[S.size] || 0, 1) })).sort((a, b) => b.v - a.v);
    const val = r => (S.color === 'chg' ? r.chg : S.color === 'rvol' ? Math.log2(Math.max(r.rvol, 0.01)) : (r.score - 50) / 10);
    const max = S.color === 'chg' ? 5 : S.color === 'rvol' ? 2 : 3;
    box.innerHTML = squarify(items, 0, 0, W, H).map(b => {
      const r = b.r, big = b.w > 70 && b.h > 42;
      const sub = S.color === 'chg' ? pct(r.chg) : S.color === 'rvol' ? `${fmtN(r.rvol, 2)}x` : `skor ${r.score}`;
      return `<a class="tile" href="#/saham/${r.code}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;background:${color(val(r), max)}"
        title="${r.code} · ${esc(r.name)}\nHarga ${fmtN(r.price)} (${pct(r.chg)})\nValue ${fmtRp(r.value)} · RVOL ${fmtN(r.rvol, 2)}x · Skor ${r.score}">
        ${b.w > 34 && b.h > 18 ? `<b style="font-size:${Math.max(10, Math.min(22, Math.sqrt(b.w * b.h) / 6))}px">${r.code}</b>` : ''}
        ${big ? `<span>${sub}</span>` : ''}</a>`;
    }).join('');
    const stops = S.color === 'chg' ? [-5, -2.5, 0, 2.5, 5].map(v => [v, pct(v, 1)]) : S.color === 'rvol' ? [[-2, '0,25x'], [-1, '0,5x'], [0, '1x'], [1, '2x'], [2, '4x']] : [[-3, '20'], [-1.5, '35'], [0, '50'], [1.5, '65'], [3, '80']];
    $('#hl').innerHTML = stops.map(([v, t]) => `<span style="background:${color(v, max)}">${t}</span>`).join('');
  };
  $('#hs').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { S.size = b.dataset.s; draw(); } };
  $('#hc').onclick = e => { const b = e.target.closest('[data-c]'); if (b) { S.color = b.dataset.c; draw(); } };
  draw();
  const ro = new ResizeObserver(() => draw());
  ro.observe($('#tm'));
  return () => ro.disconnect();
}
