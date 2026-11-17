export const isRefundReceipt = record => record.type === 'rail' && record.template === 'rail-refund-receipt';
export const isJourneyRecord = record => !record.deleted && !isRefundReceipt(record) && !isInactiveFlight(record);
import { isInactiveFlight } from './flight-status.js';
