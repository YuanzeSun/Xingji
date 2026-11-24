import { normalizeCodeData, renderCodeData } from './barcode-data.js';
import { createRailTicketQR } from './rail-ticket-qr.js';
export const RAIL_TICKET_CODE_FORMATS = Object.freeze(['QRCode', 'MicroQRCode', 'Code128']);
const FORMATS = new Set(RAIL_TICKET_CODE_FORMATS);
export const normalizeTicketCode = value => normalizeCodeData(value, FORMATS);
export const isLinearTicketCode = value => value?.format === 'Code128';
export const hasRailQRCode = record => record.type === 'rail' && !!record.ticketCode && !isLinearTicketCode(record.ticketCode);

export function renderTicketCode(record, x, y, width, height = width) {
  if (record.type !== 'rail') return '';
  const code = record.ticketCode || createRailTicketQR(record);
  if (!code) return '';
  const linear = isLinearTicketCode(code);
  if (linear !== (record.template === 'rail-red-barcode')) return '';
  return renderCodeData(normalizeTicketCode(code), { x, y, width, height, stretch: linear, marker: 'ticket-code' });
}
