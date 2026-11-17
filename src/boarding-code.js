import { normalizeCodeData, renderCodeData, codeSize } from './barcode-data.js';
const FORMATS = new Set(['PDF417', 'Aztec', 'QRCode', 'DataMatrix', 'Code128']);
export const normalizeBoardingCode = value => normalizeCodeData(value, FORMATS);
export const boardingCodeSize = value => codeSize(normalizeBoardingCode(value));
export function renderBoardingCode(record, x, y, width, height) {
  const code = record.type === 'flight' ? normalizeBoardingCode(record.boardingCode) : '';
  return renderCodeData(code, { x, y, width, height, marker: 'boarding-code' });
}
