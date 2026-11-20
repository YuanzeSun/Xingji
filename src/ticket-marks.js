import { escape as esc } from './html.js';
export const MARK_SHAPES = Object.freeze({ circle: '圆圈', plain: '仅文字' });

export function normalizeMarks(input) {
  if (input === undefined || input === null || input === '') return [];
  let value = input;
  if (typeof value === 'string') {
    if (value.trim().startsWith('[')) {
      try { value = JSON.parse(value); } catch { throw new Error('票面标识的JSON格式不正确'); }
    } else value = [...value.replace(/[\s,，、;；]/g, '')].map(text => ({ text, shape: 'circle' }));
  }
  if (!Array.isArray(value) || value.length > 4) throw new Error('每张票最多保存4个票面标识');
  return value.map(mark => {
    if (!mark || typeof mark !== 'object' || Array.isArray(mark)) throw new Error('票面标识格式不正确');
    const text = typeof mark.text === 'string' ? mark.text.trim() : '';
    if (!/^[\p{Script=Han}A-Za-z0-9]$/u.test(text)) throw new Error('每个票面标识请填写一个汉字、字母或数字');
    const shape = mark.shape || 'circle';
    if (!Object.hasOwn(MARK_SHAPES, shape)) throw new Error('票面标识仅支持圆圈或仅文字');
    const offsetX = Number(mark.offsetX ?? 0), offsetY = Number(mark.offsetY ?? 0);
    if (![offsetX, offsetY].every(n => Number.isFinite(n) && Math.abs(n) <= 100)) throw new Error('标识的位置微调范围为 -100 至 100');
    return { text, shape, offsetX, offsetY };
  });
}
export function describeMarks(marks) {
  return (marks || []).map(m => `${m.text}（${MARK_SHAPES[m.shape] || '圆圈'}${m.offsetX || m.offsetY ? `，偏移 ${m.offsetX || 0} / ${m.offsetY || 0}` : ''}）`).join('、') || '未收录';
}
export function renderMarks(record, { x, y, radius = 16, gap = 46, family = 'TicketRailHei' }) {
  if (record.type !== 'rail' || !Array.isArray(record.ticketMarks)) return '';
  return record.ticketMarks.filter(m => m.text).slice(0, 4).map((mark, i) => {
    const cx = x + gap * i + (Number(mark.offsetX) || 0), cy = y + (Number(mark.offsetY) || 0);
    const shape = mark.shape || 'circle';
    const border = shape === 'plain' ? '' : `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="#172226" stroke-width="1.8"/>`;
    const size = radius * (shape === 'plain' ? 2 : 1.43);
    return `<g data-ticket-mark="${esc(mark.text)}" data-mark-shape="${esc(shape)}" aria-label="${esc((MARK_SHAPES[shape] || '圆圈') + mark.text)}">${border}<text x="${cx}" y="${cy + size * .35}" text-anchor="middle" font-family="${family},serif" font-size="${size}" fill="#172226" stroke="none">${esc(mark.text)}</text></g>`;
  }).join('');
}
export function marksFromText(text) {
  const explicit = text.match(/(?:票面标识|票面标记|票种标识)\s*[:：]\s*([\u3400-\u9fffA-Za-z0-9 ,，、]{1,20})(?=\n|$)/m);
  if (explicit) {
    try { return normalizeMarks(explicit[1]); } catch { return []; }
  }
  // Extract only explicit printed delimiters. Ordinary words like 网上购票 are not proof of a stamp.
  const marks = [];
  const closing = { '（': '）', '(': ')' };
  for (const match of text.matchAll(/([（(])\s*([网学孩惠折赠支微团残兑])\s*([）)])/g)) {
    if (closing[match[1]] !== match[3]) continue;
    const shape = 'circle';
    if (!marks.some(m => m.text === match[2] && m.shape === shape)) marks.push({ text: match[2], shape });
  }
  if (/(?:商务座|特等座|一等座|二等座|软卧|硬卧|软座|硬座)[ \t]*孩(?:\s|$)/.test(text) &&
      !marks.some(mark => mark.text === '孩')) marks.push({ text: '孩', shape: 'plain' });
  return normalizeMarks(marks.slice(0, 4));
}

export function marksFromRailRegion(text) {
  const marks = marksFromText(text);
  for (const line of text.split('\n')) {
    if (line.replace(/\s/g, '') === '网折') {
      for (const text of ['网', '折']) {
        if (!marks.some(value => value.text === text)) marks.push({ text, shape: 'plain', offsetX: 0, offsetY: 0 });
      }
      continue;
    }
    const mark = line.trim().match(/^[（(○\s]*([网学孩惠折赠支微团残兑])[）)○\s]*$/)?.[1];
    if (mark && !marks.some(value => value.text === mark)) {
      marks.push({ text: mark, shape: mark === '孩' ? 'plain' : 'circle', offsetX: 0, offsetY: 0 });
    }
  }
  return marks.slice(0, 4);
}
