import { normalizeCodeData, renderCodeData } from './barcode-data.js';
import { createRailTicketQR } from './rail-ticket-qr.js';
export const RAIL_TICKET_CODE_FORMATS = Object.freeze(['QRCode', 'MicroQRCode', 'Code128']);
const FORMATS = new Set(RAIL_TICKET_CODE_FORMATS);
export const normalizeTicketCode = value => normalizeCodeData(value, FORMATS);
export const isLinearTicketCode = value => value?.format === 'Code128';
export const hasRailQRCode = record => record.type === 'rail' && !!record.ticketCode && !isLinearTicketCode(record.ticketCode);

export function renderTicketCode(record, x, y, width, height = width) {
  if (record.type !== 'rail') return '';
  const generated = createRailTicketQR(record), code = record.ticketCode || generated;
  if (!code) return '';
  const linear = isLinearTicketCode(code);
  if (linear !== (record.template === 'rail-red-barcode')) return '';
  if (!generated) return renderCodeData(normalizeTicketCode(code), { x, y, width, height, stretch: linear, marker: 'ticket-code' });
  const size = height - 18, center = x + width / 2, left = center - size / 2;
  return `<g data-generated-rail-qr="" role="img" aria-label="自动生成的二维码"><rect x="${left}" y="${y}" width="${size}" height="${size}" fill="#fff" stroke="none"/>${renderCodeData(code, { x: left, y, width: size, height: size, marker: 'ticket-code' })}<text x="${center}" y="${y + height - 3}" text-anchor="middle" font-family="TicketSong,serif" font-size="15" fill="#182c26" stroke="none">自动生成</text></g>`;
}
