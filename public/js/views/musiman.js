// Menu Musiman — heatmap return bulanan per tahun + probabilitas naik.
import { $, api, fmtN, cls, stockHeader, loading, errBox } from '../core.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ID = { May: 'Mei', Aug: 'Agu', Oct: 'Okt', Dec: 'Des' };

function heat(v) {
  if (v == null) return 'transparent';
  const a = Math.min(1, Math.abs(v) / 12) * 0.75 + 0.08;
  return v >= 0 ? `rgba(34,211,166,${a})` : `rgba(244,91,105,${a})`;
}

export async function mount(el, { code }) {
  const body = stockHeader(el, 'musiman', code);
  body.innerHTML = loading('Memuat data musiman…');
  let j;
  try { j = await api('/api/seasonal?code=' + code); } catch (e) { body.innerHTML = errBox(e); return; }
  if (!el.isConnected) return; // pengguna sudah pindah menu selagi data dimuat
  const years = j.years || [];
  const sum = j.summary || {};
  const cur = MONTHS[new Date(Date.now() + 7 * 3600e3).getUTCMonth()];
  const nxt = MONTHS[(MONTHS.indexOf(cur) + 1) % 12];
  const ranked = MONTHS.filter(m => sum[m]).sort((a, b) => sum[b].avg - sum[a].avg);
  const best = ranked[0], worst = ranked[ranked.length - 1];
  const nm = m => ID[m] || m;
  const card = (m, title) => sum[m] ? `<div class="kpi"><div class="l">${title} · ${nm(m)}</div>
    <div class="v ${cls(sum[m].avg)}">${sum[m].avg >= 0 ? '+' : ''}${fmtN(sum[m].avg, 2)}%</div>
    <div class="s">naik ${sum[m].up}/${sum[m].total} tahun · peluang ${fmtN(sum[m].up_prob, 0)}%</div></div>` : '';

  const maxAvg = Math.max(...MONTHS.map(m => Math.abs(sum[m]?.avg || 0))) || 1;
  body.innerHTML = `
    <div class="kpis inline">${card(cur, 'Bulan ini')}${card(nxt, 'Bulan depan')}${card(best, 'Terbaik')}${card(worst, 'Terburuk')}</div>
    <div class="card">
      <h3>Return bulanan (%) · ${years[0]}–${years[years.length - 1]}</h3>
      <div class="tablewrap flush"><table class="heat">
        <thead><tr><th>Tahun</th>${MONTHS.map(m => `<th class="${m === cur ? 'cur' : ''}">${nm(m)}</th>`).join('')}<th>Rata2</th></tr></thead>
        <tbody>
          ${years.map(y => `<tr><td class="yr">${y}</td>${MONTHS.map(m => {
            const v = j.monthly_returns?.[m]?.[y];
            return `<td style="background:${heat(v)}" class="${m === cur ? 'cur' : ''}">${v == null ? '' : fmtN(v, 1)}</td>`;
          }).join('')}<td class="${cls(j.yearly_avg?.[y])} avg">${fmtN(j.yearly_avg?.[y], 2)}</td></tr>`).join('')}
          <tr class="sumrow"><td class="yr">Rata2</td>${MONTHS.map(m => `<td class="${cls(sum[m]?.avg)} ${m === cur ? 'cur' : ''}">${fmtN(sum[m]?.avg, 1)}</td>`).join('')}<td></td></tr>
          <tr class="sumrow"><td class="yr">% naik</td>${MONTHS.map(m => `<td class="${m === cur ? 'cur' : ''}">${fmtN(sum[m]?.up_prob, 0)}</td>`).join('')}<td></td></tr>
        </tbody>
      </table></div>
    </div>
    <div class="card"><h3>Rata-rata return per bulan</h3>
      <div class="mbars">${MONTHS.map(m => {
        const v = sum[m]?.avg || 0, h = (Math.abs(v) / maxAvg) * 50;
        return `<div class="mb ${m === cur ? 'cur' : ''}" title="${nm(m)}: ${fmtN(v, 2)}% · peluang naik ${fmtN(sum[m]?.up_prob, 0)}%">
          <div class="mb-track"><i class="${v >= 0 ? 'pos' : 'neg'}" style="height:${h}%;${v >= 0 ? 'bottom:50%' : 'top:50%'}"></i></div>
          <span>${nm(m)}</span><em class="${cls(v)}">${fmtN(v, 1)}</em></div>`;
      }).join('')}</div>
      <div class="flat" style="font-size:11.5px;margin-top:8px">Pola historis tidak menjamin hasil ke depan — gunakan sebagai konteks, bukan sinyal tunggal.</div>
    </div>`;
}
