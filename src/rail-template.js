import { DEFAULT_RAIL_TEMPLATE } from './model.js';

export function printedRailTemplate(text = '') {
  const compact = text.replace(/\s/g, '');
  if (/退票(?:手续)?费/.test(compact)) return 'rail-refund-receipt';
  if (/报销|凭证|仅供|销使用|退票改签.{0,4}交回车站/.test(compact)) return 'rail-receipt';
  if (/经典红票|2015年前/.test(compact)) return 'rail-red-classic';
  if (/红色软纸票|红票/.test(compact)) return 'rail-red';
  if (/磁介质|蓝票/.test(compact)) return 'rail-blue';
  return '';
}

export function railTemplateFromText(text = '', { paperColor = '', departureDate = '' } = {}) {
  const printed = printedRailTemplate(text);
  if (printed) return printed;
  if (paperColor === 'red') return departureDate && +departureDate.slice(0, 4) < 2015 ? 'rail-red-classic' : 'rail-red';
  if (/限乘当[日目]|当[日目]当次|当次车/.test(text.replace(/\s/g, '')) || paperColor === 'blue') return 'rail-blue';
  return DEFAULT_RAIL_TEMPLATE;
}

export function railPaperFromPixels(data) {
  let red = 0, blue = 0, bright = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) + Math.min(r, g, b) >= 210) bright++;
    const color = railPaperHue(r, g, b);
    if (color === 'red') red++;
    if (color === 'blue') blue++;
  }
  const pixels = data.length / 4;
  if (red > blue * 3 && (red > pixels * .45 || red > pixels * .27 && red > bright * .6)) return 'red';
  if (blue > pixels * .25 && blue > red * 3) return 'blue';
  return '';
}

export function railPaperHue(r, g, b) {
  if (Math.max(r, g, b) + Math.min(r, g, b) < 210 || Math.min(r, g, b) >= 248) return '';
  if (r - g >= 9 && r - b >= 4) return 'red';
  if (b - r >= 10 && g - r >= 6) return 'blue';
  return '';
}
