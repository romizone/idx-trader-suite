// Entry serverless Vercel: semua /api/* di-rewrite ke sini (lihat vercel.json).
import { handleApi } from '../lib/app.js';

export default function handler(req, res) {
  return handleApi(req, res);
}
