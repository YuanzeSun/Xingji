import {calendarDate} from './journey-date.js';
import { resolvePlace } from './places.js';
import { aircraftClassification } from './aircraft.js';
import { airlineNameForCode, airlineNameForLabel } from './airline-codes.js';
import { readBoardingCode } from './bcbp.js';
import { operatingFlight } from './boarding-code-state.js';
import { flightNumber } from './flight-query.js';
import { dateInterval } from './search.js';
import { CONTINENT_AIRPORT_CODES } from './data/airport-geography.js';
import { isJourneyRecord } from './record-kind.js';
import { flightTrackDistanceKm } from './flight-track.js';
import { normalizeRailBureau, normalizeRailModel, normalizeRailPowerSupply } from './rail-details.js';
import { railJourneyMatches, railText, isEmuModel } from './rail-journey.js';
import { journeyMinutes } from './journey-duration.js';

const CONTINENTS = Object.freeze({ AF: '非洲', AN: '南极洲', AS: '亚洲', EU: '欧洲', NA: '北美洲', OC: '大洋洲', SA: '南美洲' });
const airportContinents = new Map(Object.entries(CONTINENT_AIRPORT_CODES).flatMap(([continent, codes]) => codes.split(' ').filter(Boolean).map(code => [code, continent])));
// Foreign stations in the bundled 12306 catalogue; see docs/statistics.md for sources.
const laoStations = new Set(['YTM', 'VBM', 'VJM', 'VFM', 'VCM', 'VOM']);
const regionNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
const compare = new Intl.Collator('zh-CN', { numeric: true }).compare;
function railModelsForRecord(record, options) {
  const model = railText(record.railModel);
  const values = model ? [model] : railJourneyMatches(record) ? record.railJourney.trainsets.map(stock => railText(stock.model)) : [];
  const models = values.flatMap(value => value.split(/[/、,，;；+]/)).map(normalizeRailModel).filter(Boolean);
  if (!options.railPowerSupplies) return new Set(models);
  const supply = normalizeRailPowerSupply(record.railPowerSupply || '') || '供电制式未知';
  return new Set(models.map(model => isEmuModel(model) ? model : `${model} · ${supply}`));
}
export const countryName = code => code === 'CN' ? '中国' : regionNames.of(code) || code;
export function todayDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function statisticsOptions(input = {}, today = todayDate()) {
  const selectedEnd = input.dateTo || today;
  const dateTo = dateInterval(selectedEnd)?.end > today ? today : selectedEnd;
  return { dateFrom: input.dateFrom ?? '', dateTo, period: input.period === 'month' ? 'month' : 'year', year: input.year || '', chartZoom:Number.isFinite(input.chartZoom) ? Math.max(.0001,Math.min(8,input.chartZoom)) : 1, mergeDirections: input.mergeDirections !== false, railUnits:input.railUnits === true, railPowerSupplies:input.railPowerSupplies === true, aircraftSubtypes:input.aircraftSubtypes !== false, marketingAirlines:input.marketingAirlines === true };
}

export function statisticsRange(records, input = {}, today = todayDate()) {
  return filterStatisticsRange(records, statisticsOptions(input, today));
}

function filterStatisticsRange(records, { dateFrom, dateTo }) {
  const from = dateInterval(dateFrom), to = dateInterval(dateTo);
  if ((dateFrom && !from) || (dateTo && !to)) return { records: [], omittedDates: 0, error: '请选择有效的起止日期' };
  if (from && to && from.start > to.end) return { records: [], omittedDates: 0, error: '起始日期不能晚于截止日期' };
  let omittedDates = 0;
  const included = records.filter(record => {
    if (!isJourneyRecord(record)) return false;
    const interval = dateInterval(record.departureDate);
    if (!interval) { omittedDates++; return false; }
    if ((from && interval.end < from.start) || (to && interval.start > to.end)) return false;
    // Do not guess which side of the chosen boundary an imprecise date falls on.
    if ((from && interval.start < from.start) || (to && interval.end > to.end)) { omittedDates++; return false; }
    return true;
  });
  return { records: included, omittedDates, error: '' };
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
  const railModels = new Map(), railBureaus = new Map(), airlines = new Map();
  let unknownAircraft = 0, unknownAirlines = 0, unknownPlaces = 0, unknownRoutes = 0;
  let actualFlightDistance = 0, actualFlightDistanceTrips = 0;
  let rail = 0, flight = 0, railMileage = 0, railMileageTrips = 0;
  const travelTime = { rail: { minutes: 0, trips: 0 }, flight: { minutes: 0, trips: 0 } };
  for (const record of rows) {
    const minutes = journeyMinutes(record);
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
      for (const model of railModelsForRecord(record,options)) railModels.set(model, (railModels.get(model) || 0) + 1);
      let bureau = normalizeRailBureau(record.railBureau);
      if (options.railUnits) {
        const owner = String(record.railCarOwner || '').trim();
        bureau = owner ? [bureau, owner].filter(Boolean).join(' · ') : bureau ? bureau + ' · 单位未收录' : '';
      }
      if (bureau) railBureaus.set(bureau, (railBureaus.get(bureau) || 0) + 1);
    }
    const endpoints = ['origin', 'destination'].map(side => placeGeography(record, side));
    for (const place of endpoints) {
      if (!place) { unknownPlaces++; continue; }
      const collection = record.type === 'flight' ? airports : stations;
      collection.set(place.id, { id: place.id, name: place.name, code: place.code, country: place.country });
      if (place.country) countries.set(place.country, { code: place.country, name: countryName(place.country) });
      if (place.continent) continents.add(place.continent);
    }
    if (record.type !== 'flight') continue;
    flight++;
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
    if (endpoints.some(place => !place)) { unknownRoutes++; continue; }
    const pair = options.mergeDirections ? [...endpoints].sort((a,b)=>a.code.localeCompare(b.code)) : endpoints, id=pair.map(place=>place.code).join('-');
    if (!routes.has(id)) routes.set(id, { id, from: pair[0], to: pair[1], count: 0 });
    routes.get(id).count++;
  }
  const byName = values => [...values].sort((a, b) => compare(a.name, b.name));
  const years = [...new Set(rows.map(record => calendarDate(record.departureDate).slice(0, 4)))].sort();
  const ranked = collection => [...collection].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || compare(a.name, b.name));
  return { ...range, rail, flight,
    years, airports: byName(airports.values()), stations: byName(stations.values()), countries: byName(countries.values()),
    continents: [...continents].sort().map(code => ({ code, name: CONTINENTS[code] })),
    aircraft: ranked(aircraft), airlines: ranked(airlines),
    railMileage: Math.round(railMileage * 1000) / 1000,
    railMileageTrips, actualFlightDistance, actualFlightDistanceTrips, travelTime,
    railModels: ranked(railModels), railBureaus: ranked(railBureaus),
    routes: [...routes.values()].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)), unknownAircraft, unknownAirlines, unknownPlaces, unknownRoutes };
}

export function tripSeries(records, { period = 'year' } = {}) {
  const dated = records.filter(record => isJourneyRecord(record) && dateInterval(record.departureDate));
  const years = dated.map(record => Number(calendarDate(record.departureDate).slice(0, 4)));
  const first = Math.min(...years), last = Math.max(...years);
  const keys = !years.length ? [] : period === 'month'
    ? Array.from({ length: (last - first + 1) * 12 }, (_, i) => `${first + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`)
    : Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
  const buckets = new Map(keys.map(key => [key, { key, label: period === 'month' ? `${key.slice(0, 4)}年${Number(key.slice(5))}月` : key + '年', rail: 0, flight: 0 }]));
  for (const record of dated) {
    if (period === 'month' && calendarDate(record.departureDate).length < 7) continue;
    const bucket = buckets.get(calendarDate(record.departureDate).slice(0, period === 'month' ? 7 : 4));
    if (bucket) bucket[record.type]++;
  }
  return [...buckets.values()];
}
