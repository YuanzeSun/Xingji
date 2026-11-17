import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { symbolImage } from './barcode-symbols.js';
import { codeDataFromResult, codeBytes, normalizeCodeData, symbolFromCodeData } from './barcode-data.js';
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
const formatsFor = type => type === 'flight' ? ['PDF417', 'Aztec', 'QRCode', 'DataMatrix', 'Code128'] : ['QRCode', 'MicroQRCode'];

export async function readBoardingPayloads(image) {
  await prepareCodeReader();
  const results=await readBarcodes(image,{formats:['PDF417','Aztec','QRCode','DataMatrix'],tryHarder:true,tryRotate:true,tryInvert:true,maxNumberOfSymbols:8,textMode:'Plain'});
  const payloads=results.filter(result=>result.isValid).map(result=>String.fromCharCode(...result.bytes));
  return [...new Set(payloads.filter(readBCBP))];
}

export async function readBoardingCodes(image) {
  const {codes}=await rebuildCodeSymbols(image,'flight',{boardingPass:true});
  return codes.map(code=>code.data).filter(data=>readBCBP(String.fromCharCode(...codeBytes(data.rawBytes))));
}

export async function rebuildCodeSymbols(image, type = 'rail', { boardingPass = false } = {}) {
  await prepareCodeReader();
  const options = { formats: formatsFor(type), tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: false, maxNumberOfSymbols: 8, textMode: 'Plain' };
  const results = await readBarcodes(image, options), codes = [], issues = [];
  for (const result of results.filter(result => result.isValid)) {
    try {
      const source = codeDataFromResult(result);
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

async function imagePixels(file) {
  if (!(file instanceof Blob) || file.size > 50 * 1024 * 1024) throw new Error('请选择50MB以内的图片');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error('图片尺寸过大，请选择原始票据截图');
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height); canvas.width = canvas.height = 1;
    return pixels;
  } finally { URL.revokeObjectURL(url); }
}
export async function rebuildCodesFromImage(file, type = 'rail') {
  const result = await rebuildCodeSymbols(await imagePixels(file), type, { boardingPass: type === 'flight' });
  return { ...result, codes: result.codes.map(({ format, data, byteLength, isLink, verified }) => ({ format, data, byteLength, isLink, verified })) };
}
