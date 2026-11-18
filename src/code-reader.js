import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { symbolImage } from './barcode-symbols.js';
import { codeDataFromResult, codeBytes, MAX_CODE_BYTES, normalizeCodeData, symbolFromCodeData } from './barcode-data.js';
import { readBCBP } from './bcbp-reader.js';

let initialized;
export function prepareCodeReader(overrides) {
  if (!initialized) {
    const config = overrides || { locateFile: path => new URL('./vendor/' + path, location.href).href };
    initialized = prepareZXingModule({ overrides: config, fireImmediately: true }).catch(error => { initialized = null; throw error; });
  }
  return initialized;
}
const sameBytes = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const pdfFormats = ['PDF417', 'CompactPDF417', 'MicroPDF417'];
const formatsFor = type => type === 'flight' ? [...pdfFormats, 'Aztec', 'QRCode', 'DataMatrix', 'Code128'] : ['QRCode', 'MicroQRCode'];
const options = { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: false, maxNumberOfSymbols: 8, textMode: 'Plain' };
const rawText = result => String.fromCharCode(...result.bytes);
const isBoardingResult = result => result.bytes.length <= MAX_CODE_BYTES && !!readBCBP(rawText(result));

export async function readBoardingPayloads(image) {
  await prepareCodeReader();
  const results = await readBarcodes(image, { ...options, formats: formatsFor('flight') });
  return [...new Set(results.filter(result => result.isValid && isBoardingResult(result)).map(rawText))];
}

export async function readBoardingCodes(image) {
  const {codes}=await rebuildCodeSymbols(image,'flight',{boardingPass:true});
  return codes.map(code=>code.data).filter(data=>readBCBP(String.fromCharCode(...codeBytes(data.rawBytes))));
}

export async function rebuildCodeSymbols(image, type = 'rail', { boardingPass = false } = {}) {
  await prepareCodeReader();
  return rebuildResults(await readBarcodes(image, { ...options, formats: formatsFor(type) }), type, boardingPass);
}

async function rebuildResults(results, type, boardingPass) {
  const codes = [], issues = [];
  for (const result of results.filter(result => result.isValid)) {
    try {
      const compact = pdfFormats.includes(result.format) && result.format !== 'PDF417';
      const source = codeDataFromResult(compact ? { ...result, format: 'PDF417', symbologyIdentifier: ']L2' } : result);
      const expected=codeBytes(source.rawBytes);
      if(boardingPass && readBCBP(String.fromCharCode(...expected))){
        expected[22]=32;
        source.rawBytes=btoa(String.fromCharCode(...expected));
      }
      const data = boardingPass && source.format !== 'PDF417' ? normalizeCodeData({ ...source, format: 'PDF417', symbologyIdentifier: ']L2', parameters: { symbolVersion: '', errorCorrectionLevel: '', mask: null } }) : source;
      const symbol = symbolFromCodeData(data), redrawn = symbolImage(symbol, type);
      const checked = await readBarcodes(redrawn, { ...options, formats: [data.format], maxNumberOfSymbols: 1 });
      const match = checked.find(check => {
        if (!check.isValid || check.format !== data.format || check.symbologyIdentifier !== data.symbologyIdentifier || !sameBytes(check.bytes, expected)) return false;
        const restored = codeDataFromResult(check);
        return restored.gs1 === data.gs1 && JSON.stringify(restored.eci) === JSON.stringify(data.eci);
      });
      if (!match) throw new Error('重新编码后信息不一致，未保存该条码');
      if (codes.some(code => JSON.stringify(code.data) === JSON.stringify(data))) continue;
      codes.push({ format: data.format, data, symbol, image: redrawn, byteLength: result.bytes.length, isLink: /^https?:\/\//i.test(result.text), verified: true });
    } catch (error) { issues.push(error.message || '未能原样重建该条码'); }
  }
  return { codes, issues };
}

async function withCodeImage(source, read) {
  if (!(source instanceof Blob)) return read(source);
  if (source.size > 50 * 1024 * 1024) throw new Error('请选择50MB以内的图片');
  const url = URL.createObjectURL(source);
  try {
    const image = new Image(); image.src = url; await image.decode();
    return await read(image);
  } finally { URL.revokeObjectURL(url); }
}

function imagePixels(source, { x = 0, y = 0, width, height, edge, upscale = false } = {}) {
  width ??= source.naturalWidth || source.width;
  height ??= source.naturalHeight || source.height;
  if (!width || !height) throw new Error('图片无法读取');
  const scale = Math.min(upscale ? 2 : 1, (edge ?? Math.max(width, height)) / Math.max(width, height));
  const canvas = (source.ownerDocument || document).createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally { canvas.width = canvas.height = 1; }
}

function* boardingFrames(source) {
  const width = source.naturalWidth || source.width, height = source.naturalHeight || source.height;
  const longest = Math.max(width, height);
  yield { edge: 1800 };
  if (longest > 1100) yield { edge: 1100 };
  if (longest > 1800) yield { edge: 2600 };
  if (longest < 1800) yield { edge: 1800, upscale: true };
  // Keep the full width or height so a long code does not get split across tiles.
  const stripHeight = Math.ceil(height * .67), stripWidth = Math.ceil(width * .67);
  yield { width, height: stripHeight, edge: 1800 };
  yield { y: height - stripHeight, width, height: stripHeight, edge: 1800 };
  yield { width: stripWidth, height, edge: 1800 };
  yield { x: width - stripWidth, width: stripWidth, height, edge: 1800 };
}

async function readFlightImage(source, boardingOnly) {
  await prepareCodeReader();
  return withCodeImage(source, async image => {
    let fallback = [], issues = [], formats = formatsFor('flight');
    for (const frame of boardingFrames(image)) {
      const pixels = imagePixels(image, frame);
      const results = (await readBarcodes(pixels, { ...options, formats })).filter(result => result.isValid);
      if (formats !== pdfFormats) fallback = results;
      formats = pdfFormats;
      const boarding = results.filter(isBoardingResult);
      if (!boarding.length) continue;
      const rebuilt = await rebuildResults(boarding, 'flight', true);
      if (rebuilt.codes.length) return rebuilt;
      issues = rebuilt.issues;
    }
    if (boardingOnly || !fallback.length) return { codes: [], issues };
    return rebuildResults(fallback, 'flight', true);
  });
}

export async function readBoardingCodesFromImage(source) {
  const { codes } = await readFlightImage(source, true);
  return codes.map(code => code.data);
}

export async function rebuildCodesFromImage(source, type = 'rail') {
  const result = type === 'flight' ? await readFlightImage(source, false) :
    await withCodeImage(source, image => {
      if ((image.naturalWidth || image.width) * (image.naturalHeight || image.height) > 24_000_000) throw new Error('图片尺寸过大，请选择原始票据截图');
      return rebuildCodeSymbols(imagePixels(image), type);
    });
  return { ...result, codes: result.codes.map(({ format, data, byteLength, isLink, verified }) => ({ format, data, byteLength, isLink, verified })) };
}
