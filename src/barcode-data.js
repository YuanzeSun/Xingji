import bwip from 'bwip-js/generic';
const FORMATS = new Map([['QRCode', 'qrcode'], ['MicroQRCode', 'microqrcode'], ['PDF417', 'pdf417'], ['Aztec', 'azteccode'], ['DataMatrix', 'datamatrix'], ['Code128', 'code128']]);
export const MAX_CODE_BYTES = 8192;
const encode = bytes => btoa(Array.from(bytes, value => String.fromCharCode(value)).join(''));
export function codeBytes(value) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(MAX_CODE_BYTES / 3) * 4 || value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error('条码原始数据编码无效');
  const bytes = Uint8Array.from(atob(value), char => char.charCodeAt(0));
  if (bytes.length > MAX_CODE_BYTES || encode(bytes) !== value) throw new Error('条码原始数据编码无效');
  return bytes;
}
export function normalizeCodeData(value, formats = FORMATS) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !FORMATS.has(value.format) || !formats.has(value.format)) throw new Error('条码需保存为可重建的原始数据');
  const bytes = codeBytes(value.rawBytes);
  if (typeof value.symbologyIdentifier !== 'string' || !/^\][A-Za-z][0-9A-Za-z]$/.test(value.symbologyIdentifier) || typeof value.gs1 !== 'boolean' || !Array.isArray(value.eci) || value.eci.length > 128) throw new Error('条码编码参数无效');
  let previous = -1;
  const eci = value.eci.map(part => {
    if (!part || !Number.isSafeInteger(part.offset) || part.offset < 0 || part.offset >= bytes.length || part.offset <= previous || !Number.isSafeInteger(part.value) || part.value < 0 || part.value > 999999) throw new Error('条码字符编码参数无效');
    previous = part.offset; return { offset: part.offset, value: part.value };
  });
  if (!value.parameters || typeof value.parameters !== 'object' || Array.isArray(value.parameters)) throw new Error('条码生成参数无效');
  const { symbolVersion = '', errorCorrectionLevel = '', mask = null } = value.parameters;
  if (typeof symbolVersion !== 'string' || !/^[A-Za-z0-9x]{0,12}$/.test(symbolVersion) || typeof errorCorrectionLevel !== 'string' || !/^[A-Za-z0-9%.]{0,12}$/.test(errorCorrectionLevel) || (mask !== null && (!Number.isInteger(mask) || mask < 0 || mask > 7))) throw new Error('条码生成参数无效');
  if (value.format === 'QRCode' && ((symbolVersion && !/^(?:[1-9]|[1-3][0-9]|40)$/.test(symbolVersion)) || (errorCorrectionLevel && !/^[LMQH]$/.test(errorCorrectionLevel)))) throw new Error('二维码生成参数无效');
  if (value.format === 'MicroQRCode' && ((symbolVersion && !/^M[1-4]$/.test(symbolVersion)) || (mask !== null && mask > 3))) throw new Error('二维码生成参数无效');
  if (value.format === 'Code128' && bytes.length > 500) throw new Error('条码原始数据过长');
  return { version: 1, format: value.format, rawBytes: value.rawBytes, symbologyIdentifier: value.symbologyIdentifier, gs1: value.gs1, eci, parameters: { symbolVersion, errorCorrectionLevel, mask } };
}
export function codeDataFromResult(result) {
  if (result.sequenceSize >= 0 || result.readerInit) throw new Error('暂不支持重编码分组条码或设备配置码');
  const eci = [], recovered = [];
  if (result.hasECI) {
    const bytes = result.bytesECI;
    for (let i = 3; i < bytes.length;) {
      if (bytes[i] !== 92) { recovered.push(bytes[i++]); continue; }
      if (bytes[i + 1] === 92) { recovered.push(92); i += 2; continue; }
      const digits = Array.from(bytes.slice(i + 1, i + 7), value => String.fromCharCode(value)).join('');
      if (!/^\d{6}$/.test(digits)) throw new Error('无法读取原码字符编码参数');
      eci.push({ offset: recovered.length, value: Number(digits) }); i += 7;
    }
    if (recovered.length !== result.bytes.length || recovered.some((value, i) => value !== result.bytes[i])) throw new Error('原始数据与字符编码信息不一致');
  }
  const extra = JSON.parse(result.extra || '{}');
  return normalizeCodeData({ version: 1, format: result.format, rawBytes: encode(result.bytes), symbologyIdentifier: result.symbologyIdentifier, gs1: result.contentType === 'GS1', eci, parameters: { symbolVersion: String(extra.Version || ''), errorCorrectionLevel: String(extra.ECLevel || ''), mask: Number.isInteger(extra.DataMask) ? extra.DataMask : null } });
}
const cache = new Map();
export function symbolFromCodeData(value) {
  const code = normalizeCodeData(value); if (!code) return null;
  const key = JSON.stringify(code); if (cache.has(key)) return cache.get(key);
  const bytes = codeBytes(code.rawBytes), parts = new Map(code.eci.map(part => [part.offset, part.value]));
  let text = code.gs1 ? '^FNC1' : '';
  for (let i = 0; i < bytes.length; i++) {
    if (parts.has(i)) text += '^ECI' + String(parts.get(i)).padStart(6, '0');
    text += code.gs1 && bytes[i] === 29 ? '^FNC1' : bytes[i] === 94 ? '^^' : String.fromCharCode(bytes[i]);
  }
  const options = { bcid: FORMATS.get(code.format), text, binarytext: true, parsefnc: true, includetext: false };
  const { symbolVersion, errorCorrectionLevel, mask } = code.parameters;
  if (code.format === 'DataMatrix' && code.symbologyIdentifier === ']d7') options.bcid = 'datamatrixrectangularextension';
  if (['QRCode', 'MicroQRCode'].includes(code.format)) {
    if (/^[LMQH]$/.test(errorCorrectionLevel)) Object.assign(options, { eclevel: errorCorrectionLevel, fixedeclevel: true });
    if (symbolVersion) options.version = code.format === 'MicroQRCode' ? symbolVersion : Number(symbolVersion);
    if (mask !== null) options.mask = mask + 1;
  }
  const [raw] = bwip.raw(options); let symbol;
  if (raw.pixs) {
    const width = raw.pixx, height = raw.pixy, rowScale = width * height / raw.pixs.length;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || !Number.isSafeInteger(rowScale) || rowScale < 1) throw new Error('条码编码器返回了无效尺寸');
    symbol = { width, height, data: Uint8ClampedArray.from({ length: width * height }, (_, i) => raw.pixs[Math.floor(Math.floor(i / width) / rowScale) * width + i % width] ? 0 : 255) };
  }
  else if (raw.sbs) {
    const width = raw.sbs.reduce((a, b) => a + b, 0), data = new Uint8ClampedArray(width * 50).fill(255); let x = 0;
    for (let i = 0; i < raw.sbs.length; i++) { if (!(i % 2)) for (let y = 0; y < 50; y++) data.fill(0, y * width + x, y * width + x + raw.sbs[i]); x += raw.sbs[i]; }
    symbol = { width, height: 50, data };
  } else throw new Error('无法根据原始数据重新生成条码');
  if (symbol.width > 8192 || symbol.height > 2048 || symbol.data.length > 1_048_576) throw new Error('重新生成的条码过大');
  if (cache.size >= 100) cache.delete(cache.keys().next().value);
  cache.set(key, symbol); return symbol;
}
export function codeSize(value) {
  const code = normalizeCodeData(value), symbol = symbolFromCodeData(code), quiet = ['Code128', 'PDF417'].includes(code.format) ? 8 : 4;
  return { width: symbol.width + quiet * 2, height: symbol.height + quiet * 2, quiet };
}
// Only payload and encoding parameters are persisted. Matrices and SVG paths exist in memory at display time.
export function renderCodeData(value, { x = 0, y = 0, width = '100%', height = '100%', marker = '', className = '', stretch = false } = {}) {
  const code = normalizeCodeData(value); if (!code) return '';
  const symbol = symbolFromCodeData(code), size = codeSize(code), paths = [];
  const rowHeight = code.format === 'Code128' ? symbol.height : 1;
  for (let row = 0; row < symbol.height; row += rowHeight) for (let col = 0; col < symbol.width;) {
    if ((symbol.data[row * symbol.width + col] ?? 255) >= 128) { col++; continue; }
    const start = col; while (col < symbol.width && symbol.data[row * symbol.width + col] < 128) col++;
    paths.push(`M${start + size.quiet} ${row + size.quiet}h${col - start}v${rowHeight}h-${col - start}z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" ${marker ? `data-${marker}="reencoded"` : ''} class="${className}" x="${x}" y="${y}" width="${width}" height="${height}" viewBox="0 0 ${size.width} ${size.height}" preserveAspectRatio="${stretch ? 'none' : 'xMidYMid meet'}" role="img" aria-label="${code.format} 重建"><path fill="#000" stroke="none" shape-rendering="crispEdges" d="${paths.join('')}"/></svg>`;
}
