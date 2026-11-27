import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { symbolImage } from './barcode-symbols.js';
import { codeDataFromResult, MAX_CODE_BYTES, normalizeCodeData, symbolFromCodeData } from './barcode-data.js';
import { readBCBP } from './bcbp-reader.js';
import { RAIL_TICKET_CODE_FORMATS } from './ticket-code.js';

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
const flightFormats = [...pdfFormats, 'Aztec', 'QRCode', 'DataMatrix', 'Code128'];
const formatsFor = type => type === 'flight' ? flightFormats : RAIL_TICKET_CODE_FORMATS;
const options = { tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: false, maxNumberOfSymbols: 8, textMode: 'Plain' };
const boardingStripOptions = { ...options, formats: [...pdfFormats, 'Code128'], minLineCount: 1 };
const railStripOptions = { ...options, formats: ['Code128'], minLineCount: 1 };
const rawText = result => String.fromCharCode(...result.bytes);
const isBoardingResult = result => result.bytes.length <= MAX_CODE_BYTES && !!readBCBP(rawText(result));

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
      let expected = result.bytes;
      if (boardingPass && expected[22] !== 32 && isBoardingResult(result)) {
        expected = expected.slice();
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

function imagePixels(source, { x = 0, y = 0, width, height, edge, upscale = false, enhance = false } = {}) {
  width ??= source.naturalWidth || source.width;
  height ??= source.naturalHeight || source.height;
  if (!width || !height) throw new Error('图片无法读取');
  const scale = Math.min(upscale ? 2 : 1, (edge ?? Math.max(width, height)) / Math.max(width, height));
  const canvas = (source.ownerDocument || document).createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    // Interpolation can erase narrow bars when enlarging a camera crop.
    if (scale > 1) context.imageSmoothingEnabled = false;
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    return enhance ? stretchCodeContrast(pixels) : pixels;
  } finally { canvas.width = canvas.height = 1; }
}

function stretchCodeContrast(pixels) {
  const { data } = pixels, histogram = new Uint32Array(256);
  const luminance = i => (77 * data[i] + 150 * data[i + 1] + 29 * data[i + 2]) >> 8;
  for (let i = 0; i < data.length; i += 16) histogram[luminance(i)]++;
  const cutoff = Math.floor(Math.ceil(data.length / 16) / 100);
  let low = 0, high = 255, count = 0;
  while (low < high && (count += histogram[low]) <= cutoff) low++;
  count = 0;
  while (high > low && (count += histogram[high]) <= cutoff) high--;
  if (high - low < 20) return pixels;
  const scale = 255 / (high - low);
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = (luminance(i) - low) * scale;
  return pixels;
}

function centeredBarcodeFrames(width, height) {
  const stripWidth = Math.ceil(width / 2), stripHeight = Math.ceil(height / 2);
  const longest = Math.max(width, height);
  const enhanced = { edge: longest <= 1200 ? longest * 2 : 2400, upscale: longest <= 1200, enhance: true };
  // Keep both ends and quiet zones visible for a horizontal or vertical strip.
  return [
    { ...enhanced, width, y: Math.floor((height - stripHeight) / 2), height: stripHeight },
    { ...enhanced, x: Math.floor((width - stripWidth) / 2), width: stripWidth, height }
  ];
}

function* boardingFrames(source, fullSearch) {
  const width = source.naturalWidth || source.width, height = source.naturalHeight || source.height;
  const longest = Math.max(width, height);
  yield { edge: 1800 };
  yield* centeredBarcodeFrames(width, height);
  if (!fullSearch) {
    yield { edge: Math.min(2400, Math.round(longest * 1.5)), upscale: true, enhance: true };
    return;
  }
  if (longest > 1100) yield { edge: 1100 };
  if (longest > 1800) yield { edge: 2600 };
  if (longest < 1800) yield { edge: 1800, upscale: true };
  yield { edge: Math.min(2400, Math.round(longest * 1.5)), upscale: true, enhance: true };
  // Keep the full width or height so a long code does not get split across tiles.
  const stripHeight = Math.ceil(height * .67), stripWidth = Math.ceil(width * .67);
  yield { width, height: stripHeight, edge: 1800 };
  yield { y: height - stripHeight, width, height: stripHeight, edge: 1800 };
  yield { width: stripWidth, height, edge: 1800 };
  yield { x: width - stripWidth, width: stripWidth, height, edge: 1800 };
}

async function readFlightImage(source, cameraFrame = 0) {
  await prepareCodeReader();
  return withCodeImage(source, async image => {
    let fallback = [], issues = [], readOptions = { ...options, formats: flightFormats };
    // Every fourth camera frame gets the same full search as an uploaded photo.
    for (const frame of boardingFrames(image, cameraFrame % 4 === 0)) {
      const pixels = imagePixels(image, frame);
      const results = (await readBarcodes(pixels, readOptions)).filter(result => result.isValid);
      if (readOptions !== boardingStripOptions) fallback = results;
      readOptions = boardingStripOptions;
      const boarding = results.filter(isBoardingResult);
      if (!boarding.length) continue;
      const rebuilt = await rebuildResults(boarding, 'flight', true);
      if (rebuilt.codes.length) return rebuilt;
      issues = rebuilt.issues;
    }
    if (!fallback.length) return { codes: [], issues };
    return rebuildResults(fallback, 'flight', true);
  });
}

export async function rebuildCodesFromImage(source, type = 'rail', { cameraFrame } = {}) {
  const result = type === 'flight' ? await readFlightImage(source, cameraFrame) :
    await withCodeImage(source, async image => {
      const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
      if (width * height > 24_000_000) throw new Error('图片尺寸过大，请选择原始票据截图');
      const first = await rebuildCodeSymbols(imagePixels(image), type);
      if (first.codes.length) return first;
      const frames = centeredBarcodeFrames(width, height);
      if (!cameraFrame || cameraFrame % 4 === 0) frames.push({ edge: 2400, upscale: true, enhance: true });
      for (const frame of frames) {
        const codes = await readBarcodes(imagePixels(image, frame), railStripOptions);
        if (!codes.length) continue;
        const rebuilt = await rebuildResults(codes, type, false);
        if (rebuilt.codes.length) return rebuilt;
        first.issues.push(...rebuilt.issues);
      }
      return first;
    });
  return { ...result, codes: result.codes.map(({ format, data, byteLength, isLink, verified }) => ({ format, data, byteLength, isLink, verified })) };
}
