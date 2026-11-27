import { BOARDING_BAGGAGE_FIELDS, flightTicketNumber } from './boarding-metadata.js';
import { isInactiveFlight } from './flight-status.js';
import { flightDepartureOrder, compareFlightDeparture } from './journey-duration.js';
import { markFieldSources } from './field-sources.js';

export const FLIGHT_SHARED_FIELDS = [...BOARDING_BAGGAGE_FIELDS, 'price'];
export const flightTicketKey = record => record.type === 'flight' && !record.deleted && !isInactiveFlight(record)
  ? flightTicketNumber(record.ticketNumber) : '';

export function sameTicketFlights(record, records) {
  const key = flightTicketKey(record);
  return key ? records.filter(other => flightTicketKey(other) === key) : [];
}

function applySharedValues(record, values) {
  const changed = Object.keys(values).filter(key => record[key] !== values[key]);
  if (!changed.length) return record;
  const updated = { ...record, ...values };
  markFieldSources(updated, changed, 'flight-link');
  return updated;
}

export function prefillFlightTicket(record, records, edits) {
  const matches = sameTicketFlights(record, records);
  if (!matches.length) return record;
  const linked = matches.length > 1
    ? matches.map(flightDepartureOrder).sort(compareFlightDeparture).map(entry => entry.record) : matches;
  const values = {};
  for (const key of FLIGHT_SHARED_FIELDS) {
    if (edits?.has(key)) continue;
    const source = linked.find(other => other[key]?.trim());
    if (source) values[key] = source[key];
  }
  return applySharedValues(record, values);
}

export function syncFlightTicket(records, record, fields = FLIGHT_SHARED_FIELDS) {
  const key = flightTicketKey(record);
  if (!key || !fields.length) return records;
  const values = Object.fromEntries(fields.map(field => [field, record[field]]));
  return records.map(other => {
    if (other.id === record.id || flightTicketKey(other) !== key) return other;
    const updated = applySharedValues(other, values);
    return updated === other ? other : { ...updated, updatedAt: other.updatedAt > record.updatedAt ? other.updatedAt : record.updatedAt };
  });
}
