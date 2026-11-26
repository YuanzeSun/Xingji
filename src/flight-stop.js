import { flightQuery } from './flight-query.js';
import { resolvePlace } from './places.js';

export const airportCode = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export function normalizeFlightStop(record, value) {
  if (record.type !== 'flight' || record.deleted || !airportCode(value?.airport)) return;
  let query;
  try { query = flightQuery(record); } catch { return; }
  const { fnum, date, dep, arr } = query;
  if (!dep || !arr || dep === arr || fnum !== value.fnum || date !== value.date || dep !== value.dep || arr !== value.arr) return;
  if (value.airport === dep || value.airport === arr) return;
  return { fnum, date, dep, arr, airport: value.airport };
}

export function flightStopText(stop) {
  if (!stop) return '';
  const code = stop.airport;
  const place = resolvePlace({ type: 'flight', origin: code }, 'origin');
  return place.name ? `${place.name}（${code}）` : code;
}
