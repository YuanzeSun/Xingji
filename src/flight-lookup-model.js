import {sameDate} from './journey-date.js';
import { createRecord, validDate } from './model.js';
import { resolvePlace } from './places.js';
import { AIRPORT_TIMEZONES } from './data/airport-timezones.js';
import { normalizeAircraftRegistration, reconcileAircraft } from './aircraft.js';
import { flightNumber, flightQuery } from './flight-query.js';
import { airlineNameForCode } from './airline-codes.js';
import { airportCode, normalizeFlightStop } from './flight-stop.js';
import { ticketFieldLocked } from './barcode-fields.js';
import { OPTIONAL_FLIGHT_TIMES } from './flight-times.js';

const clean = value => typeof value === 'string' && !/^(?:-+|null|undefined|n\/?a)$/i.test(value.trim()) ? value.trim().slice(0, 1000) : '';
const flightIdentity = value => flightNumber(value).replace(/^([A-Z0-9]{2})0+(?=\d)/, '$1');

function flightCarriers(row, marketedFlight) {
  const marketedCarrier = marketedFlight.slice(0, 2);
  const operatingCarriers = new Set([row.shareFlight, row.ShareFlightNo].map(flightIdentity)
    .filter(number => /^(?=[A-Z0-9]{0,1}[A-Z])[A-Z0-9]{2}\d{1,5}[A-Z]?$/.test(number))
    .map(number => number.slice(0, 2)).filter(carrier => carrier !== marketedCarrier));
  if (!operatingCarriers.size) return { airline: clean(row.FlightCompany) || airlineNameForCode(marketedCarrier), marketingCarrier: '' };
  const [operatingCarrier] = operatingCarriers;
  return {
    airline: operatingCarriers.size === 1 ? airlineNameForCode(operatingCarrier) || operatingCarrier : '',
    marketingCarrier: marketedCarrier
  };
}

function airportTime(value, zone) {
  const text = clean(value), match = text.match(/^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/);
  if (!match || !validDate(match[1])) return null;
  if (!match[4]) return { date: match[1], time: `${match[2]}:${match[3]}` };
  const instant = new Date(text.replace(' ', 'T'));
  if (!zone || !Number.isFinite(instant.getTime())) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function scheduleRow(row, fnum) {
  if (!row || flightIdentity(row.FlightNo) !== flightIdentity(fnum)) return;
  const dep = clean(row.FlightDepcode).toUpperCase(), arr = clean(row.FlightArrcode).toUpperCase();
  if (!airportCode(dep) || !airportCode(arr)) return;
  const departure = airportTime(row.FlightDeptimePlanDate, AIRPORT_TIMEZONES[dep]);
  if (!departure) return;
  const arrival = airportTime(row.FlightArrtimePlanDate, AIRPORT_TIMEZONES[arr]);
  const scheduled = [undefined, null, '', '0', 0].includes(row.LegFlag ?? row.legFlag);
  const rawCount = row.StopFlag ?? row.stopFlag;
  const number = typeof rawCount === 'string' && /^\d+$/.test(rawCount.trim()) ? Number(rawCount) : rawCount;
  const count = Number.isSafeInteger(number) && number >= 0 ? number : undefined;
  const airport = clean(row.StopAirportCode ?? row.stopAirportCode).toUpperCase();
  return { row, dep, arr, departure, arrival, scheduled, count, airport };
}

const localTime = time => time && `${time.date}T${time.time}`;

function stopFromLegs({ dep, arr, departure, arrival }, legs) {
  if (!arrival) return '';
  const starts = legs.filter(leg => leg.dep === dep && leg.arr !== dep && leg.arr !== arr &&
    localTime(leg.departure) === localTime(departure));
  const ends = legs.filter(leg => leg.arr === arr && localTime(leg.arrival) === localTime(arrival));
  const stops = new Set(starts.filter(first => ends.some(last =>
    first.arr === last.dep && localTime(first.arrival) <= localTime(last.departure))).map(leg => leg.arr));
  return stops.size === 1 ? stops.values().next().value : '';
}

function stopEvidenceFor(whole, legs) {
  const { dep, arr, count, airport } = whole;
  if (!whole.scheduled || dep === arr) return;
  if (count === 0 || count > 1) return { count };
  if (airport && !airportCode(airport)) return;
  const stop = airport && airport !== dep && airport !== arr ? airport : stopFromLegs(whole, legs);
  if (count === 1 || stop) return { count: 1, airport: stop };
}

function confirmedStopAirport(evidence) {
  if (evidence.some(value => value.count !== 1)) return;
  const airports = new Set(evidence.map(value => value.airport).filter(Boolean));
  if (airports.size === 1) return airports.values().next().value;
}

export function flightCandidates(result, input) {
  const query = flightQuery(input);
  const payload = flightPayload(result);
  if (payload?.kind !== 'collection' || !Array.isArray(payload.items)) throw new Error('航班返回结构不符合工具定义，未修改票据');
  if (payload.items.length > 100) throw new Error('候选航班过多，请补充起降机场后再查询');
  const candidates = new Map();
  const schedules = payload.items.map(row => scheduleRow(row, query.fnum)).filter(Boolean);
  const legs = schedules.filter(item => item.scheduled && item.arrival && !item.count && !item.airport);
  for (const item of schedules) {
    const { row, dep, arr, departure, arrival } = item;
    if (departure.date !== query.date || (query.dep && query.dep !== dep) || (query.arr && query.arr !== arr)) continue;
    const actualDeparture = airportTime(row.FlightDeptimeDate, AIRPORT_TIMEZONES[dep]), actualArrival = airportTime(row.FlightArrtimeDate, AIRPORT_TIMEZONES[arr]);
    // The tool defines kilometres, without certifying a sum of actual track points.
    const distance = typeof row.distance === 'number' || typeof row.distance === 'string' ? String(row.distance).trim() : '';
    const record = { type: 'flight', template: 'air-boarding-pass', service: query.fnum, departureDate: departure.date, departureTime: departure.time,
      origin: dep, originCode: dep, destination: arr, destinationCode: arr,
      arrivalDate: arrival?.date || '', arrivalTime: arrival?.time || '', ...flightCarriers(row, query.fnum),
      actualDepartureDate: actualDeparture?.date || '', actualDepartureTime: actualDeparture?.time || '', actualArrivalDate: actualArrival?.date || '', actualArrivalTime: actualArrival?.time || '',
      flightDistance: /^(?:0|[1-9]\d{0,5})(?:\.\d{1,3})?$/.test(distance) && Number(distance) > 0 && Number(distance) <= 100000 ? distance : '',
      departureTerminal: clean(row.FlightDepTerminal) || clean(row.FlightHTerminal),
      arrivalTerminal: clean(row.FlightArrTerminal) || clean(row.FlightTerminal), gate: clean(row.BoardGate),
      boardingTime: plannedBoardingTime(row.scheduledBoardingTime, departure.date, AIRPORT_TIMEZONES[dep]) ||
        plannedBoardingTime(row.FlightBoardingTimePlanDate, departure.date, AIRPORT_TIMEZONES[dep]) };
    const key = JSON.stringify(record);
    if (!candidates.has(key)) candidates.set(key, { record, aircraftValues: new Set(), registrations: new Set(), stopEvidence: [] });
    const { aircraftValues, registrations, stopEvidence } = candidates.get(key);
    const evidence = stopEvidenceFor(item, legs);
    if (evidence) stopEvidence.push(evidence);
    for (const value of [row.miniAirplaneModels, row.generic, row.aircraftType]) {
      aircraftValues.add(Number.isInteger(value) ? String(value) : clean(value));
    }
    const registration = normalizeAircraftRegistration(row.aircraftNumber) || normalizeAircraftRegistration(row.AircraftNumber);
    if (registration) registrations.add(registration);
  }
  return [...candidates.values()].map(({ record, aircraftValues, registrations, stopEvidence }) => {
    const { name, conflicts } = reconcileAircraft(aircraftValues);
    const airport = confirmedStopAirport(stopEvidence);
    const flightStop = airport ? {
      fnum: query.fnum, date: query.date, dep: record.originCode, arr: record.destinationCode, airport
    } : undefined;
    const candidate = createRecord({ ...record, aircraft: name, aircraftRegistration: registrations.size === 1 ? [...registrations][0] : '', flightStop });
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

export function rotationRegistration(result, query) {
  const item = flightPayload(result)?.item;
  const flight = item?.currentFlight;
  if (!query.dep || !query.arr || flightIdentity(item?.fnum) !== flightIdentity(query.fnum) || item?.date !== query.date ||
    flightIdentity(flight?.fnum) !== flightIdentity(query.fnum) || flight?.departureCode !== query.dep || flight?.arrivalCode !== query.arr) return '';
  const registration = normalizeAircraftRegistration(item.aircraftNumber), current = normalizeAircraftRegistration(flight.aircraftNumber);
  return registration && current && registration !== current ? '' : current || registration;
}

// Public schedules cannot supply a passenger, fare, seat, cabin, PNR or barcode.
const scheduleFields = ['departureTime', 'flightDistance', 'airline', 'aircraft', 'gate', 'boardingTime'];
const airportTerminals = [['origin', 'departureTerminal'], ['destination', 'arrivalTerminal']];
const timePairs = Object.entries(OPTIONAL_FLIGHT_TIMES);
const canFill = (record, field) => !record[field] && !record.lockedFields?.includes(field) && !ticketFieldLocked(record, field);
const canFillFlightStop = record => canFill(record, 'flightStop') && record.fieldSources?.flightStop !== 'manual';
const canCompletePair = (record, [first, second]) =>
  (canFill(record, first) && (record[second] || canFill(record, second))) ||
  (canFill(record, second) && record[first]);

export function flightLookupNeeds(record) {
  const incompleteAirport = airportTerminals.some(([side, terminal]) => {
    const code = side + 'Code';
    return (canCompletePair(record, [side, code]) || canFill(record, terminal)) &&
      ((!record[side] && !record[code]) || resolvePlace(record, side).status === 'matched');
  });
  return {
    schedule: incompleteAirport || scheduleFields.some(field => canFill(record, field)) || timePairs.some(pair => canCompletePair(record, pair)),
    registration: canFill(record, 'aircraftRegistration'),
    stopover: canFillFlightStop(record)
  };
}

export function flightCompletion(record, candidate) {
  if (record.type !== 'flight' || candidate.type !== 'flight' || flightIdentity(record.service) !== flightIdentity(candidate.service) || !sameDate(record.departureDate,candidate.departureDate)) return {};
  const changes = {};
  const fill = (field, value) => { if (canFill(record, field) && value) changes[field] = value; };
  for (const [side, terminal] of airportTerminals) {
    const code = side + 'Code', existing = resolvePlace(record, side), found = resolvePlace(candidate, side);
    if (existing.status === 'matched' && (found.status !== 'matched' || existing.code !== found.code)) return {};
    const blank = !record[side]?.trim() && !record[code]?.trim();
    // Never attach a provider airport code to an unrelated handwritten name.
    if (!blank && existing.status !== 'matched') continue;
    if (canCompletePair(record, [side, code])) { fill(side, candidate[side]); fill(code, candidate[code]); }
    if (found.status === 'matched') fill(terminal, candidate[terminal]);
  }
  for (const field of [...scheduleFields, 'aircraftRegistration', 'marketingCarrier']) fill(field, candidate[field]);
  for (const pair of timePairs) {
    const [date, time] = pair;
    if (!candidate[date] || !candidate[time]) continue;
    if ((record[date] && !sameDate(record[date], candidate[date])) || (record[time] && record[time] !== candidate[time])) continue;
    if (!canCompletePair(record, pair)) continue;
    fill(date, candidate[date]);
    fill(time, candidate[time]);
  }
  if (canFillFlightStop(record)) {
    const stop = normalizeFlightStop({ ...record, ...changes }, candidate.flightStop);
    if (stop) changes.flightStop = stop;
  }
  return changes;
}
