// Inti backend (stateless): proxy ke IDX Edge PRO + cache + engine analisa.
// Dipakai oleh server.js (lokal) dan api/index.js (Vercel serverless).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeRow, computeFlow } from './metrics.js';
import { computeTech, computeForeign, computeMA200 } from './tech.js';
import { computeSquant } from './squant.js';

const BASE = 'https://stock.arjum.com';
const IS_VERCEL = !!process.env.VERCEL;
const CACHE_DIR = IS_VERCEL ? '/tmp/idx-cache' : path.join(process.cwd(), 'cache');
try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch {}

const env = () => ({
  key: process.env.ARJUM_API_KEY,
  scanTop: Number(process.env.SCAN_TOP || 60),
  minValue: Number(process.env.MIN_VALUE || 3e9),
  password: process.env.APP_PASSWORD || '',
});
export const tokenFor = pw => crypto.createHash('sha256').update('idx-suite:' + pw).digest('hex').slice(0, 32);

// ---------------------------------------------------------------- upstream + kuota
const quota = { limit: null, remaining: null, updatedAt: null };
const QUOTA_FILE = path.join(CACHE_DIR, 'quota.json');
const wibDay = t => new Date(new Date(t).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
try {
  const q = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf8'));
  if (wibDay(q.updatedAt) === wibDay(Date.now())) Object.assign(quota, q);
} catch {}

let active = 0;
const waiters = [];
async function withSlot(fn) {
  if (active >= 5) await new Promise(r => waiters.push(r));
  active++;
  try { return await fn(); } finally { active--; waiters.shift()?.(); }
}
async function upstream(p) {
  const { key } = env();
  if (!key) throw Object.assign(new Error('ARJUM_API_KEY belum di-set di environment'), { status: 500 });
  return withSlot(async () => {
    // Retry sekali untuk timeout / error jaringan / 5xx dari sumber.
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetch(BASE + p, { headers: { 'X-API-Key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) });
        if (res.status < 500 || attempt >= 1) break;
      } catch (e) { if (attempt >= 1) throw e; }
      await new Promise(r => setTimeout(r, 800));
    }
    const lim = res.headers.get('x-ratelimit-limit'), rem = res.headers.get('x-ratelimit-remaining');
    if (lim) quota.limit = Number(lim);
    if (rem) quota.remaining = Number(rem);
    quota.updatedAt = new Date().toISOString();
    try { fs.writeFileSync(QUOTA_FILE, JSON.stringify(quota)); } catch {}
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).detail || text; } catch {}
      throw Object.assign(new Error(`Upstream ${res.status}: ${msg}`), { status: res.status === 404 ? 404 : 502 });
    }
    return JSON.parse(text);
  });
}

// Cache memori + disk (TTL ms). Permintaan paralel untuk key yang sama digabung.
// ttl boleh berupa fungsi (nilai) → ms, dihitung saat disimpan (mis. lebih pendek bila data belum terbaru).
const mem = new Map(), inflight = new Map();
const cacheFile = k => path.join(CACHE_DIR, k.replace(/[^a-zA-Z0-9_.-]/g, '_') + '.json');
async function cached(key, ttl, loader) {
  const now = Date.now();
  let m = mem.get(key);
  if (!m) { try { m = JSON.parse(fs.readFileSync(cacheFile(key), 'utf8')); mem.set(key, m); } catch {} }
  // TTL tersimpan dan TTL angka saat ini: pakai yang terpendek (mis. pasar baru buka lagi).
  if (m && now - m.t < Math.min(m.ttl ?? Infinity, typeof ttl === 'function' ? (m.ttl ?? 0) : ttl)) return m.v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const v = await loader();
    const e = { t: Date.now(), v };
    if (typeof ttl === 'function') e.ttl = ttl(v);
    mem.set(key, e);
    if ((e.ttl ?? ttl) > 60_000) try { fs.writeFileSync(cacheFile(key), JSON.stringify(e)); } catch {}
    return v;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
function uncache(key) { mem.delete(key); try { fs.rmSync(cacheFile(key), { force: true }); } catch {} }

// ---------------------------------------------------------------- jam bursa (WIB)
export function wibNow() {
  const d = new Date(Date.now() + 7 * 3600_000);
  return { day: d.getUTCDay(), min: d.getUTCHours() * 60 + d.getUTCMinutes(), date: d.toISOString().slice(0, 10) };
}
export function marketStatus() {
  const { day, min } = wibNow();
  if (day === 0 || day === 6) return { open: false, label: 'Libur akhir pekan' };
  if (min < 8 * 60 + 45) return { open: false, label: 'Pra-pembukaan' };
  if (min < 9 * 60) return { open: false, label: 'Pre-opening' };
  const s1End = day === 5 ? 11 * 60 + 30 : 12 * 60, s2Start = day === 5 ? 14 * 60 : 13 * 60 + 30;
  if (min < s1End) return { open: true, label: 'Sesi 1' };
  if (min < s2Start) return { open: false, label: 'Istirahat siang' };
  if (min < 15 * 60 + 50) return { open: true, label: 'Sesi 2' };
  if (min < 16 * 60 + 15) return { open: true, label: 'Pre-closing / Post-trading' };
  return { open: false, label: 'Pasar tutup' };
}
// Tanggal EOD terbaru yang seharusnya sudah ada: hari ini setelah bursa tutup, selain itu hari bursa sebelumnya.
// (Libur bursa tidak dikenali → data tampak "belum terbaru" dan hanya dicek ulang lebih sering.)
export function expectedEodDate() {
  const { day, min } = wibNow();
  const d = new Date(Date.now() + 7 * 3600_000);
  if (day >= 1 && day <= 5 && min >= 16 * 60 + 15) return d.toISOString().slice(0, 10);
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
const isStale = date => !!date && date < expectedEodDate();
// Selama EOD terbaru belum terbit: cek tiap 10 mnt di jam rilis (16:15–21:00 WIB), di luar itu
// (kemungkinan libur bursa) cukup tiap jam supaya tidak boros kuota.
const staleTtl = () => { const { min } = wibNow(); return min >= 16 * 60 + 15 && min < 21 * 60 ? 10 * 60_000 : 3600_000; };
// ms sampai 16:15 WIB berikutnya (saat expectedEodDate berganti ke hari ini). TTL data yang "sudah terbaru"
// dibatasi ini supaya cache yang disimpan sebelum bursa tutup tidak menahan pengecekan tanggal baru berjam-jam.
function msToEodFlip() {
  const now = Date.now(), d = new Date(now + 7 * 3600_000);
  d.setUTCHours(16, 15, 0, 0);
  let t = d.getTime() - 7 * 3600_000;
  if (t <= now) t += 24 * 3600_000;
  return Math.max(60_000, t - now);
}
const freshTtl = max => Math.min(max, msToEodFlip());

const eodTtl = () => (marketStatus().open ? 30 * 60_000 : 6 * 3600_000);
// CDN pendek bila data yang dikirim belum sampai tanggal EOD terbaru, supaya cepat ikut terbarui.
const eodCdn = (q, body) => (marketStatus().open ? 900 : isStale(body?.date) ? 300 : 3600);
const HIST = 250; // cukup untuk MA200; dipakai bersama semua menu

// ---------------------------------------------------------------- loader data
// Tanggal universe dicek murah (1 call); 20 halaman penuh hanya diambil ulang saat tanggalnya berganti.
async function loadUniverse() {
  const date = await cached('universe_date', v => (isStale(v) ? staleTtl() : freshTtl(3 * 3600_000)),
    async () => (await upstream('/api/market-cap?per_page=1&page=1')).date);
  return cached(`universe_${date}`, 24 * 3600_000, async () => {
    const first = await upstream('/api/market-cap?per_page=50&page=1');
    const rest = [];
    for (let p = 2; p <= first.total_pages; p++) rest.push(upstream(`/api/market-cap?per_page=50&page=${p}`));
    const pages = [first, ...(await Promise.all(rest))];
    return { date: first.date, data: pages.flatMap(x => x.data) };
  });
}
const HIST_STALE_TTL = 10 * 60_000;
// Scan paksa: buang histori yang tersimpan sebelum sumber memuat tanggal universe.
function uncacheStaleHist() {
  for (const [k, e] of mem) if (k.startsWith('hist_') && e.ttl === HIST_STALE_TTL) uncache(k);
}
// Histori harian hanya berubah sekali sehari: kunci cache memakai tanggal data universe.
// Bila histori dari sumber belum memuat tanggal itu, cache sebentar saja agar tidak tertahan seharian.
async function loadHistory(code, limit = HIST) {
  const { date } = await loadUniverse();
  const lastDate = h => (h.rows || []).reduce((m, r) => (r.date > m ? r.date : m), '');
  return cached(`hist_${code}_${limit}_${date}`, h => (lastDate(h) >= date ? 24 * 3600_000 : HIST_STALE_TTL),
    () => upstream(`/api/history/${code}?limit=${limit}`));
}
// Tanggal running trade yang tersedia di sumber (terbaru dulu). Tanpa parameter tanggal, /api/done-details
// mengembalikan gabungan banyak hari (total & halaman lintas hari), jadi "terbaru" selalu diresolusi ke tanggal ini.
const loadTapeDates = code => cached(`tdates_${code}`, v => (isStale(v.dates?.[0]) ? staleTtl() : freshTtl(3 * 3600_000)),
  () => upstream(`/api/done-details/dates?code=${code}`));
// Tanggal lampau yang sudah berisi tidak berubah lagi; hari ini saat pasar buka bisa bertambah.
const tapeTtl = date => v => (date < wibNow().date && v.total > 0 ? 24 * 3600_000 : marketStatus().open ? 20_000 : isStale(v.date) || !v.total ? staleTtl() : 3600_000);
const loadSwingRaw = () => cached('swing', eodTtl(), () => upstream('/api/screener/latest'));
// Untuk menu lain screener swing hanya pelengkap (bonus skor/tag): gagal memuat tidak boleh menggagalkan menu itu.
const loadSwing = () => loadSwingRaw().catch(() => ({ rows: [] }));
// /api/price tidak selalu mengirim source_date; tanpa itu harga hari ini tidak ditempel ke histori.
const loadPrice = code => cached(`price_${code}`, 15_000, async () => {
  const p = await upstream(`/api/price/${code}`);
  // Hanya di hari bursa setelah pasar buka: di luar itu snapshot sesi terakhir bukan data "hari ini".
  const { day, min, date } = wibNow();
  if (!p.source_date && !p.no_trade_today && p.freq > 0 && day >= 1 && day <= 5 && min >= 9 * 60) p.source_date = date;
  return p;
});

// Saham paling likuid + historinya: dipakai Scalper, Teknikal, Asing, Heatmap.
async function loadCandidates(scanTop = env().scanTop, minValue = env().minValue) {
  const uni = await loadUniverse();
  const list = uni.data
    .map(s => ({ ...s, valueProxy: (s.turnover_ratio || 0) * (s.market_cap || 0) }))
    .filter(s => s.close >= 50 && s.valueProxy >= minValue)
    .sort((a, b) => b.valueProxy - a.valueProxy)
    .slice(0, scanTop);
  const errors = [];
  const hists = await Promise.all(list.map(c => loadHistory(c.code).then(h => h.rows).catch(e => { errors.push(`${c.code}: ${e.message}`); return null; })));
  return { uni, list: list.map((c, i) => ({ ...c, hist: hists[i] })).filter(c => c.hist), errors };
}

async function rowsFor(codes, live) {
  const [uni, swing] = await Promise.all([loadUniverse(), loadSwing()]);
  const byCode = new Map(uni.data.map(s => [s.code, s]));
  const sw = new Map((swing.rows || []).map(r => [r.stock_code, r]));
  return Promise.all(codes.map(async code => {
    try {
      const [h, price] = await Promise.all([loadHistory(code), live ? loadPrice(code) : null]);
      const u = byCode.get(code);
      return computeRow({ code, name: u?.name || code, marketCap: u?.market_cap, hist: h.rows, live: price, swing: sw.get(code) }) || { code, error: 'Data histori kurang' };
    } catch (e) { return { code, error: e.message }; }
  }));
}

// ---------------------------------------------------------------- routes
const CODE_RE = /^[A-Z0-9]{3,6}$/, DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const bad = msg => Object.assign(new Error(msg), { status: 400 });
function needCode(q) { const c = (q.get('code') || '').toUpperCase(); if (!CODE_RE.test(c)) throw bad('Kode saham tidak valid'); return c; }
// Bilangan bulat dari query string dengan batas; nilai tidak valid → default (bukan NaN yang terkirim ke sumber).
const intOf = (v, def, lo, hi) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
let lastForce = 0;
const codesOf = (q, max) => (q.get('codes') || '').split(',').map(s => s.trim().toUpperCase()).filter(c => CODE_RE.test(c)).slice(0, max);

// Setiap route: [handler, detik cache CDN (fungsi atau angka)]
const routes = {
  '/api/status': [async () => ({ market: marketStatus(), wib: wibNow(), auth: !!env().password }), 0],
  '/api/auth': [async () => ({ ok: true }), 0],

  '/api/scan': [async q => {
    // Scan paksa dibatasi sekali per menit supaya tidak bisa dipakai menghabiskan kuota sumber.
    if (q.get('force') === '1' && Date.now() - lastForce > 60_000) { lastForce = Date.now(); uncache('universe_date'); uncache('swing'); uncacheStaleHist(); }
    const [{ uni, list, errors }, swing] = await Promise.all([loadCandidates(), loadSwing()]);
    const sw = new Map((swing.rows || []).map(r => [r.stock_code, r]));
    const rows = list.map(c => computeRow({ code: c.code, name: c.name, marketCap: c.market_cap, hist: c.hist, swing: sw.get(c.code) })).filter(Boolean).sort((a, b) => b.score - a.score);
    return { at: new Date().toISOString(), date: uni.date, expectedDate: expectedEodDate(), universeCount: uni.data.length, candidateCount: list.length, rows, errors };
  }, eodCdn],
  '/api/live': [async q => ({ at: new Date().toISOString(), rows: await rowsFor(codesOf(q, 40), true) }), 15],
  '/api/watch': [async q => ({ at: new Date().toISOString(), rows: await rowsFor(codesOf(q, 30), q.get('live') === '1') }), (q, body) => (q.get('live') === '1' ? 15 : eodCdn(q, { date: body?.rows?.find(r => r.date)?.date }))],
  '/api/tech': [async () => {
    const { uni, list } = await loadCandidates();
    return { date: uni.date, rows: list.map(c => computeTech({ code: c.code, name: c.name, hist: c.hist })).filter(Boolean) };
  }, eodCdn],
  '/api/foreign': [async () => {
    const { uni, list } = await loadCandidates();
    return { date: uni.date, rows: list.map(c => computeForeign({ code: c.code, name: c.name, hist: c.hist })).filter(Boolean) };
  }, eodCdn],
  '/api/ma200': [async q => {
    const top = [60, 120, 200].includes(Number(q.get('top'))) ? Number(q.get('top')) : 120;
    const { uni, list, errors } = await loadCandidates(top, 1e9);
    const rows = list.map(c => computeMA200({ code: c.code, name: c.name, hist: c.hist, value: c.valueProxy })).filter(Boolean);
    return { date: uni.date, scanned: list.length, noData: list.length - rows.length, rows, errors };
  }, eodCdn],
  '/api/squant': [async q => {
    const top = [60, 120, 200].includes(Number(q.get('top'))) ? Number(q.get('top')) : 120;
    const { uni, list, errors } = await loadCandidates(top, 1e9);
    const rows = list.map(c => computeSquant({ code: c.code, name: c.name, hist: c.hist, value: c.valueProxy })).filter(Boolean);
    return { date: uni.date, scanned: list.length, rows, errors };
  }, eodCdn],
  // Detail 1 saham untuk grafik Squant: OHLCV + sinyal per bar + gelombang EW + Trend Template (histori bersama, 0–1 call).
  '/api/squant-chart': [async q => {
    const code = needCode(q);
    const [h, uni] = await Promise.all([loadHistory(code), loadUniverse()]);
    const u = uni.data.find(s => s.code === code);
    const r = computeSquant({ code, name: u?.name || code, hist: h.rows, value: u ? (u.turnover_ratio || 0) * (u.market_cap || 0) : null }, true);
    if (!r) throw Object.assign(new Error('Data histori saham ini belum cukup'), { status: 404 });
    return r;
  }, eodCdn],
  '/api/universe': [async () => {
    const uni = await loadUniverse();
    return {
      date: uni.date,
      data: uni.data.map(s => ({ code: s.code, name: s.name, close: s.close, shares: s.listed_shares, mcap: s.market_cap, turnover: s.turnover_ratio, value: (s.turnover_ratio || 0) * (s.market_cap || 0) })),
    };
  }, eodCdn],
  '/api/swing': [loadSwingRaw, eodCdn],
  '/api/quote': [async q => {
    const code = needCode(q);
    const [h, price, uni, swing] = await Promise.all([loadHistory(code), loadPrice(code), loadUniverse(), loadSwing()]);
    const u = uni.data.find(s => s.code === code);
    const sw = (swing.rows || []).find(r => r.stock_code === code);
    return { row: computeRow({ code, name: u?.name || code, marketCap: u?.market_cap, hist: h.rows, live: price, swing: sw }), price, dataAvailable: h.data_available };
  }, 15],
  '/api/candles': [async q => {
    const code = needCode(q);
    const limit = [120, 250, 500].includes(Number(q.get('limit'))) ? Number(q.get('limit')) : 250;
    const frame = ['weekly', 'monthly'].includes(q.get('frame')) ? q.get('frame') : 'daily';
    // limit ≤ 250 memakai cache histori bersama (1 call per saham per hari).
    const h = frame !== 'daily' ? await cached(`hist_${code}_${frame}_${limit}`, eodTtl(), () => upstream(`/api/history/${code}?limit=${limit}&frame=${frame}`))
      : await loadHistory(code, limit > HIST ? limit : HIST);
    return { code, frame, rows: h.rows.slice(0, limit), dataAvailable: h.data_available };
  }, eodCdn],
  '/api/flow': [async q => {
    const code = needCode(q);
    const pages = intOf(q.get('pages'), 3, 1, 5);
    const date = (await loadTapeDates(code)).dates?.[0] || '';
    const url = p => `/api/done-details?code=${code}&per_page=100&page=${p}${date ? '&date=' + date : ''}`;
    const first = await cached(`tape_${code}_${date}_1`, tapeTtl(date), () => upstream(url(1)));
    const more = [];
    for (let p = 2; p <= Math.min(pages, first.total_pages || 1); p++) more.push(cached(`tape_${code}_${date}_${p}`, tapeTtl(date), () => upstream(url(p))));
    const trades = [first, ...(await Promise.all(more))].flatMap(x => x.data || []);
    return { code, date: first.date, totalTrades: first.total, ...computeFlow(trades) };
  }, (q, body) => (marketStatus().open ? 30 : isStale(body?.date) ? 120 : 600)],
  '/api/tape': [async q => {
    const code = needCode(q);
    const page = intOf(q.get('page'), 1, 1, 10000);
    // "Terbaru" = tanggal paling baru yang tersedia di sumber (daftar tanggal di-cache, dicek ulang tiap 10 mnt
    // selama EOD hari ini belum terbit). Kunci cache per tanggal dipakai bersama pilihan tanggal manual.
    const { dates = [] } = await loadTapeDates(code);
    const date = DATE_RE.test(q.get('date') || '') ? q.get('date') : dates[0] || '';
    const p = new URLSearchParams({ code, page: String(page), per_page: '100' });
    if (date) p.set('date', date);
    const j = await cached(`tape_${code}_${date}_${page}`, tapeTtl(date), () => upstream(`/api/done-details?${p}`));
    return { ...j, latest: !q.get('date'), dates, expectedDate: expectedEodDate(), summary: computeFlow(j.data || []) };
  }, (q, body) => {
    const recent = !q.get('date') || q.get('date') >= wibNow().date;
    if (recent && marketStatus().open) return 20;
    if (recent || !body?.total) return isStale(body?.date) || !body?.total ? 120 : 600;
    return 86400;
  }],
  '/api/analysis': [async q => { const code = needCode(q); return cached(`an_${code}`, eodTtl(), () => upstream(`/api/analysis/${code}`)); }, eodCdn],
  '/api/broker-summary': [async q => {
    const code = needCode(q);
    const p = new URLSearchParams({ broker_limit: '60', level_limit: '20' });
    for (const k of ['start_date', 'end_date']) if (DATE_RE.test(q.get(k) || '')) p.set(k, q.get(k));
    if (['F', 'D'].includes(q.get('flow'))) p.set('flow', q.get('flow'));
    return cached(`bs_${code}_${p}`, eodTtl(), () => upstream(`/api/broker-summary/${code}?${p}`));
  }, eodCdn],
  '/api/broker-accum': [async q => {
    const code = needCode(q);
    const p = new URLSearchParams({ top: String(intOf(q.get('top'), 3, 1, 5)) });
    for (const k of ['start_date', 'end_date']) if (DATE_RE.test(q.get(k) || '')) p.set(k, q.get(k));
    const brokers = (q.get('brokers') || '').toUpperCase().replace(/[^A-Z0-9,]/g, '');
    if (brokers) p.set('brokers', brokers);
    return cached(`ba_${code}_${p}`, eodTtl(), () => upstream(`/api/broker-accumulation/${code}?${p}`));
  }, eodCdn],
  '/api/seasonal': [async q => { const code = needCode(q); return cached(`se_${code}`, 24 * 3600_000, () => upstream(`/api/seasonal/${code}`)); }, 86400],
  '/api/financials': [async q => {
    const code = needCode(q);
    const type = ['INCOME_STATEMENT', 'BALANCE_SHEET', 'CASH_FLOW_REPORT'].includes(q.get('type')) ? q.get('type') : 'INCOME_STATEMENT';
    const period = q.get('period') === 'annually' ? 'annually' : 'quarterly';
    const limit = intOf(q.get('limit'), 8, 1, 40);
    const p = `report_type=${type}&period=${period}&limit=${limit}`;
    return cached(`fs_${code}_${p}`, 24 * 3600_000, () => upstream(`/api/financial-statements/${code}?${p}`));
  }, 86400],
  '/api/insiders': [async q => {
    const code = needCode(q);
    const p = new URLSearchParams({ page: String(intOf(q.get('page'), 1, 1, 10000)), limit: '15' });
    if (['buy', 'sell', 'cross'].includes(q.get('action'))) p.set('action_type', q.get('action'));
    return cached(`in_${code}_${p}`, 6 * 3600_000, () => upstream(`/api/insiders/${code}?${p}`));
  }, 21600],
};

// Handler Node (req, res). pathname opsional (untuk rewrite Vercel).
export async function handleApi(req, res) {
  const url = new URL(req.url, 'http://x');
  const pathname = url.searchParams.get('__path') ? '/api/' + url.searchParams.get('__path') : url.pathname;
  url.searchParams.delete('__path');
  const send = (status, body, cdn = 0) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Cache CDN Vercel: kunci cache = URL lengkap (termasuk token ?k=), jadi aman dengan password.
    res.setHeader('Cache-Control', status === 200 && cdn > 0 ? `public, max-age=0, s-maxage=${cdn}, stale-while-revalidate=${cdn}` : 'no-store');
    res.end(JSON.stringify(body));
  };
  const route = routes[pathname];
  if (!route) return send(404, { error: 'Endpoint tidak ditemukan' });
  const { password } = env();
  if (password && pathname !== '/api/status' && url.searchParams.get('k') !== tokenFor(password)) {
    return send(401, { error: 'Password diperlukan', auth: true });
  }
  try {
    const [fn, cdn] = route;
    const body = await fn(url.searchParams);
    const out = Array.isArray(body) ? body : { ...body, quota, market: marketStatus() };
    // Hasil parsial (ada saham gagal dimuat) hanya di-cache sebentar supaya cepat terisi ulang.
    const partial = body?.errors?.length > 0;
    const ttl = url.searchParams.get('force') === '1' ? 0 : typeof cdn === 'function' ? cdn(url.searchParams, body) : cdn;
    send(200, out, partial ? Math.min(ttl, 60) : ttl);
  } catch (e) {
    console.error(pathname, e.message);
    send(e.status && e.status < 600 ? e.status : 500, { error: e.message, quota });
  }
}
