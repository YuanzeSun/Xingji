import {sameDate} from './journey-date.js';
import { createRecord, validDate } from './model.js';
import { resolvePlace } from './places.js';
import { AIRPORT_TIMEZONES } from './data/airport-timezones.js';
import { reconcileAircraft } from './aircraft.js';
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
  const payload = flightPayload(result);
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
    const record = { type: 'flight', template: 'air-boarding-pass', service: query.fnum, departureDate: departure.date, departureTime: departure.time,
      origin: dep, originCode: dep, destination: arr, destinationCode: arr,
      arrivalDate: arrival?.date || '', arrivalTime: arrival?.time || '', airline: clean(row.FlightCompany),
      actualDepartureDate: actualDeparture?.date || '', actualDepartureTime: actualDeparture?.time || '', actualArrivalDate: actualArrival?.date || '', actualArrivalTime: actualArrival?.time || '',
      flightDistance: /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(distance) && Number(distance) > 0 && Number(distance) <= 100000 ? distance : '',
      terminal: clean(row.FlightDepTerminal), gate: clean(row.BoardGate),
      boardingTime: plannedBoardingTime(row.scheduledBoardingTime ?? row.FlightBoardingTimePlanDate, departure.date, AIRPORT_TIMEZONES[dep]) };
    const key = JSON.stringify(record);
    if (!candidates.has(key)) candidates.set(key, { record, aircraftValues: new Set(), registrations: new Set() });
    const { aircraftValues, registrations } = candidates.get(key);
    for (const value of [row.miniAirplaneModels, row.generic, row.aircraftType]) {
      aircraftValues.add(Number.isInteger(value) ? String(value) : clean(value));
    }
    const registration = aircraftRegistration(row.aircraftNumber ?? row.AircraftNumber);
    if (registration) registrations.add(registration);
  }
  return [...candidates.values()].map(({ record, aircraftValues, registrations }) => {
    const { name, conflicts } = reconcileAircraft(aircraftValues);
    const candidate = createRecord({ ...record, aircraft: name, aircraftRegistration: registrations.size === 1 ? [...registrations][0] : '' });
    return conflicts.length ? { ...candidate, aircraftConflicts: conflicts } : candidate;
  });
}

function flightPayload(result) {
  let payload = result?.structuredContent;
  if (!payload) {
    const text = result?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') || '';
    try { payload = JSON.parse(text); } catch { throw new Error('尚未识别航班返回结构，未修改票据'); }
  }
  if (result.isError || payload?.error) throw new Error('飞常准未能完成查询，请检查账户权益或稍后重试');
  return payload;
}

function plannedBoardingTime(value, departureDate, zone) {
  const text = clean(value);
  if (/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(text)) return text.slice(0, 5);
  const planned = airportTime(text, zone);
  const previousDate = new Date(Date.parse(departureDate) - 86_400_000).toISOString().slice(0, 10);
  return planned && [departureDate, previousDate].includes(planned.date) ? planned.time : '';
}

function aircraftRegistration(value) {
  const text = clean(value).toUpperCase();
  if (!/^(?=.*[A-Z])[A-Z0-9]{1,3}-?[A-Z0-9]{2,5}$/.test(text) || /^(?:UNKNOWN|NONE|TBD)$/.test(text)) return '';
  return /^B-?[A-Z0-9]{4}$/.test(text) ? 'B-' + text.slice(-4) : text;
}

export function rotationRegistration(result, query) {
  const item = flightPayload(result)?.item;
  const flight = item?.currentFlight;
  if (!query.dep || !query.arr || flightIdentity(item?.fnum) !== flightIdentity(query.fnum) || item?.date !== query.date ||
    flightIdentity(flight?.fnum) !== flightIdentity(query.fnum) || flight?.departureCode !== query.dep || flight?.arrivalCode !== query.arr) return '';
  const registration = aircraftRegistration(item.aircraftNumber), current = aircraftRegistration(flight.aircraftNumber);
  return registration && current && registration !== current ? '' : current || registration;
}

// Public schedules cannot supply a passenger, fare, seat, cabin, PNR or barcode.
const scheduleFields = ['departureTime', 'flightDistance', 'airline', 'aircraft', 'terminal', 'gate', 'boardingTime'];
const timePairs = [['arrivalDate', 'arrivalTime'], ['actualDepartureDate', 'actualDepartureTime'], ['actualArrivalDate', 'actualArrivalTime']];
const canFill = (record, field) => !record[field] && !record.lockedFields?.includes(field);
const canCompletePair = (record, [first, second]) =>
  (canFill(record, first) && (record[second] || canFill(record, second))) ||
  (canFill(record, second) && record[first]);

export function flightLookupNeeds(record) {
  const incompleteAirport = ['origin', 'destination'].some(side => {
    const code = side + 'Code';
    return canCompletePair(record, [side, code]) &&
      ((!record[side] && !record[code]) || resolvePlace(record, side).status === 'matched');
  });
  return {
    schedule: incompleteAirport || scheduleFields.some(field => canFill(record, field)) || timePairs.some(pair => canCompletePair(record, pair)),
    registration: canFill(record, 'aircraftRegistration')
  };
}

export function flightCompletion(record, candidate) {
  if (record.type !== 'flight' || candidate.type !== 'flight' || flightIdentity(record.service) !== flightIdentity(candidate.service) || !sameDate(record.departureDate,candidate.departureDate)) return {};
  for (const side of ['origin', 'destination']) {
    const existing = resolvePlace(record, side), found = resolvePlace(candidate, side);
    if (existing.status === 'matched' && (found.status !== 'matched' || existing.code !== found.code)) return {};
  }
  const changes = {};
  const fill = (field, value) => { if (canFill(record, field) && value) changes[field] = value; };
  const fillTimePair = (date, time) => {
    if (!candidate[date] || !candidate[time]) return;
    if ((record[date] && !sameDate(record[date],candidate[date])) || (record[time] && record[time] !== candidate[time])) return;
    if (!canCompletePair(record, [date, time])) return;
    fill(date, candidate[date]); fill(time, candidate[time]);
  };
  for (const side of ['origin', 'destination']) {
    const code = side + 'Code', existing = resolvePlace(record, side), found = resolvePlace(candidate, side);
    const blank = !record[side]?.trim() && !record[code]?.trim();
    if (blank || (existing.status === 'matched' && found.status === 'matched' && existing.code === found.code)) {
      // Never attach a provider airport code to an unrelated handwritten name.
      if (canCompletePair(record, [side, code])) { fill(side, candidate[side]); fill(code, candidate[code]); }
    }
  }
  for (const field of [...scheduleFields, 'aircraftRegistration']) fill(field, candidate[field]);
  for (const [date, time] of timePairs) fillTimePair(date, time);
  return changes;
}
