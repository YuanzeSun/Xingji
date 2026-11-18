import { escape as e } from './html.js';

export const rankingViews = { bars: '条形图', columns: '柱状图', donut: '环形图' };
const sliceColors = ['#32614d', '#af7844', '#527d97', '#aa6258', '#7b8750', '#806789'];
const otherColor = '#929888';
const proportion = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
const share = (count, total) => count / total < .001 ? '&lt;0.1%' : proportion.format(count / total);

function donutMarkup(rows) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const split = rows.length > sliceColors.length ? sliceColors.length - 1 : rows.length;
  const other = rows.slice(split);
  const parts = rows.slice(0, split).map((row, index) => ({ ...row, color: sliceColors[index] }));
  if (other.length) parts.push({ name: `其他（${other.length} 项）`, count: other.reduce((sum, row) => sum + row.count, 0), color: otherColor });

  let end = 0;
  const stops = parts.map(row => {
    const start = end;
    end += row.count;
    return `${row.color} ${start / total * 100}% ${end / total * 100}%`;
  });
  const entry = row => `<span class="statistics-ring-name">${e(row.name)}</span><span class="statistics-ring-count">${row.count} 次</span><span class="statistics-ring-share">${share(row.count, total)}</span>`;
  const key = row => `<span class="statistics-ring-swatch" style="--slice:${row.color}" aria-hidden="true"></span>${entry(row)}`;
  const legend = parts.slice(0, split).map(row => `<li><div class="statistics-ring-entry">${key(row)}</div></li>`);
  if (other.length) {
    legend.push(`<li><details class="statistics-ring-other"><summary class="statistics-ring-entry">${key(parts.at(-1))}</summary><ul>${other.map(row => `<li class="statistics-ring-entry">${entry(row)}</li>`).join('')}</ul></details></li>`);
  }
  return `<div class="statistics-donut"><div class="statistics-ring" style="--slices:${stops.join(',')}" aria-label="合计 ${total} 次"><strong>${total}</strong><span>次</span></div><ul class="statistics-ring-legend">${legend.join('')}</ul></div>`;
}

export function rankingChartMarkup(title, rows, view) {
  if (!rows.length) return '<p class="statistics-empty">暂无记录</p>';
  if (view === 'donut') return donutMarkup(rows);
  const high = rows.reduce((max, row) => Math.max(max, row.count), 1);
  if (view === 'columns') {
    return `<div class="statistics-column-scroll" tabindex="0" aria-label="${title}柱状图"><ol class="statistics-columns-plot" style="--columns:${rows.length}">${rows.map(({ name, count }) => `<li><div class="statistics-column-track"><div class="statistics-column-bar" style="height:${count / high * 100}%"><span>${count} 次</span></div></div><strong class="statistics-column-label" title="${e(name)}">${e(name)}</strong></li>`).join('')}</ol></div>`;
  }
  return `<ol class="statistics-aircraft" tabindex="0" aria-label="${title}条形图">${rows.map(({ name, count }) => `<li><div><strong>${e(name)}</strong><span>${count} 次</span></div><div class="statistics-bar" aria-hidden="true"><span style="width:${count / high * 100}%"></span></div></li>`).join('')}</ol>`;
}
