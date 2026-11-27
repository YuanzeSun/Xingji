import { isInactiveFlight } from './flight-status.js';

export const isRefundReceipt = record => record.type === 'rail' && record.template === 'rail-refund-receipt';
export const ticketKind = record => record.type === 'flight' ? record.flightStatus :
  isRefundReceipt(record) ? 'refund' : record.template === 'rail-supplement' ? 'supplement' : 'ticket';
export const ticketServiceNumber = value => String(value || '').normalize('NFKC').replace(/[\s·]/gu, '').toUpperCase()
  .replace(/^(\w*?[A-Z])0+(?=\d)/, '$1');
export const isJourneyRecord = record => !record.deleted && !isRefundReceipt(record) && !isInactiveFlight(record);
export const isFlightJourney = record => record.type === 'flight' && isJourneyRecord(record);
