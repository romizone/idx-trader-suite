// Utilitas bersama semua menu.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const fmtN = (x, d = 0) => (x == null || !isFinite(x) ? '—' : Number(x).toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d }));
export function fmtRp(x) {
  if (x == null || !isFinite(x)) return '—';
  const a = Math.abs(x), s = x < 0 ? '-' : '';
  if (a >= 1e12) return s + (a / 1e12).toFixed(2) + ' T';
  if (a >= 1e9) return s + (a / 1e9).toFixed(1) + ' M';
  if (a >= 1e6) return s + (a / 1e6).toFixed(0) + ' jt';
  return s + fmtN(a);
}
export const cls = x => (x > 0 ? 'up' : x < 0 ? 'down' : 'flat');
export const sign = x => (x > 0 ? '+' : '');
export const pct = (x, d = 2) => (x == null || !isFinite(x) ? '—' : `${sign(x)}${fmtN(x, d)}%`);
export const scoreColor = s => (s >= 70 ? 'var(--up)' : s >= 50 ? 'var(--warn)' : 'var(--down)');
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const niceKey = k => k.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());

// Markdown ringan dari output API (bold, italic, code, baris baru).
export function miniMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|\s)_(.+?)_(?=\s|$)/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(t._h); t._h = setTimeout(() => (t.className = 'toast'), 3500);
}

export const app = { quota: null, market: null, universe: null };

export function setQuota(q) {
  if (!q || q.remaining == null) return;
  app.quota = q;
  $('#quotaTxt').textContent = `${fmtN(q.remaining)} / ${fmtN(q.limit)}`;
  const p = q.limit ? (q.remaining / q.limit) * 100 : 0;
  const bar = $('#quotaBar');
  bar.style.width = p + '%';
  bar.style.background = p < 15 ? 'var(--down)' : p < 40 ? 'var(--warn)' : 'var(--up)';
}
export function setMarket(m) {
  if (!m) return;
  app.market = m;
  $('#mktLabel').textContent = m.label;
  $('#mkt').classList.toggle('open', m.open);
}

// Token akses (hash password) — dikirim sebagai ?k= agar cache CDN tetap per-token.
const auth = {
  get() { try { return localStorage.getItem('idx_token') || ''; } catch { return ''; } },
  set(t) { try { t ? localStorage.setItem('idx_token', t) : localStorage.removeItem('idx_token'); } catch {} },
};
async function tokenFor(pw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('idx-suite:' + pw));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
let loginPromise = null;
function askLogin(msg = '') {
  loginPromise ||= new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'login';
    ov.innerHTML = `<form class="login-box">
      <svg viewBox="0 0 32 32" width="40" height="40"><rect width="32" height="32" rx="7" fill="#0b1220"/><path d="M5 22l7-8 5 5 10-11" stroke="#22d3a6" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <h2>IDX Trader Suite</h2><p class="flat">Masukkan password akses aplikasi.</p>
      <input type="password" class="inp" placeholder="Password" autocomplete="current-password" required>
      <div class="down" style="min-height:18px;font-size:12px">${esc(msg)}</div>
      <button class="btn primary">Masuk</button></form>`;
    document.body.appendChild(ov);
    const inp = $('input', ov);
    inp.focus();
    $('form', ov).onsubmit = async e => {
      e.preventDefault();
      const t = await tokenFor(inp.value);
      const r = await fetch('/api/auth?k=' + t);
      if (r.ok) { auth.set(t); ov.remove(); loginPromise = null; resolve(); }
      else { $('.down', ov).textContent = 'Password salah'; inp.select(); }
    };
  });
  return loginPromise;
}
export function logout() { auth.set(''); location.reload(); }

export async function api(path) {
  const t = auth.get();
  const url = t ? path + (path.includes('?') ? '&' : '?') + 'k=' + t : path;
  const r = await fetch(url);
  const j = await r.json().catch(() => ({ error: 'Respons tidak valid' }));
  if (r.status === 401 && j.auth) { auth.set(''); await askLogin(t ? 'Sesi berakhir, silakan masuk lagi' : ''); return api(path); }
  if (j && !Array.isArray(j)) { setQuota(j.quota); setMarket(j.market); }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

let uniPromise = null;
export function getUniverse() {
  uniPromise ||= api('/api/universe').then(u => (app.universe = u)).catch(e => { uniPromise = null; throw e; });
  return uniPromise;
}

// Kode saham aktif dipakai bersama menu-menu per saham.
export const currentCode = {
  get() { try { return localStorage.getItem('idx_code') || 'BBCA'; } catch { return 'BBCA'; } },
  set(c) { try { localStorage.setItem('idx_code', c); } catch {} },
};

// Input pencarian saham dengan autocomplete lokal dari universe (0 kuota).
export function stockPicker(host, { value, onPick, placeholder = 'Ketik kode / nama saham…' }) {
  host.classList.add('picker');
  host.innerHTML = `<input class="inp" autocomplete="off" spellcheck="false" placeholder="${placeholder}" value="${esc(value || '')}"><div class="picker-list"></div>`;
  const inp = $('input', host), list = $('.picker-list', host);
  let items = [], idx = 0;
  const close = () => { list.classList.remove('open'); };
  const pick = code => { inp.value = code; close(); onPick(code); };
  const draw = () => {
    list.innerHTML = items.map((s, i) => `<div class="pi ${i === idx ? 'on' : ''}" data-c="${s.code}"><b>${s.code}</b><span>${esc(s.name)}</span><em>${fmtN(s.close)}</em></div>`).join('');
    list.classList.toggle('open', items.length > 0);
  };
  inp.addEventListener('input', async () => {
    const q = inp.value.trim().toUpperCase();
    if (!q) { items = []; return draw(); }
    const u = await getUniverse().catch(() => null);
    if (!u) return;
    const starts = u.data.filter(s => s.code.startsWith(q));
    const named = u.data.filter(s => !s.code.startsWith(q) && s.name.toUpperCase().includes(q));
    items = [...starts, ...named].slice(0, 10); idx = 0; draw();
  });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { idx = Math.min(items.length - 1, idx + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter') {
      const q = inp.value.trim().toUpperCase();
      if (items[idx]) pick(items[idx].code); else if (/^[A-Z0-9]{3,6}$/.test(q)) pick(q);
    } else if (e.key === 'Escape') close();
  });
  inp.addEventListener('focus', () => inp.select());
  list.addEventListener('mousedown', e => { const d = e.target.closest('.pi'); if (d) pick(d.dataset.c); });
  inp.addEventListener('blur', () => setTimeout(close, 150));
  return { set: v => (inp.value = v), focus: () => inp.focus() };
}

// Header standar untuk menu per saham: picker + tautan ke menu saham lain.
export const STOCK_MENUS = [
  ['saham', 'Analisa'], ['bandar', 'Bandarmologi'], ['tape', 'Running Trade'], ['fundamental', 'Fundamental'],
  ['insider', 'Insider'], ['musiman', 'Musiman'], ['backtest', 'Backtest'],
];
export function stockHeader(el, view, code, onPick, extra = '') {
  el.innerHTML = `
    <div class="vhead">
      <div class="vpick"></div>
      <div class="stabs">${STOCK_MENUS.map(([k, t]) => `<a href="#/${k}/${code}" class="${k === view ? 'on' : ''}">${t}</a>`).join('')}</div>
      ${extra}
    </div>
    <div class="vbody"></div>`;
  stockPicker($('.vpick', el), { value: code, onPick: c => { currentCode.set(c); location.hash = `#/${view}/${c}`; } });
  return $('.vbody', el);
}

// Chart helper (lightweight-charts dimuat via CDN).
export function makeChart(el, height = 320, opts = {}) {
  const ch = LightweightCharts.createChart(el, {
    height, layout: { background: { color: 'transparent' }, textColor: '#7d8aa5', fontFamily: 'Inter' },
    grid: { vertLines: { color: '#16213a' }, horzLines: { color: '#16213a' } },
    rightPriceScale: { borderColor: '#1c2740' }, timeScale: { borderColor: '#1c2740' },
    crosshair: { mode: 0 }, ...opts,
  });
  const ro = new ResizeObserver(() => ch.applyOptions({ width: el.clientWidth }));
  ro.observe(el);
  ch._ro = ro;
  return ch;
}
export function disposeChart(ch) { if (ch) { ch._ro?.disconnect(); ch.remove(); } }

// live (opsional): { date, close, volume } harga realtime hari ini. Bila tanggalnya lebih baru dari histori,
// ditempel sebagai candle parsial (open = penutupan kemarin, sumber tidak mengirim OHLC intraday), warna pudar.
export function candleSeries(ch, rows, live = null) {
  const asc = [...rows].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = asc[asc.length - 1];
  if (live?.close && last && live.date > last.date) {
    const o = last.close;
    asc.push({ date: live.date, open: o, close: live.close, high: Math.max(o, live.close), low: Math.min(o, live.close), volume: live.volume || 0, live: true });
  }
  const cs = ch.addCandlestickSeries({ upColor: '#22d3a6', downColor: '#f45b69', borderVisible: false, wickUpColor: '#22d3a6', wickDownColor: '#f45b69' });
  cs.setData(asc.map(x => {
    const c = { time: x.date, open: x.open, high: x.high, low: x.low, close: x.close };
    if (x.live) c.color = c.wickColor = x.close >= x.open ? 'rgba(34,211,166,.45)' : 'rgba(244,91,105,.45)';
    return c;
  }));
  const vs = ch.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'v' });
  ch.priceScale('v').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
  vs.setData(asc.map(x => ({ time: x.date, value: x.volume, color: `rgba(${x.close >= x.open ? '34,211,166' : '244,91,105'},${x.live ? '.18' : '.35'})` })));
  if (asc[asc.length - 1]?.live) cs.setMarkers([{ time: live.date, position: 'aboveBar', color: '#7d8aa5', shape: 'circle', text: 'LIVE' }]);
  return { cs, vs, rows: asc };
}

// Keterangan bila data EOD belum sampai hari ini (hari bursa): EOD baru terbit dari sumber setelah pasar tutup.
// Libur bursa tidak dikenali, sama seperti expectedEodDate() di server.
export const wibToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export function eodNote(date) {
  const d = new Date(Date.now() + 7 * 3600e3);
  const today = wibToday(), day = d.getUTCDay(), min = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (!date || date >= today || day === 0 || day === 6) return '';
  return min < 16 * 60 + 15 ? 'data hari ini terbit setelah pasar tutup' : `EOD ${today} belum terbit dari sumber`;
}
export const dataDate = date => {
  const n = eodNote(date);
  return `Data ${esc(date)}${n ? ` <span class="warn">· ${n}</span>` : ''}`;
};

export const loading = (msg = 'Memuat…') => `<div class="empty"><span class="spin"></span> ${msg}</div>`;
export const errBox = e => `<div class="empty down">Gagal: ${esc(e.message || e)}</div>`;

// Tambah/hapus watchlist (localStorage).
export const watchlist = {
  get() { try { return JSON.parse(localStorage.getItem('idx_watch') || '[]'); } catch { return []; } },
  set(a) { try { localStorage.setItem('idx_watch', JSON.stringify(a)); } catch {} },
  has(c) { return this.get().includes(c); },
  toggle(c) { const a = this.get(); const i = a.indexOf(c); i >= 0 ? a.splice(i, 1) : a.push(c); this.set(a); return i < 0; },
};

export function subDate(date, days) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
