# IDX Trader Suite

Aplikasi analisa saham BEI berbasis API [stock.arjum.com](https://stock.arjum.com) (IDX Edge PRO).

## Menu

| Menu | Isi | Endpoint | Biaya kuota |
|---|---|---|---|
| ⚡ Scalper | Skor scalping, plan SL/TP, live price, order flow | market-cap, history, price, done-details | lihat tabel di bawah |
| 🎯 Swing | Screener V5 per bucket (WR, potensi, drawdown) | screener/latest | 1 (cache) |
| 🏛 Market | Seluruh 963 emiten, market cap, turnover, top list | market-cap | 0 (pakai cache universe) |
| ⭐ Watchlist | Daftar pantau (disimpan di browser) + skor & plan | history, price | 1/saham baru, live 1/saham |
| 📈 Analisa Saham | Harga, grafik + MA20/50, plan, metrik, analisa otomatis, order flow | price, history, analysis | ±2 |
| 🏦 Bandarmologi | Broker summary per rentang & flow, sinyal akumulasi top 1/3/5, tren akumulasi broker | broker-summary, broker-accumulation | 2 |
| 📊 Fundamental | Laba rugi / neraca / arus kas, kuartalan/tahunan, YoY | financial-statements | 1 |
| 🕴 Insider | Transaksi direksi/komisaris, filter beli/jual | insiders | 1/halaman |
| 📅 Musiman | Heatmap return bulanan & peluang naik | seasonal | 1 |
| 📏 SwingMA200 | Harga di atas MA200 harian tapi ≤ 12% di atasnya (batas bisa diubah), slope MA200, MA50 vs MA200, retest, skor setup | history 250 hari (120 saham likuid) | 0 jika cache terisi |
| 🧭 Squant Screener | Elliott Wave (ZigZag 4/8/16, impuls (1)–(5), koreksi ABC, fib 0,5–0,854) + breakout kompresi SMA 3/5/10/20 (Four Horsemen, +Volume, +Kompresi, Siap breakout, Step↑) + Trend Template 6 syarat, skor gabungan, grafik dengan gelombang & sinyal | history 250 hari (60/120/200 saham likuid) | 0 jika cache terisi |
| 📐 Teknikal | Screener trend MA, RSI, MACD, breakout, golden cross | (histori hasil scan) | 0 |
| 🌏 Aliran Asing | Net asing hari ini/5H/20H/60H, streak, porsi asing | (histori hasil scan) | 0 |
| 🟩 Heatmap | Treemap saham likuid, ukuran = value/mcap, warna = chg/RVOL/skor | (hasil scan) | 0 |
| 🧾 Running Trade | Tape done details per tanggal, filter lot/broker/HAKA-HAKI | done-details | 1/halaman |
| ⚖️ Bandingkan | Performa relatif ≤ 6 saham, volatilitas, drawdown, korelasi | history | 0–1/saham |
| 🧪 Backtest | MA cross, RSI, breakout, MACD + SL/TP & fee, kurva ekuitas | history (500 hari) | 1 |
| 🧮 Kalkulator | Position sizing, fee & break-even, ARA/ARB + fraksi, average | — | 0 |
| 📓 Jurnal Trading | Catat trade, win rate, profit factor, kurva P/L, CSV | — (browser) | 0 |

Pencarian saham memakai data universe lokal (0 kuota). Tautan bisa dibagikan, mis. `#/bandar/BBRI`.

## Jalankan

```bash
npm start
```

Buka http://localhost:3070. Butuh Node ≥ 21, tanpa dependency. API key ada di `.env` (`ARJUM_API_KEY`).

## Deploy (Vercel)

Produksi: https://idx-trader-suite.vercel.app (project `idx-trader-suite`).

- `api/index.js` → serverless function; semua `/api/*` di-rewrite ke sana (`vercel.json`). Static dari `public/`.
- Environment (Production): `ARJUM_API_KEY`, `SCAN_TOP`, `MIN_VALUE`. Opsional `APP_PASSWORD` untuk mengunci akses (saat ini tidak dipakai — mode demo, terbuka untuk umum).
- Respons API di-cache di CDN Vercel (`s-maxage`) dengan kunci URL yang memuat token password, jadi hemat kuota tanpa membuka akses.
- Pasang password lagi: `vercel env add APP_PASSWORD production`, lalu `vercel deploy --prod`.
- Deploy ulang setelah mengubah kode: `vercel deploy --prod`.

## Cara kerja Scalper

1. **Universe**: `/api/market-cap` (20 halaman) → saham harga ≥ 50 dengan estimasi nilai transaksi ≥ `MIN_VALUE`, lalu diambil `SCAN_TOP` paling likuid.
2. **Metrik** per saham dari `/api/history` (OHLCV + asing): RVOL, ATR14%, biaya tick, posisi close, VWAP, breakout 5 hari, net asing, jarak ke ARA.
3. **Skor 0–100** = likuiditas (25) + volatilitas ATR ideal 4–8% (20) + RVOL (20) + momentum (20) + biaya tick (15) ± bonus/penalti (breakout, asing, screener swing, dekat ARA).
4. **Plan**: SL = −max(2 tick, 0,4 ATR), TP1 = +max(3 tick, 0,6 ATR), TP2 = +max(5 tick, 1 ATR), dibatasi ARA.
5. **Live**: `/api/price` untuk Top 20 hasil filter (1 call/saham, cache 15 dtk).
6. **Order flow**: `/api/done-details` 300 transaksi terakhir → HAKA/HAKI, broker net buyer/seller, transaksi terbesar.

## Kuota (kuota harian API, reset 00:00 WIB)

| Aksi | Biaya |
|---|---|
| Scan pertama per sesi data | ±81 call (lalu di-cache 6 jam; 30 mnt saat pasar buka) |
| Scan ulang | 21 call |
| Update live | 20 call |
| Order flow | 3 call |
| Analisa otomatis | 1 call |

Auto-live default 5 menit (≈ 240 call/jam) dan otomatis berhenti bila sisa kuota < 100. Interval 60 dtk ≈ 1.200 call/jam — melebihi kuota harian.

Alat bantu analisa, bukan rekomendasi investasi.
