import { calendarDate } from './journey-date.js';

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

function localInstant(date, time, zone) {
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

const durationMinutes = (departure, arrival) => arrival > departure ? Math.round((arrival - departure) / MINUTE) : 0;

export function journeyTiming(record) {
  const { departureZone, arrivalZone } = record;
  const plannedArrival = localInstant(record.arrivalDate, record.arrivalTime, arrivalZone);
  let minutes = 0, arrivalDifference = NaN;
  if (record.type === 'flight') {
    const actualArrival = localInstant(record.actualArrivalDate, record.actualArrivalTime, arrivalZone);
    const actualDeparture = localInstant(record.actualDepartureDate, record.actualDepartureTime, departureZone);
    minutes = durationMinutes(actualDeparture, actualArrival);
    arrivalDifference = Math.round((actualArrival - plannedArrival) / MINUTE);
  }
  if (!minutes) {
    const plannedDeparture = localInstant(record.departureDate, record.departureTime, departureZone);
    minutes = durationMinutes(plannedDeparture, plannedArrival);
  }
  return { minutes, arrivalDifference };
}
