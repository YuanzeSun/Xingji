import { normalizeCodeData, renderCodeData } from './barcode-data.js';
const FORMATS = new Set(['QRCode', 'MicroQRCode']);
export const normalizeTicketCode = value => normalizeCodeData(value, FORMATS);
export function renderTicketCode(record, x, y, size) {
  const code = record.type === 'rail' ? normalizeTicketCode(record.ticketCode) : '';
  return renderCodeData(code, { x, y, width: size, height: size, marker: 'ticket-code' });
}
