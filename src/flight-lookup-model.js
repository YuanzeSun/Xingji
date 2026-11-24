import {sameDate} from './journey-date.js';
import { createRecord, validDate } from './model.js';
import { resolvePlace } from './places.js';
import { AIRPORT_TIMEZONES } from './data/airport-timezones.js';
import { identifyAircraft } from './aircraft.js';
import { flightNumber, flightQuery } from './flight-query.js';

const clean = value => typeof value === 'string' && !/^(?:-+|null|undefined|n\/?a)$/i.test(value.trim()) ? value.trim().slice(0, 1000) : '';
const flightIdentity = value => flightNumber(value).replace(/^([A-Z0-9]{2})0+(?=\d)/, '$1');

function airportTime(value, zone) {
  const text = clean(value), match = text.match(/^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!match || !validDate(match[1])) return null;
  if (!match[4]) return { date: match[1], time: `${match[2]}:${match[3]}` };
  const instant = new Date(text.replace(' ', 'T'));
  if (!zone || !Number.isFinite(instant.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export function flightCandidates(result, input) {
  const query = flightQuery(input);
  let payload = result?.structuredContent;
  if (!payload) {
    const text = result?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') || '';
    try { payload = JSON.parse(text); } catch { throw new Error('尚未识别航班返回结构，未修改票据'); }
  }
  if (result.isError || payload?.error) throw new Error('飞常准未能完成查询，请检查账户权益或稍后重试');
  if (payload?.kind !== 'collection' || !Array.isArray(payload.items)) throw new Error('航班返回结构不符合工具定义，未修改票据');
  if (payload.items.length > 100) throw new Error('候选航班过多，请补充起降机场后再查询');
  const candidates = new Map();
  for (const row of payload.items) {
    if (!row || flightIdentity(row.FlightNo) !== flightIdentity(query.fnum)) continue;
    const dep = clean(row.FlightDepcode).toUpperCase(), arr = clean(row.FlightArrcode).toUpperCase();
    if (!/^[A-Z]{3}$/.test(dep) || !/^[A-Z]{3}$/.test(arr) || (query.dep && query.dep !== dep) || (query.arr && query.arr !== arr)) continue;
    const departure = airportTime(row.FlightDeptimePlanDate, AIRPORT_TIMEZONES[dep]), arrival = airportTime(row.FlightArrtimePlanDate, AIRPORT_TIMEZONES[arr]);
    if (!departure || departure.date !== query.date) continue;
    const actualDeparture = airportTime(row.FlightDeptimeDate, AIRPORT_TIMEZONES[dep]), actualArrival = airportTime(row.FlightArrtimeDate, AIRPORT_TIMEZONES[arr]);
    // The tool defines kilometres, without certifying a sum of actual track points.
    const distance = typeof row.distance === 'number' || typeof row.distance === 'string' ? String(row.distance).trim() : '';
    const record = createRecord({ type: 'flight', template: 'air-boarding-pass', service: query.fnum, departureDate: departure.date, departureTime: departure.time,
      origin: dep, originCode: dep, destination: arr, destinationCode: arr,
      arrivalDate: arrival?.date || '', arrivalTime: arrival?.time || '', airline: clean(row.FlightCompany),
      actualDepartureDate: actualDeparture?.date || '', actualDepartureTime: actualDeparture?.time || '', actualArrivalDate: actualArrival?.date || '', actualArrivalTime: actualArrival?.time || '',
      flightDistance: /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(distance) && Number(distance) > 0 && Number(distance) <= 100000 ? distance : '',
      aircraft: [row.miniAirplaneModels, row.generic, row.aircraftType].map(clean).find(value => identifyAircraft(value) || /\d/.test(value)) || '', terminal: clean(row.FlightDepTerminal), gate: clean(row.BoardGate) });
    const id = JSON.stringify([record.service, record.departureDate, dep, arr, record.departureTime, record.arrivalDate, record.arrivalTime, record.actualDepartureDate, record.actualDepartureTime, record.actualArrivalDate, record.actualArrivalTime, record.flightDistance, record.aircraft, record.terminal, record.gate]);
    candidates.set(id, record);
  }
  return [...candidates.values()];
}

// Public schedules cannot supply a passenger, fare, seat, cabin, PNR or barcode.
const completionFields = ['departureTime', 'flightDistance', 'airline', 'aircraft', 'terminal', 'gate'];
export function flightCompletion(record, candidate) {
  if (record.type !== 'flight' || candidate.type !== 'flight' || flightIdentity(record.service) !== flightIdentity(candidate.service) || !sameDate(record.departureDate,candidate.departureDate)) return {};
  for (const side of ['origin', 'destination']) {
    const existing = resolvePlace(record, side), found = resolvePlace(candidate, side);
    if (existing.status === 'matched' && (found.status !== 'matched' || existing.code !== found.code)) return {};
  }
  const changes = {}, locked = new Set(record.lockedFields || []);
  const fill = (field, value) => { if (!record[field] && !locked.has(field) && value) changes[field] = value; };
  const fillTimePair = (date, time) => {
    if (!candidate[date] || !candidate[time]) return;
    if ((record[date] && !sameDate(record[date],candidate[date])) || (record[time] && record[time] !== candidate[time])) return;
    if ((!record[date] && locked.has(date)) || (!record[time] && locked.has(time))) return;
    fill(date, candidate[date]); fill(time, candidate[time]);
  };
  for (const side of ['origin', 'destination']) {
    const code = side + 'Code', existing = resolvePlace(record, side), found = resolvePlace(candidate, side);
    const blank = !record[side]?.trim() && !record[code]?.trim();
    if (blank || (existing.status === 'matched' && found.status === 'matched' && existing.code === found.code)) {
      // Never attach a provider airport code to an unrelated handwritten name.
      if (!(blank && (locked.has(side) || locked.has(code)))) { fill(side, candidate[side]); fill(code, candidate[code]); }
    }
  }
  for (const field of completionFields) fill(field, candidate[field]);
  fillTimePair('arrivalDate', 'arrivalTime');
  fillTimePair('actualDepartureDate', 'actualDepartureTime');
  fillTimePair('actualArrivalDate', 'actualArrivalTime');
  return changes;
}
