// Router hash sederhana: #/<menu>/<arg?>
import { $, $$, api, currentCode, errBox, logout } from './core.js';

const VIEWS = {
  scalper: () => import('./views/scalper.js'),
  swing: () => import('./views/swing.js'),
  swingma200: () => import('./views/swingma200.js'),
  squant: () => import('./views/squant.js'),
  teknikal: () => import('./views/teknikal.js'),
  asing: () => import('./views/asing.js'),
  market: () => import('./views/market.js'),
  heatmap: () => import('./views/heatmap.js'),
  watchlist: () => import('./views/watchlist.js'),
  saham: () => import('./views/saham.js'),
  bandar: () => import('./views/bandar.js'),
  tape: () => import('./views/tape.js'),
  fundamental: () => import('./views/fundamental.js'),
  insider: () => import('./views/insider.js'),
  musiman: () => import('./views/musiman.js'),
  bandingkan: () => import('./views/bandingkan.js'),
  backtest: () => import('./views/backtest.js'),
  kalkulator: () => import('./views/kalkulator.js'),
  jurnal: () => import('./views/jurnal.js'),
};
const PER_STOCK = new Set(['saham', 'bandar', 'tape', 'fundamental', 'insider', 'musiman', 'backtest']);

let cleanup = null;
let token = 0;

async function route() {
  const [, name = 'scalper', arg] = location.hash.split('/');
  const view = Object.hasOwn(VIEWS, name) ? name : 'scalper';
  // Kode dari URL divalidasi: hash rusak ("%") atau berisi markup tidak boleh sampai ke halaman / localStorage.
  let code;
  try { code = arg ? decodeURIComponent(arg).toUpperCase() : undefined; } catch {}
  if (code && !/^[A-Z0-9]{3,6}$/.test(code)) code = undefined;
  if (PER_STOCK.has(view)) {
    if (!code) { location.replace(`#/${view}/${currentCode.get()}`); return; }
    currentCode.set(code);
  }
  $$('#nav a').forEach(a => {
    a.classList.toggle('on', a.dataset.v === view);
    if (PER_STOCK.has(a.dataset.v)) a.href = `#/${a.dataset.v}/${PER_STOCK.has(view) ? code : currentCode.get()}`;
  });
  $('#nav a.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const my = ++token;
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  // Elemen #view diganti baru tiap pindah menu: listener yang dipasang menu sebelumnya ikut terbuang,
  // dan menu lama yang masih menunggu data bisa tahu dirinya sudah ditinggal (el.isConnected === false).
  const old = $('#view'), el = old.cloneNode(false);
  old.replaceWith(el);
  el.className = `view v-${view}`;
  let mod;
  try {
    mod = await VIEWS[view]();
    try { sessionStorage.removeItem('idx_reloaded'); } catch {}
  } catch (e) {
    // Tab yang terbuka sejak sebelum deploy: modul menu versi baru bisa meminta export yang belum ada
    // di core.js versi lama (sudah termuat di memori / cache HTTP). Segarkan cache modul lalu muat ulang
    // halaman supaya semua modul satu versi. Dibatasi sekali per 30 detik agar tidak loop.
    let tried = true;
    try {
      tried = Date.now() - Number(sessionStorage.getItem('idx_reloaded') || 0) < 30e3;
      if (!tried) sessionStorage.setItem('idx_reloaded', String(Date.now()));
    } catch {}
    if (!tried) {
      el.innerHTML = '<div class="empty"><span class="spin"></span> Memperbarui aplikasi…</div>';
      const urls = ['/js/core.js', '/js/main.js', `/js/views/${view}.js`];
      await Promise.allSettled(urls.map(u => fetch(u, { cache: 'reload' })));
      location.reload();
      return;
    }
    el.innerHTML = errBox(e); console.error(e);
    return;
  }
  try {
    if (my !== token) return;
    const c = await mod.mount(el, { code, arg });
    // Pengguna sudah pindah menu selagi menu ini memuat: bereskan, jangan timpa menu yang sekarang.
    if (my !== token) { if (typeof c === 'function') c(); return; }
    cleanup = c;
  } catch (e) {
    console.error(e);
    if (my !== token) return;
    el.innerHTML = errBox(e);
  }
  window.scrollTo(0, 0);
}

setInterval(() => {
  const d = new Date(Date.now() + 7 * 3600e3);
  $('#clock').textContent = d.toISOString().slice(11, 19) + ' WIB';
}, 1000);

window.addEventListener('hashchange', route);
api('/api/status').then(s => { if (s.auth) { $('#logout').hidden = false; $('#logout').onclick = logout; } }).catch(() => {});
route();
