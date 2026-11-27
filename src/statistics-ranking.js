import { escape as e } from './html.js';

export const rankingViews = { bars: '条形图', columns: '柱状图', donut: '环形图' };
const sliceColors = [
  '#007858', '#e75905', '#2256d6', '#c60069', '#5d9400',
  '#7229c4', '#ba8300', '#007cbd', '#d51a24', '#1f6300',
  '#9b26a8', '#073d80', '#963c00', '#009385', '#7c0e37'
];
const otherColor = '#8a8b83';
const proportion = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 1 });
const share = (count, total) => count / total < .001 ? '&lt;0.1%' : proportion.format(count / total);

function donutMarkup(title, rows) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const stops = [];
  let end = 0;
  const entry = ({ name, count }) => `<span class="statistics-ring-name">${e(name)}</span><span class="statistics-ring-count">${count} 次</span><span class="statistics-ring-share">${share(count, total)}</span>`;
  const wedge = (row, color) => {
    const start = end;
    end += row.count;
    stops.push(`${color} ${start / total * 100}% ${end / total * 100}%`);
    return `<span class="statistics-ring-swatch" style="--slice:${color}" aria-hidden="true"></span>${entry(row)}`;
  };
  const legend = rows.slice(0, sliceColors.length).map((row, index) =>
    `<li class="statistics-ring-entry">${wedge(row, sliceColors[index])}</li>`);
  const other = rows.slice(sliceColors.length);
  if (other.length) {
    const group = { name: `其他（${other.length} 项）`, count: other.reduce((sum, row) => sum + row.count, 0) };
    legend.push(`<li><details class="statistics-ring-other"><summary class="statistics-ring-entry">${wedge(group, otherColor)}</summary><ul>${other.map(row => `<li class="statistics-ring-entry">${entry(row)}</li>`).join('')}</ul></details></li>`);
  }
  return `<div class="statistics-donut"><div class="statistics-ring" style="--slices:${stops.join(',')}" aria-label="合计 ${total} 次"><strong>${total}</strong><span>次</span></div><ul class="statistics-ring-legend" tabindex="0" aria-label="${e(title)}环形图图例">${legend.join('')}</ul></div>`;
}

export function rankingChartMarkup(title, rows, view) {
  if (!rows.length) return '<p class="statistics-empty">暂无记录</p>';
  if (view === 'donut') return donutMarkup(title, rows);
  const high = rows.reduce((max, row) => Math.max(max, row.count), 1);
  if (view === 'columns') {
    return `<div class="statistics-column-scroll" tabindex="0" aria-label="${title}柱状图"><ol class="statistics-columns-plot" style="--columns:${rows.length}">${rows.map(({ name, count }) => `<li><div class="statistics-column-track"><div class="statistics-column-bar" style="height:${count / high * 100}%"><span>${count} 次</span></div></div><strong class="statistics-column-label" title="${e(name)}">${e(name)}</strong></li>`).join('')}</ol></div>`;
  }
  return `<ol class="statistics-aircraft" tabindex="0" aria-label="${title}条形图">${rows.map(({ name, count }) => `<li><div><strong>${e(name)}</strong><span>${count} 次</span></div><div class="statistics-bar" aria-hidden="true"><span style="width:${count / high * 100}%"></span></div></li>`).join('')}</ol>`;
}
