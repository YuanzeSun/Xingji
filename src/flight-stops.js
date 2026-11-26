import { flightQuery } from './flight-query.js';
import { resolvePlace } from './places.js';

export const airportCode = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export function normalizeFlightStops(record, value) {
  if (record.type !== 'flight' || record.deleted || !value || ![0, 1].includes(value.count) ||
    !Array.isArray(value.airports) || value.airports.length > value.count) return;
  let query;
  try { query = flightQuery(record); } catch { return; }
  const { fnum, date, dep, arr } = query;
  if (!dep || !arr || dep === arr || fnum !== value.fnum || date !== value.date || dep !== value.dep || arr !== value.arr) return;
  const airports = value.airports;
  if (airports.length && (!airportCode(airports[0]) || airports[0] === dep || airports[0] === arr)) return;
  return { fnum, date, dep, arr, count: value.count, airports: [...airports] };
}

export function flightStopsText(stops) {
  if (!stops) return '';
  if (stops.count === 0) return '直飞';
  const [code] = stops.airports;
  if (!code) return '经停一次，机场未记录';
  const place = resolvePlace({ type: 'flight', origin: code }, 'origin');
  return place.name ? `${place.name}（${code}）` : code;
}
