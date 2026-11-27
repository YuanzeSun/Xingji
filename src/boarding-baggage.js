import { readBoardingCode } from './bcbp.js';
import { BOARDING_BAGGAGE_FIELDS, boardingMetadataValues } from './boarding-metadata.js';
import { isInactiveFlight } from './flight-status.js';
import { calendarDate, journeyDate } from './journey-date.js';
import { flightTiming } from './journey-duration.js';
import { ticketServiceNumber } from './record-kind.js';

const day = 86_400_000;
const hasBags = data => BOARDING_BAGGAGE_FIELDS.some(key => data[key]?.trim());
const flightNumber = record => ticketServiceNumber(record.service);
function localDay(value) {
  const date = calendarDate(value);
  return date.length === 10 ? Date.parse(date + 'T00:00:00Z') : NaN;
}
const ticketNumber = value => String(value || '').normalize('NFKC').replace(/[\s-]/g, '').match(/^(\d{13})(?:\/\d{1,2})?$/)?.[1];
const originalBytes = record => record.boardingCodeSource === 'original' ? record.boardingCode?.rawBytes : '';
const activeFlight = record => record.type === 'flight' && !record.deleted && !isInactiveFlight(record);
const original = record => originalBytes(record) ? readBoardingCode(record.boardingCode, record.boardingLegIndex) : null;

function itineraryKey(record, code) {
  const number = ticketNumber(record.ticketNumber) || ticketNumber(code?.ticketNumber);
  if (number || !(code?.legCount > 1)) return number;
  const numbers = new Set(code.legs.map(leg => ticketNumber(leg.ticketNumber)).filter(Boolean));
  return numbers.size === 1 ? numbers.values().next().value : originalBytes(record);
}

// An explicit null means this ticket has no sticker in the current itinerary.
export function boardingBaggage(record) {
  if (Object.hasOwn(record, 'boardingSticker')) return record.boardingSticker;
  if (!activeFlight(record) || !hasBags(record)) return null;
  return originalBytes(record) ? boardingBaggageIndex([record]).get(record.id)?.sticker ?? null : record;
}

export function withBoardingBaggage(record, index) {
  return record.type === 'flight' ? { ...record, boardingSticker: index.get(record.id)?.sticker ?? null } : record;
}

function compareDeparture(a, b) {
  if (Number.isFinite(a.time.plannedDeparture) && Number.isFinite(b.time.plannedDeparture)) {
    return a.time.plannedDeparture - b.time.plannedDeparture;
  }
  return calendarDate(a.record.departureDate).localeCompare(calendarDate(b.record.departureDate)) ||
    (a.record.departureTime || '').localeCompare(b.record.departureTime || '');
}

function connects(previous, next) {
  if (!previous.destination || previous.destination !== next.origin || previous.origin === next.destination) return false;
  const gap = next.time.plannedDeparture - previous.time.plannedArrival;
  if (Number.isFinite(gap)) return gap >= 0 && gap <= day;
  if (next.time.plannedDeparture < previous.time.plannedDeparture) return false;
  const dateGap = localDay(next.record.departureDate) - localDay(previous.record.arrivalDate || previous.record.departureDate);
  return dateGap >= 0 && dateGap <= day;
}

function matchesLeg(entry, leg) {
  const ordinal = journeyDate(entry.record.departureDate)?.dayOfYear;
  return entry.origin === leg.originCode && entry.destination === leg.destinationCode &&
    (!ordinal || ordinal === leg.dayOfYear) &&
    [entry.record.service, entry.record.boardingCodeOperatingFlight, entry.code?.service]
      .some(service => ticketServiceNumber(service) === flightNumber(leg));
}

export function boardingBaggageIndex(records) {
  const result = new Map(), groups = new Map();
  for (const record of records) {
    if (!activeFlight(record)) continue;
    const code = original(record), key = itineraryKey(record, code);
    const entry = {
      record, code,
      origin: record.originCode || code?.originCode || '',
      destination: record.destinationCode || code?.destinationCode || ''
    };
    if (!key) place([entry], [entry.destination]);
    else {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
  }

  function place(entries, destinations, scanned = {}) {
    const [first] = entries;
    const fields = Object.fromEntries(BOARDING_BAGGAGE_FIELDS.map(key => {
      const filled = entries.map(entry => entry?.record).filter(record => record?.[key]?.trim());
      const manual = filled.filter(record => record.fieldSources?.[key] === 'manual')
        .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
      return [key, (manual[0] || filled[0])?.[key] || scanned[key] || ''];
    }));
    const sticker = hasBags(fields) ? { ...fields, to: destinations.at(-1), via: destinations.slice(0, -1).join(' / ') } : null;
    for (const entry of entries) if (entry) result.set(entry.record.id, {
      sticker: entry === first ? sticker : null, laterLeg: entry !== first
    });
  }

  for (const group of groups.values()) {
    const pending = new Set(group);
    for (const entry of group) {
      const legs = entry.code?.legs;
      if (!pending.has(entry) || !legs || legs.length < 2 ||
          !legs.slice(1).every((leg, index) => legs[index].destinationCode === leg.originCode)) continue;
      const matches = legs.map(leg => [...pending].find(other => matchesLeg(other, leg)));
      if (!matches.includes(entry)) continue;
      place(matches, legs.map(leg => leg.destinationCode), boardingMetadataValues(legs[0]));
      for (const match of matches) pending.delete(match);
    }
    if (pending.size === 1) {
      const [entry] = pending;
      place([entry], [entry.destination]);
      continue;
    }
    const waiting = [...pending];
    for (const entry of waiting) entry.time = flightTiming(entry.record);
    waiting.sort(compareDeparture);
    while (waiting.length) {
      const start = waiting.findIndex(next => !waiting.some(previous => previous !== next && connects(previous, next)));
      const chain = waiting.splice(Math.max(start, 0), 1);
      let next;
      while ((next = waiting.findIndex(entry => chain[0].origin !== entry.destination && connects(chain.at(-1), entry))) >= 0) {
        chain.push(...waiting.splice(next, 1));
      }
      place(chain, chain.map(leg => leg.destination));
    }
  }
  return result;
}

export function draftBoardingBaggage(draft, records) {
  const key = itineraryKey(draft, original(draft));
  if (!key) return boardingBaggageIndex([draft]);
  const related = records.filter(record => record.id !== draft.id && activeFlight(record) &&
    (ticketNumber(record.ticketNumber) || itineraryKey(record, original(record))) === key);
  return boardingBaggageIndex([draft, ...related]);
}
