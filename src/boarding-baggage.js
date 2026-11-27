import { BOARDING_BAGGAGE_FIELDS, flightTicketNumber } from './boarding-metadata.js';
import { isInactiveFlight } from './flight-status.js';
import { journeyDate } from './journey-date.js';
import { localInstant } from './journey-duration.js';

const hasBags = data => BOARDING_BAGGAGE_FIELDS.some(key => data[key]?.trim());
const activeFlight = record => record.type === 'flight' && !record.deleted && !isInactiveFlight(record);
const destination = record => record.destinationCode || record.destination || '';

export function boardingBaggage(record) {
  if (Object.hasOwn(record, 'boardingSticker')) return record.boardingSticker;
  return activeFlight(record) && hasBags(record) ? record : null;
}

export function withBoardingBaggage(record, index) {
  return record.type === 'flight' ? { ...record, boardingSticker: index.get(record.id)?.sticker ?? null } : record;
}

function departureOrder(record) {
  const date = journeyDate(record.departureDate);
  return {
    record,
    instant: localInstant(date, record.departureTime, record.departureZone),
    year: date?.year ?? 0,
    ordinal: date?.dayOfYear ?? 367
  };
}

function compareDeparture(a, b) {
  if (Number.isFinite(a.instant) && Number.isFinite(b.instant)) return a.instant - b.instant;
  return a.year - b.year || a.ordinal - b.ordinal ||
    (a.record.departureTime || '').localeCompare(b.record.departureTime || '') ||
    a.record.id.localeCompare(b.record.id);
}

export function boardingBaggageIndex(records) {
  const result = new Map(), groups = new Map();
  for (const record of records) {
    if (!activeFlight(record)) continue;
    const key = flightTicketNumber(record.ticketNumber);
    if (!key) {
      if (hasBags(record)) result.set(record.id, { sticker: record, laterLeg: false });
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }

  for (const group of groups.values()) {
    const legs = group.length > 1 ? group.map(departureOrder).sort(compareDeparture).map(entry => entry.record) : group;
    const fields = Object.fromEntries(BOARDING_BAGGAGE_FIELDS.map(key =>
      [key, legs.find(record => record[key]?.trim())?.[key] || '']));
    const sticker = Object.values(fields).some(Boolean) ? {
      ...fields, to: destination(legs.at(-1)), via: legs.slice(0, -1).map(destination).filter(Boolean)
    } : null;
    legs.forEach((record, index) => result.set(record.id, { sticker: index === 0 ? sticker : null, laterLeg: index > 0 }));
  }
  return result;
}

export function otherBaggageLegs(record, records) {
  const number = record.type === 'flight' && flightTicketNumber(record.ticketNumber);
  return number ? records.filter(other => other.id !== record.id && activeFlight(other) &&
    flightTicketNumber(other.ticketNumber) === number) : [];
}

export function occupiedBaggageFields(legs) {
  return BOARDING_BAGGAGE_FIELDS.filter(key => legs.some(other => other[key]?.trim()));
}
