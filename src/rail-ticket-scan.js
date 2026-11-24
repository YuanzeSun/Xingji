import { RAIL_ISSUERS } from './data/rail-issuer-codes.js';
import { readRailTicketCode } from './rail-ticket-qr.js';

export function readRailTicketScan(code, year) {
  const fields = readRailTicketCode(code, year);
  if (!fields) return null;
  const issuer = RAIL_ISSUERS[fields.saleCode.slice(0, 5)];
  if (issuer) fields.issuer = issuer;
  return fields;
}
