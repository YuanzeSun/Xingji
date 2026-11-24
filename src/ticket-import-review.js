import { FIELDS, clone, now, validateRecord } from './model.js';
import { calendarDate, fullDate, JOURNEY_DATE_FIELDS, journeyDate } from './journey-date.js';
import { placeIdentity } from './places.js';
import { isRefundReceipt } from './record-kind.js';
import { BOARDING_FIELDS, refreshGeneratedCode } from './boarding-code-state.js';
import { takeBoardingCode, takeField } from './record-merge-metadata.js';
import { hasFieldValue } from './field-sources.js';
import { requireCompleteIdentity } from './identity.js';

const normalized = value => String(value || '').normalize('NFKC').replace(/[\s·]/gu, '').toUpperCase();
const passengerName = value => normalized(value).replace(/\//g, '');
const numeric = value => normalized(value).replace(/^0+(?=\d)/, '');
const serviceNumber = value => normalized(value).replace(/^(\w*?[A-Z])0+(?=\d)/, '$1');
const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sameKnown = (a, b) => !!a && a === b;
const differentKnown = (a, b) => !!a && !!b && a !== b;
const electronicNumber = record => record.railInvoice?.electronicTicketNumber || '';
const airTicketNumber = record => normalized(record.ticketNumber).replace(/-/g, '').match(/^\d{13}$/)?.[0] || '';
const originalCode = record => record.type === 'rail' ? record.ticketCode?.rawBytes :
  record.boardingCodeSource === 'original' ? record.boardingCode?.rawBytes + ':' + record.boardingLegIndex : '';
const ticketKind = record => record.type === 'flight' ? record.flightStatus :
  isRefundReceipt(record) ? 'refund' : record.template === 'rail-supplement' ? 'supplement' : 'ticket';

function railNumberMatch(existing, incoming) {
  if (sameKnown(electronicNumber(existing), electronicNumber(incoming))) return '电子客票号相同';
  if (sameKnown(normalized(existing.saleCode), normalized(incoming.saleCode))) return '底部售票码相同';
  if (sameKnown(normalized(existing.ticketNumber), normalized(incoming.ticketNumber))) return '票号相同';
  return '';
}

function importMatch(existing, incoming) {
  if (existing.deleted || existing.type !== incoming.type || ticketKind(existing) !== ticketKind(incoming)) return null;
  const rail = incoming.type === 'rail';
  const aDate = journeyDate(existing.departureDate), bDate = journeyDate(incoming.departureDate);
  const sameDay = fullDate(aDate) && fullDate(bDate) && calendarDate(aDate) === calendarDate(bDate);
  const dateConflict = differentKnown(aDate?.year, bDate?.year) || differentKnown(aDate?.dayOfYear, bDate?.dayOfYear);
  const endpoints = ['origin', 'destination'].map(side => [placeIdentity(existing, side), placeIdentity(incoming, side)]);
  const sameRoute = endpoints.every(([a, b]) => sameKnown(a, b));
  const equivalentService = sameKnown(serviceNumber(existing.service), serviceNumber(incoming.service));
  const sameOperatingFlight = !rail && [
    existing.boardingCodeOperatingFlight, existing.service
  ].some(service => [incoming.boardingCodeOperatingFlight, incoming.service].some(other => sameKnown(serviceNumber(service), serviceNumber(other))));
  const matchingCode = sameKnown(originalCode(existing), originalCode(incoming)) && (rail || sameDay);
  const numberMatch = rail ? railNumberMatch(existing, incoming) :
    sameDay && sameRoute && sameKnown(airTicketNumber(existing), airTicketNumber(incoming)) ? '客票号及航段相同' : '';
  const strong = matchingCode || !!numberMatch;
  const namedConflict = !rail && differentKnown(passengerName(existing.passenger), passengerName(incoming.passenger));
  let reason = matchingCode ? '原票码相同' : numberMatch;
  if (!reason && sameDay) {
    if (equivalentService) reason = rail ? '同日同车次' : '同日同航班';
    else if (sameRoute && sameOperatingFlight && !namedConflict) reason = '同日同一承运航班';
  }
  if (!reason) return null;

  const conflicts = [];
  for (const field of rail ? ['ticketNumber', 'saleCode', 'orderNumber'] : ['identity', 'ticketNumber', 'pnr']) {
    const left = !rail && field === 'ticketNumber' ? airTicketNumber(existing) || normalized(existing[field]) : normalized(existing[field]);
    const right = !rail && field === 'ticketNumber' ? airTicketNumber(incoming) || normalized(incoming[field]) : normalized(incoming[field]);
    if (differentKnown(left, right)) conflicts.push(field);
  }
  if (namedConflict) conflicts.push('passenger');
  if (dateConflict) conflicts.push('departureDate');
  for (const [index, side] of ['origin', 'destination'].entries()) {
    if (differentKnown(...endpoints[index])) conflicts.push(side);
  }
  if (differentKnown(serviceNumber(existing.service), serviceNumber(incoming.service)) && !sameOperatingFlight) conflicts.push('service');
  if (rail && differentKnown(electronicNumber(existing), electronicNumber(incoming))) conflicts.push('railInvoice');
  if (!strong && differentKnown(existing.departureTime, incoming.departureTime)) conflicts.push('departureTime');
  if (!strong && differentKnown(normalized(existing.seatClass), normalized(incoming.seatClass))) conflicts.push('seatClass');
  if (rail && !strong && existing.price && incoming.price && Number(existing.price) !== Number(incoming.price)) conflicts.push('price');
  if (differentKnown(numeric(existing.seat), numeric(incoming.seat)) || (existing.railStanding && incoming.seat) || (incoming.railStanding && existing.seat)) conflicts.push('seat');
  if (rail && differentKnown(numeric(existing.carriage), numeric(incoming.carriage))) conflicts.push('carriage');
  return { record: existing, strong, reason, conflicts };
}

const excluded = new Set(['type', 'template', 'flightStatus', 'provenance', 'deleted', 'fieldSources',
  'lookupValues', 'ticketMarks', 'offsetX', 'offsetY', ...BOARDING_FIELDS]);

function supplement(existing, incoming) {
  const record = clone(existing);
  for (const field of FIELDS) {
    if (excluded.has(field) || existing.lockedFields.includes(field) || !hasFieldValue(incoming[field])) continue;
    const morePrecise = JOURNEY_DATE_FIELDS.includes(field) && !fullDate(existing[field]) && fullDate(incoming[field]) &&
      journeyDate(existing[field])?.year === journeyDate(incoming[field]).year;
    if (!hasFieldValue(existing[field]) || morePrecise) takeField(record, incoming, field, true);
  }
  if (incoming.boardingCodeSource === 'original' && existing.boardingCodeSource !== 'original') takeBoardingCode(record, incoming);
  else refreshGeneratedCode(record);
  return validateRecord(record);
}

export function reviewTicketImport(records, incoming) {
  return records.filter(record => record.id !== incoming.id).map(record => importMatch(record, incoming)).filter(Boolean)
    .map(match => {
      const result = match.conflicts.length ? null : supplement(match.record, incoming);
      const fields = result ? FIELDS.filter(field => !excluded.has(field) && !sameValue(match.record[field], result[field])) : [];
      if (result && incoming.boardingCodeSource === 'original' && result.boardingCodeSource === 'original' &&
        !sameValue(match.record.boardingCode, result.boardingCode)) fields.push('boardingCode');
      return { ...match, result, fields };
    });
}

export class TicketImportReview extends Error {
  constructor(matches) {
    super('发现疑似重复票据，请先核对。');
    this.matches = matches;
    this.canSaveSeparately = !matches.some(match => match.strong && !match.conflicts.length);
  }
}

export function applyReviewedTicket(records, incoming, decision) {
  requireCompleteIdentity(incoming.identity);
  const matches = reviewTicketImport(records, incoming);
  if (matches.length) {
    const review = new TicketImportReview(matches);
    if (!decision || !sameValue(decision.matches, matches) || (!decision.id && !review.canSaveSeparately)) throw review;
  }
  if (records.some(record => record.id === incoming.id || record.mergedIds.includes(incoming.id))) {
    return { records, added: 0, enriched: 0 };
  }
  if (!decision?.id) return { records: [...records, incoming], added: 1, enriched: 0 };
  const match = matches.find(item => item.record.id === decision.id);
  if (!match?.result) throw new TicketImportReview(matches);
  if (!match.fields.length) return { records, added: 0, enriched: 0 };
  const result = { ...match.result, updatedAt: now() };
  result.mergedIds = [...new Set([...result.mergedIds, incoming.id, ...incoming.mergedIds])].filter(id => id !== result.id).sort();
  for (const source of incoming.sources) {
    if (!result.sources.some(previous => previous.kind === source.kind && previous.label === source.label)) result.sources.push(source);
  }
  return { records: records.map(record => record.id === result.id ? validateRecord(result) : record), added: 0, enriched: 1 };
}
