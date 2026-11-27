import { normalizeCodeData, renderCodeData, codeSize } from './barcode-data.js';
const FORMATS = new Set(['PDF417', 'Aztec', 'QRCode', 'DataMatrix', 'Code128']);
export const normalizeBoardingCode = value => normalizeCodeData(value, FORMATS);
export const boardingCodeSize = value => codeSize(value, FORMATS);
export function renderBoardingCode(record, x, y, width, height) {
  if (record.type !== 'flight') return '';
  return renderCodeData(record.boardingCode, { x, y, width, height, marker: 'boarding-code', formats: FORMATS });
}
