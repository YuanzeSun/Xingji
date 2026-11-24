export const DEFAULT_RAIL_TEMPLATE = 'rail-receipt';
export const TEMPLATES = Object.freeze({
  'rail-receipt': '纸质报销凭证',
  'rail-blue': '蓝色磁介质票 · 2015 版',
  'rail-red': '红色软纸票 · 2015 版',
  'rail-red-classic': '红色软纸票 · 实名旧版',
  'rail-red-qr': '红色软纸票 · 非实名二维码版',
  'rail-red-barcode': '红色软纸票 · 一维条码版',
  'rail-supplement': '列车移动补票',
  'rail-refund-receipt': '退票费报销凭证',
  'air-boarding-pass': '登机牌'
});

export const SUPPLEMENT_FIELDS = Object.freeze({
  railSupplementReason: '补票事由',
  railSupplementFee: '手续费（元）',
  railSupplementSurcharge: '加收（元）'
});

export const isOldRedTemplate = template => template.startsWith('rail-red-');
export const isAnonymousRedTemplate = template => template === 'rail-red-qr' || template === 'rail-red-barcode';
export const isRailReceiptTemplate = template => template === 'rail-receipt' || template === 'rail-refund-receipt';

export function ticketTemplateChoices({ archive = false } = {}) {
  const entries = Object.entries(TEMPLATES);
  const red = entries.filter(([key]) => key.startsWith('rail-red'));
  const other = ['rail-supplement', ...(archive ? ['rail-refund-receipt', 'air-boarding-pass'] : [])];
  return [
    [DEFAULT_RAIL_TEMPLATE, TEMPLATES[DEFAULT_RAIL_TEMPLATE]],
    ['rail-blue', TEMPLATES['rail-blue']],
    ['红色软纸票', red],
    ...other.map(key => [key, TEMPLATES[key]])
  ];
}

export function printedRailTemplate(text = '') {
  const compact = text.normalize('NFKC').replace(/\s/g, '');
  if (/退票(?:手续)?费/.test(compact)) return 'rail-refund-receipt';
  if (/列车移动补票|客运段补|事由[:：].{0,25}(?:手续费|加收)|手续费[:：][\d.]+元?加收[:：]/.test(compact)) return 'rail-supplement';
  if (/报销凭证|仅供报销|仅供.{0,2}销使用|退票改签.{0,6}交回车站/.test(compact)) return 'rail-receipt';
  if (/一维(?:条码|码)/.test(compact)) return 'rail-red-barcode';
  if (/非实名(?:制)?二维码/.test(compact)) return 'rail-red-qr';
  if (/经典红票|2015年前/.test(compact)) return 'rail-red-classic';
  if (/红色软纸票|红票/.test(compact)) return 'rail-red';
  if (/磁介质|蓝票/.test(compact)) return 'rail-blue';
  return '';
}

export function detectedRailTemplate(text = '', { paperColor = '', departureDate = '' } = {}) {
  const printed = printedRailTemplate(text);
  if (printed) return printed;
  if (paperColor === 'red') {
    if (/买票请到12306/.test(text.replace(/\s/g, ''))) return 'rail-red';
    if (departureDate && departureDate < '2009-12-10') return 'rail-red-barcode';
    if (departureDate >= '2010-01' && departureDate < '2012' &&
        !/\d{4,}[*＊]{2,}|\b\d{17}[\dXx]\b/.test(text)) return 'rail-red-qr';
    if (departureDate && departureDate < '2015-08' && departureDate !== '2015') return 'rail-red-classic';
    return 'rail-red';
  }
  return paperColor === 'blue' ? 'rail-blue' : '';
}

export function railPaperFromPixels(data, { faint = false } = {}) {
  let red = 0, blue = 0, bright = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (Math.max(r, g, b) + Math.min(r, g, b) >= 210) bright++;
    let color = railPaperHue(r, g, b);
    if (!color && faint && Math.min(r, g, b) > 125) {
      if (r - g >= 6 && r - b >= 4) color = 'red';
      else if (g - r >= 5 && b - r >= 5) color = 'blue';
    }
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
