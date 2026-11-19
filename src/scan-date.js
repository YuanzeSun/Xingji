import { validDate } from './model.js';

export function dateRectangle(tsv, width = Infinity, height = Infinity) {
  if (!tsv) return null;
  const words = tsv.trim().split('\n').slice(1).map(line => line.split('\t')).filter(w => w[0] === '5' && w[11]);
  for (const first of words.filter(w => /^(?:19|20)\d{2}/.test(w[11]))) {
    const key = first.slice(1, 5).join(':');
    const line = words.filter(w => w.slice(1, 5).join(':') === key ||
      Math.abs(+first[7] + +first[9] / 2 - (+w[7] + +w[9] / 2)) < Math.min(+first[9], +w[9]) * .6);
    const time = line.filter(w => +w[6] > +first[6] && /\d{1,2}[:：]\d{2}/.test(w[11]))
      .sort((a, b) => +a[6] - +b[6])[0];
    if (!time) continue;
    const date = line.filter(w => +w[6] >= +first[6] && +w[6] < +time[6]);
    const left = Math.max(0, +first[6] - 8), top = Math.max(0, Math.min(...date.map(w => +w[7])) - 8);
    const right = Math.min(width, +time[6] - 2, Math.max(...date.map(w => +w[6] + +w[8])) + 8), bottom = Math.min(height, Math.max(...date.map(w => +w[7] + +w[9])) + 8);
    if ([left, top, right, bottom].every(Number.isFinite) && right > left && bottom > top) return { left, top, width: right - left, height: bottom - top };
  }
  return null;
}
export function readPrintedDate(text) {
  const value = text.normalize('NFKC').replace(/\s/g, '');
  // 年 and 月 must actually be recognized. 日 may be read as one or two digits.
  const match = value.match(/^((?:19|20)\d{2})年(\d{1,2})月(\d{1,2})(?:日|目)?$/) || value.match(/^((?:19|20)\d{2})年(\d{1,2})月(\d{2})\d{1,2}$/);
  if (!match) return '';
  const date = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return validDate(date) ? date : '';
}
