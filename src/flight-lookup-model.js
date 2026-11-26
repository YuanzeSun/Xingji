import {sameDate} from './journey-date.js';
import { createRecord, validDate } from './model.js';
import { resolvePlace } from './places.js';
import { AIRPORT_TIMEZONES } from './data/airport-timezones.js';
import { normalizeAircraftRegistration, reconcileAircraft } from './aircraft.js';
import { flightNumber, flightQuery } from './flight-query.js';
import { airlineNameForCode } from './airline-codes.js';
import { airportCode, MAX_FLIGHT_STOPS, normalizeFlightStops } from './flight-stops.js';

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
  const number = typeof rawCount === 'string' && /^[0-9]$/.test(rawCount) ? Number(rawCount) : rawCount;
  const count = Number.isInteger(number) && number >= 0 && number <= MAX_FLIGHT_STOPS ? number : undefined;
  const airports = clean(row.StopAirportCode ?? row.stopAirportCode).toUpperCase().split(/[,，;；|\s]+/).filter(Boolean);
  return { row, dep, arr, departure, arrival, scheduled, count, airports };
}

const localTime = time => time && `${time.date}T${time.time}`;

function airportsFromLegs(whole, legs) {
  const { dep, arr, departure, arrival, count } = whole;
  if (!arrival || legs.length < 2) return [];
  const routes = new Map();
  let budget = 1000;
  function follow(from, previousArrival, airports) {
    if (--budget <= 0 || routes.size > 1) return;
    for (const leg of legs) {
      if (leg.dep !== from || leg === whole) continue;
      const legDeparture = localTime(leg.departure);
      if (previousArrival ? legDeparture < previousArrival : legDeparture !== localTime(departure)) continue;
      if (leg.arr === arr) {
        if (airports.length && (count === undefined || count === airports.length) && localTime(leg.arrival) === localTime(arrival)) {
          routes.set(airports.join(','), airports);
        }
      } else if (leg.arr !== dep && !airports.includes(leg.arr) && airports.length < (count ?? MAX_FLIGHT_STOPS)) {
        follow(leg.arr, localTime(leg.arrival), [...airports, leg.arr]);
      }
    }
  }
  follow(dep, '', []);
  return routes.size === 1 && budget > 0 ? [...routes.values()][0] : [];
}

function stopsForSchedule(whole, legs, fnum) {
  const { dep, arr, departure, count, airports } = whole;
  if (!whole.scheduled || dep === arr) return;
  const codes = new Set(airports);
  let named = codes.size === airports.length && airports.every(code => airportCode(code) && code !== dep && code !== arr) &&
    airports.length <= (count ?? MAX_FLIGHT_STOPS) ? airports : [];
  if (count !== 0 && named.length < (count ?? 1)) {
    const inferred = airportsFromLegs(whole, legs);
    if (inferred.length && named.every(code => inferred.includes(code))) named = inferred;
  }
  const total = count ?? (named.length || undefined);
  if (total !== undefined) return { fnum, date: departure.date, dep, arr, count: total, airports: named };
}

function mergeStopEvidence(values) {
  const [first] = values;
  if (!first || values.some(value => value.count !== first.count)) return;
  const mostDetailed = values.reduce((best, value) => value.airports.length > best.airports.length ? value : best);
  return values.every(value => value.airports.every(code => mostDetailed.airports.includes(code)) &&
    (value.airports.length !== mostDetailed.airports.length || value.airports.join(',') === mostDetailed.airports.join(',')))
    ? mostDetailed : { ...first, airports: [] };
}

export function flightCandidates(result, input) {
  const query = flightQuery(input);
  const payload = flightPayload(result);
  if (payload?.kind !== 'collection' || !Array.isArray(payload.items)) throw new Error('航班返回结构不符合工具定义，未修改票据');
  if (payload.items.length > 100) throw new Error('候选航班过多，请补充起降机场后再查询');
  const candidates = new Map();
  const schedules = payload.items.map(row => scheduleRow(row, query.fnum)).filter(Boolean);
  const legs = schedules.filter(item => item.scheduled && item.arrival && !item.count && !item.airports.length);
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
      terminal: clean(row.FlightDepTerminal) || clean(row.FlightHTerminal), gate: clean(row.BoardGate),
      boardingTime: plannedBoardingTime(row.scheduledBoardingTime || row.FlightBoardingTimePlanDate, departure.date, AIRPORT_TIMEZONES[dep]) };
    const key = JSON.stringify(record);
    if (!candidates.has(key)) candidates.set(key, { record, aircraftValues: new Set(), registrations: new Set(), stopEvidence: [] });
    const { aircraftValues, registrations, stopEvidence } = candidates.get(key);
    const stops = stopsForSchedule(item, legs, query.fnum);
    if (stops) stopEvidence.push(stops);
    for (const value of [row.miniAirplaneModels, row.generic, row.aircraftType]) {
      aircraftValues.add(Number.isInteger(value) ? String(value) : clean(value));
    }
    const registration = normalizeAircraftRegistration(row.aircraftNumber) || normalizeAircraftRegistration(row.AircraftNumber);
    if (registration) registrations.add(registration);
  }
  return [...candidates.values()].map(({ record, aircraftValues, registrations, stopEvidence }) => {
    const { name, conflicts } = reconcileAircraft(aircraftValues);
    const candidate = createRecord({ ...record, aircraft: name, aircraftRegistration: registrations.size === 1 ? [...registrations][0] : '', flightStops: mergeStopEvidence(stopEvidence) });
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
const scheduleFields = ['departureTime', 'flightDistance', 'airline', 'aircraft', 'terminal', 'gate', 'boardingTime'];
const timePairs = [['arrivalDate', 'arrivalTime'], ['actualDepartureDate', 'actualDepartureTime'], ['actualArrivalDate', 'actualArrivalTime']];
const canFill = (record, field) => !record[field] && !record.lockedFields?.includes(field);
const needsStops = record => !record.flightStops || record.flightStops.airports.length < record.flightStops.count;
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
    schedule: incompleteAirport || needsStops(record) || scheduleFields.some(field => canFill(record, field)) || timePairs.some(pair => canCompletePair(record, pair)),
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
  for (const field of [...scheduleFields, 'aircraftRegistration', 'marketingCarrier']) fill(field, candidate[field]);
  for (const [date, time] of timePairs) fillTimePair(date, time);
  if (needsStops(record)) {
    const current = record.flightStops, found = normalizeFlightStops({ ...record, ...changes }, candidate.flightStops);
    if (found && (!current || (current.count === found.count && found.airports.length > current.airports.length &&
      current.airports.every(code => found.airports.includes(code))))) changes.flightStops = found;
  }
  return changes;
}
