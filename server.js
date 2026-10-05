// Server lokal: static file + API. Di Vercel, API dilayani api/index.js dan static dari public/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env opsional */ }
const { handleApi } = await import('./lib/app.js');

const PORT = Number(process.env.PORT || 3070);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

http.createServer(async (req, res) => {
  // URL rusak (mis. "/%") tidak boleh menjatuhkan server.
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res);
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(file));
  } catch (e) {
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Bad request');
  }
}).listen(PORT, () => console.log(`IDX Trader Suite → http://localhost:${PORT}`));
