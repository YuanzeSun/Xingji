import { flightQuery } from './flight-query.js';
import { resolvePlace } from './places.js';

export const MAX_FLIGHT_STOPS = 9;
export const airportCode = value => typeof value === 'string' && /^[A-Z]{3}$/.test(value);

export function normalizeFlightStops(record, value) {
  if (record.type !== 'flight' || record.deleted || !value || !Number.isInteger(value.count) ||
    value.count < 0 || value.count > MAX_FLIGHT_STOPS || !Array.isArray(value.airports) || value.airports.length > value.count) return;
  let query;
  try { query = flightQuery(record); } catch { return; }
  const { fnum, date, dep, arr } = query;
  if (!dep || !arr || dep === arr || fnum !== value.fnum || date !== value.date || dep !== value.dep || arr !== value.arr) return;
  const airports = value.airports;
  if (new Set(airports).size !== airports.length || !airports.every(code => airportCode(code) && code !== dep && code !== arr)) return;
  return { fnum, date, dep, arr, count: value.count, airports: [...airports] };
}

export function flightStopsText(stops) {
  if (!stops) return '';
  if (stops.count === 0) return '直飞';
  const names = stops.airports.map(code => {
    const place = resolvePlace({ type: 'flight', origin: code }, 'origin');
    return place.name ? `${place.name}（${code}）` : code;
  });
  if (!names.length) return `经停 ${stops.count} 次，机场未记录`;
  if (names.length < stops.count) names.push(`另有 ${stops.count - names.length} 站机场未记录`);
  return names.join('、');
}
