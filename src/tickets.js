import { renderTicket, layoutDimensions, layoutFontFiles } from './ticket-layouts.js';
import { escape } from './html.js';
export function ticketSVG(record) {
  const { width, height } = ticketDimensions(record);
  const content = renderTicket(record);
  const baggageSticker = height > layoutDimensions(record.template).height;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"${baggageSticker ? ' data-ticket-has-sticker="true"' : ''} role="img" aria-label="${escape(`${record.origin || '待补充'}至${record.destination || '待补充'} ${record.service}`)}"><title>${escape(`${record.service} ${record.origin} → ${record.destination}`)}</title>${content}</svg>`;
}
export function ticketDimensions(record) { const dimensions = layoutDimensions(record.template, record); if (!dimensions) throw new Error('不支持的票面样式'); return dimensions; }
const fontStyles = new Map();
export async function exportSVG(record) {
  const key = record.template;
  if (!fontStyles.has(key)) {
    const fonts = layoutFontFiles(record.template);
    const definitions = await Promise.all(fonts.map(async ([family, file, weight]) => {
      const response = await fetch(new URL(`./fonts/${file}`, location.href));
      if (!response.ok) throw new Error('导出字体尚未加载完成，请联网重试');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      return `@font-face{font-family:${family};src:url(data:font/woff2;base64,${btoa(binary)}) format('woff2');font-weight:${weight}}`;
    }));
    const licenseFiles = record.type === 'flight' ? ['OFL-NotoSansSC.txt', 'OFL-RobotoCondensed.txt', 'OFL-RobotoMono.txt', 'OFL-NotoSansArabic.txt'] : ['OFL-NotoSerifSC.txt', 'Fandol-COPYING.txt', 'Fandol-README.txt', 'OCRB-LICENSE.txt', 'OFL.txt', 'OFL-RobotoCondensed.txt', 'GUST-FONT-LICENSE.txt', 'LPPL.txt', 'MANIFEST-rail-fonts.txt'];
    const licenses = await Promise.all(licenseFiles.map(async file => {
      const response = await fetch(new URL(`./fonts/${file}`, location.href));
      if (!response.ok) throw new Error('字体许可文件尚未加载完成，请联网重试');
      return response.text();
    }));
    fontStyles.set(key, `<metadata>Embedded fonts and their licenses: ${escape(licenses.join('\n\n'))}</metadata><style>${definitions.join('')}</style>`);
  }
  return ticketSVG(record).replace(/(<svg[^>]*>)/, `$1${fontStyles.get(key)}`);
}
export async function exportPNG(record, {width:outputWidth} = {}) {
  const svg = await exportSVG(record);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }); const url = URL.createObjectURL(blob);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const { width, height } = ticketDimensions(record);
    const canvas = document.createElement('canvas'); canvas.width = outputWidth ?? width * 2; canvas.height = Math.round(canvas.width * height / width);
    const context = canvas.getContext('2d'); context.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('图片导出失败')), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}
