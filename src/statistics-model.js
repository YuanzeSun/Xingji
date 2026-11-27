import {calendarDate} from './journey-date.js';
import { resolvePlace } from './places.js';
import { aircraftClassification, normalizeAircraftRegistration } from './aircraft.js';
import { airlineNameForCode, airlineNameForLabel } from './airline-codes.js';
import { readBoardingCode } from './bcbp.js';
import { operatingFlight } from './boarding-code-state.js';
import { flightNumber } from './flight-query.js';
import { dateInterval } from './search.js';
import { CONTINENT_AIRPORT_CODES } from './data/airport-geography.js';
import { isJourneyRecord } from './record-kind.js';
import { flightTrackDistanceKm } from './flight-track.js';
import { normalizeRailBureau } from './rail-details.js';
import { railModelsForRecord } from './rail-model-statistics.js';
import { railText, railTrainsetIds } from './rail-journey.js';
import { railRouteMatches } from './rail-route-snapshot.js';
import { journeyTiming } from './journey-duration.js';

const CONTINENTS = Object.freeze({ AF: '非洲', AN: '南极洲', AS: '亚洲', EU: '欧洲', NA: '北美洲', OC: '大洋洲', SA: '南美洲' });
const airportContinents = new Map(Object.entries(CONTINENT_AIRPORT_CODES).flatMap(([continent, codes]) => codes.split(' ').filter(Boolean).map(code => [code, continent])));
// Foreign stations in the bundled 12306 catalogue; see docs/statistics.md for sources.
const laoStations = new Set(['YTM', 'VBM', 'VJM', 'VFM', 'VCM', 'VOM']);
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const compare = new Intl.Collator('zh-CN', { numeric: true }).compare;
const rankOrder = (a, b) => b.count - a.count || compare(a.name, b.name);
function addVehicleTrip(collection, name, record) {
  if (!collection.has(name)) collection.set(name, []);
  collection.get(name).push(record);
}
function repeatedVehicleTrips(collection) {
  return [...collection].filter(([, trips]) => trips.length >= 2)
    .map(([name, trips]) => ({
      name, count: trips.length,
      trips: trips.sort((a, b) => calendarDate(b.departureDate).localeCompare(calendarDate(a.departureDate)) ||
        (b.departureTime || '').localeCompare(a.departureTime || ''))
    })).sort(rankOrder);
}
export const countryName = code => code === 'CN' ? '中国' : regionNames.of(code) || code;
export function todayDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function statisticsOptions(input = {}, today = todayDate()) {
  const selectedEnd = input.dateTo || today;
  const dateTo = dateInterval(selectedEnd)?.end > today ? today : selectedEnd;
  return { dateFrom: input.dateFrom ?? '', dateTo, period: input.period === 'month' ? 'month' : 'year', year: input.year || '', chartZoom:Number.isFinite(input.chartZoom) ? Math.max(.0001,Math.min(8,input.chartZoom)) : 1, mergeDirections: input.mergeDirections !== false, railUnits:input.railUnits === true, railSubtypes:input.railSubtypes !== false, aircraftSubtypes:input.aircraftSubtypes !== false, marketingAirlines:input.marketingAirlines === true, includeStopoverAirports:input.includeStopoverAirports === true };
}

function filterStatisticsRange(records, { dateFrom, dateTo }) {
  const from = dateInterval(dateFrom), to = dateInterval(dateTo);
  if ((dateFrom && !from) || (dateTo && !to)) return { records: [], error: '请选择有效的起止日期' };
  if (from && to && from.start > to.end) return { records: [], error: '起始日期不能晚于截止日期' };
  const included = records.filter(record => {
    if (!isJourneyRecord(record)) return false;
    const interval = dateInterval(record.departureDate);
    // An imprecise date counts only when its whole interval fits.
    return interval && (!from || interval.start >= from.start) && (!to || interval.end <= to.end);
  });
  return { records: included, error: '' };
}

function placeGeography(record, side) {
  const place = resolvePlace(record, side);
  if (place.status !== 'matched') return null;
  if (record.type === 'rail') return { ...place, country: laoStations.has(place.code) ? 'LA' : 'CN', continent: 'AS' };
  return { ...place, country: ['HK', 'MO', 'TW'].includes(place.country) ? 'CN' : place.country, continent: airportContinents.get(place.code) || '' };
}

function flightAirline(record, byMarketing) {
  const operated = operatingFlight(record.boardingCodeOperatingFlight)?.carrier;
  const saved = airlineNameForLabel(operated || record.airline);
  if (!byMarketing && saved) return saved;
  const original = record.boardingCodeSource === 'original' && readBoardingCode(record.boardingCode, record.boardingLegIndex);
  const fromBoardingCode = airlineNameForLabel(original?.carrier);
  const marketed = airlineNameForLabel(record.marketingCarrier) || airlineNameForLabel(original?.marketingCarrier);
  const carrier = /^([A-Z]{2,3}|[A-Z]\d|\d[A-Z])\d{1,5}[A-Z]?$/.exec(flightNumber(record.service))?.[1];
  const byFlightNumber = airlineNameForCode(carrier);
  return byMarketing ? marketed || byFlightNumber || saved || fromBoardingCode : fromBoardingCode || (marketed ? '' : byFlightNumber);
}

export function journeyStatistics(records, input = {}, today = todayDate()) {
  const options = statisticsOptions(input, today), range = filterStatisticsRange(records, options), rows = range.records;
  const airports = new Map(), stations = new Map(), countries = new Map(), continents = new Set(), routes = new Map(), aircraft = new Map();
  const railModels = new Map(), railBureaus = new Map(), airlines = new Map(), railLines = new Map();
  const trainsets = new Map(), registrations = new Map();
  let unknownAircraft = 0, unknownAirlines = 0;
  let actualFlightDistance = 0, actualFlightDistanceTrips = 0;
  let rail = 0, flight = 0, railMileage = 0, railMileageTrips = 0;
  let railLineTrips = 0, arrivalDelayTrips = 0;
  const travelTime = { rail: { minutes: 0, trips: 0 }, flight: { minutes: 0, trips: 0 } };
  const fares = { rail: { cents: 0, trips: 0 }, flight: { cents: 0, trips: 0 } };
  const arrivalDelays = new Map();
  for (const record of rows) {
    if (record.price) {
      const fare = fares[record.type];
      fare.cents += Math.round(Number(record.price) * 100);
      fare.trips++;
    }
    const { minutes, arrivalDifference: delay } = journeyTiming(record);
    if (minutes) {
      travelTime[record.type].minutes += minutes;
      travelTime[record.type].trips++;
    }
    if (record.type === 'rail') {
      rail++;
      if (record.railMileage) {
        railMileage += Number(record.railMileage);
        railMileageTrips++;
      }
      const lineLabels = record.railRoute?.lineLabels;
      if (lineLabels?.length && railRouteMatches(record)) {
        railLineTrips++;
        for (const name of new Set(lineLabels.map(label => label.name))) railLines.set(name, (railLines.get(name) || 0) + 1);
      }
      for (const model of railModelsForRecord(record,options)) railModels.set(model, (railModels.get(model) || 0) + 1);
      for (const id of railTrainsetIds(record)) if (railText(id)) addVehicleTrip(trainsets, id, record);
      let bureau = normalizeRailBureau(record.railBureau);
      if (options.railUnits) {
        const owner = String(record.railCarOwner || '').trim();
        bureau = owner ? [bureau, owner].filter(Boolean).join(' · ') : bureau ? bureau + ' · 单位未收录' : '';
      }
      if (bureau) railBureaus.set(bureau, (railBureaus.get(bureau) || 0) + 1);
    }
    const endpoints = ['origin', 'destination'].map(side => placeGeography(record, side));
    for (const place of endpoints) {
      if (!place) continue;
      const collection = record.type === 'flight' ? airports : stations;
      collection.set(place.id, { id: place.id, name: place.name, code: place.code, country: place.country });
      if (place.country) countries.set(place.country, { code: place.country, name: countryName(place.country) });
      if (place.continent) continents.add(place.continent);
    }
    if (record.type !== 'flight') continue;
    flight++;
    if (Number.isFinite(delay)) {
      arrivalDelayTrips++;
      arrivalDelays.set(delay, (arrivalDelays.get(delay) || 0) + 1);
    }
    const code = options.includeStopoverAirports && record.flightStop?.airport;
    if (code && !airports.has(code)) {
      const { name = code, country = '' } = placeGeography({ type: 'flight', origin: code }, 'origin') || {};
      airports.set(code, { id: code, code, name, country });
    }
    const registration = normalizeAircraftRegistration(record.aircraftRegistration);
    if (registration) addVehicleTrip(registrations, registration, record);
    const airline = flightAirline(record, options.marketingAirlines);
    if (airline) airlines.set(airline, (airlines.get(airline) || 0) + 1);
    else unknownAirlines++;
    const trackDistance = flightTrackDistanceKm(record.flightTrack);
    if (trackDistance > 0) {
      actualFlightDistance += trackDistance;
      actualFlightDistanceTrips++;
    }
    const classification = aircraftClassification(record.aircraft);
    if (classification) {
      const model = options.aircraftSubtypes ? classification.label : classification.series;
      aircraft.set(model, (aircraft.get(model) || 0) + 1);
    } else unknownAircraft++;
    if (endpoints.some(place => !place)) continue;
    const pair = options.mergeDirections ? [...endpoints].sort((a,b)=>a.code.localeCompare(b.code)) : endpoints, id=pair.map(place=>place.code).join('-');
    if (!routes.has(id)) routes.set(id, { id, from: pair[0], to: pair[1], count: 0 });
    routes.get(id).count++;
  }
  const byName = values => [...values].sort((a, b) => compare(a.name, b.name));
  const years = [...new Set(rows.map(record => calendarDate(record.departureDate).slice(0, 4)))].sort();
  const ranked = collection => [...collection].map(([name, count]) => ({ name, count })).sort(rankOrder);
  return { ...range, rail, flight,
    years, airports: byName(airports.values()), stations: byName(stations.values()), countries: byName(countries.values()),
    continents: [...continents].sort().map(code => ({ code, name: CONTINENTS[code] })),
    aircraft: ranked(aircraft), airlines: ranked(airlines),
    railMileage: Math.round(railMileage * 1000) / 1000,
    railMileageTrips, actualFlightDistance, actualFlightDistanceTrips, travelTime, fares,
    railModels: ranked(railModels), railBureaus: ranked(railBureaus),
    railLines: ranked(railLines), railLineTrips, arrivalDelayTrips,
    arrivalDelays: [...arrivalDelays].sort(([a], [b]) => a - b).map(([minutes, count]) => ({ minutes, count })),
    repeatedTrainsets: repeatedVehicleTrips(trainsets), repeatedAircraft: repeatedVehicleTrips(registrations),
    routes: [...routes.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)), unknownAircraft, unknownAirlines };
}

export function tripSeries(records, { period = 'year' } = {}) {
  const dated = records.filter(record => isJourneyRecord(record) && dateInterval(record.departureDate))
    .map(record => ({ type: record.type, date: calendarDate(record.departureDate) }));
  const years = dated.map(({ date }) => Number(date.slice(0, 4)));
  const first = Math.min(...years), last = Math.max(...years);
  const keys = !years.length ? [] : period === 'month'
    ? Array.from({ length: (last - first + 1) * 12 }, (_, i) => `${first + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`)
    : Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
  const buckets = new Map(keys.map(key => [key, { key, label: period === 'month' ? `${key.slice(0, 4)}年${Number(key.slice(5))}月` : key + '年', rail: 0, flight: 0 }]));
  for (const { date, type } of dated) {
    const bucket = buckets.get(date.slice(0, period === 'month' ? 7 : 4));
    if (bucket) bucket[type]++;
  }
  return [...buckets.values()];
}
