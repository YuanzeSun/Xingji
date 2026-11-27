import { normalizeCodeData, renderCodeData } from './barcode-data.js';
import { createRailTicketQR } from './rail-ticket-qr.js';
export const RAIL_TICKET_CODE_FORMATS = Object.freeze(['QRCode', 'MicroQRCode', 'Code128']);
const FORMATS = new Set(RAIL_TICKET_CODE_FORMATS);
export const normalizeTicketCode = value => normalizeCodeData(value, FORMATS);
export const isLinearTicketCode = value => value?.format === 'Code128';
export const hasRailQRCode = record => record.type === 'rail' && !!record.ticketCode && !isLinearTicketCode(record.ticketCode);

export function railTicketFaceCode(record) {
  if (record.type !== 'rail') return '';
  const code = record.ticketCode || createRailTicketQR(record);
  return code && isLinearTicketCode(code) === (record.template === 'rail-red-barcode') ? code : '';
}

export function renderTicketCode(record, x, y, width, height = width) {
  const code = railTicketFaceCode(record);
  return renderCodeData(code, { x, y, width, height, stretch: isLinearTicketCode(code), marker: 'ticket-code', formats: FORMATS });
}
