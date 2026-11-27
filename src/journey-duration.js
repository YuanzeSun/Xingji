import { calendarDate, journeyDate } from './journey-date.js';

const DAY = 86_400_000;
const MINUTE = 60_000;
const offsetFormatters = new Map();

function offsetAt(formatter, instant) {
  const name = formatter.formatToParts(instant).find(part => part.type === 'timeZoneName')?.value;
  if (name === 'GMT') return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(name);
  if (!match) return NaN;
  const [, sign, hours, minutes, seconds = '0'] = match;
  return (sign === '-' ? -1 : 1) * (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000;
}

export function localInstant(date, time, zone) {
  const day = calendarDate(date);
  if (day.length !== 10 || !time || !zone) return NaN;
  const local = Date.parse(`${day}T${time}:00Z`);
  if (!Number.isFinite(local)) return NaN;
  if (!offsetFormatters.has(zone)) {
    try { offsetFormatters.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })); }
    catch { offsetFormatters.set(zone, null); }
  }
  const formatter = offsetFormatters.get(zone);
  if (!formatter) return NaN;
  // Check both offsets around a clock change to reject skipped and repeated wall times.
  const offsets = new Set([-DAY, 0, DAY].map(delta => offsetAt(formatter, local + delta)));
  const candidates = [...offsets].filter(offset => Number.isFinite(offset) && offsetAt(formatter, local - offset) === offset);
  return candidates.length === 1 ? local - candidates[0] : NaN;
}

export function flightDepartureOrder(record) {
  const date = journeyDate(record.departureDate);
  return {
    record,
    instant: localInstant(date, record.departureTime, record.departureZone),
    year: date?.year ?? 0,
    ordinal: date?.dayOfYear ?? 367
  };
}

export function compareFlightDeparture(a, b) {
  if (Number.isFinite(a.instant) && Number.isFinite(b.instant)) return a.instant - b.instant;
  return a.year - b.year || a.ordinal - b.ordinal ||
    (a.record.departureTime || '').localeCompare(b.record.departureTime || '') || a.record.id.localeCompare(b.record.id);
}

export function flightsInDepartureOrder(records) {
  if (records.length < 2) return records;
  return records.map(flightDepartureOrder).sort(compareFlightDeparture).map(entry => entry.record);
}

const durationMinutes = (departure, arrival) => arrival > departure ? Math.round((arrival - departure) / MINUTE) : 0;

export function flightTiming(record) {
  const { departureZone, arrivalZone } = record;
  const plannedDeparture = localInstant(record.departureDate, record.departureTime, departureZone);
  const plannedArrival = localInstant(record.arrivalDate, record.arrivalTime, arrivalZone);
  const actualDeparture = localInstant(record.actualDepartureDate, record.actualDepartureTime, departureZone);
  const actualArrival = localInstant(record.actualArrivalDate, record.actualArrivalTime, arrivalZone);
  return {
    plannedDeparture, plannedArrival, actualDeparture, actualArrival,
    plannedMinutes: durationMinutes(plannedDeparture, plannedArrival),
    actualMinutes: durationMinutes(actualDeparture, actualArrival),
    departureDifference: Math.round((actualDeparture - plannedDeparture) / MINUTE),
    arrivalDifference: Math.round((actualArrival - plannedArrival) / MINUTE)
  };
}

export function journeyTiming(record) {
  if (record.type === 'flight') {
    const { plannedMinutes, actualMinutes, arrivalDifference } = flightTiming(record);
    return { minutes: actualMinutes || plannedMinutes, arrivalDifference };
  }
  const { departureZone, arrivalZone } = record;
  const departure = localInstant(record.departureDate, record.departureTime, departureZone);
  const arrival = localInstant(record.arrivalDate, record.arrivalTime, arrivalZone);
  return { minutes: durationMinutes(departure, arrival), arrivalDifference: NaN };
}
