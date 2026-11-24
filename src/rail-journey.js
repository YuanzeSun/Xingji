import {calendarDate,storedJourneyDate,sameDate} from './journey-date.js';
import { resolvePlace } from './places.js';

export const railText = value => typeof value === 'string' && !/^(?:-+|null|undefined|未知|暂无|无|n\/?a)$/i.test(value.trim()) ? value.trim().slice(0, 1000) : '';
export const railService = value => railText(value).normalize('NFKC').replace(/\s/g, '').toUpperCase();
export const railStation = value => railText(value).replace(/\s|站$/g, '');
export const isEmuModel = value => /^(?:CR(?:H|\d)|CJ\d|DJ\d)/i.test(railService(value));
const railDate = value => {
  const date = storedJourneyDate(value);
  return date?.year && date.dayOfYear ? date : '';
};
export const railTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '';
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)) ? value.slice(0, 40) : '';
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const texts = (value, keys) => Object.fromEntries(keys.map(key => [key, railText(value[key])]));
function picture(value) {
  if (typeof value !== 'string') return '';
  // The stored URL is also checked by the native renderer, where URL is unavailable.
  const match = value.trim().match(/^https:\/\/res\.railgo\.zenglingkun\.cn(?::443)?([/?#][^\x00-\x20\x7f\\]*)?$/i);
  if (!match) return '';
  const path = match[1] || '/';
  return ('https://res.railgo.zenglingkun.cn' + (path.startsWith('/') ? '' : '/') + path).slice(0, 1500);
}

// Persist a bounded, explicit snapshot rather than arbitrary provider responses.
export function normalizeRailJourney(value) {
  if (!value) return '';
  if (!object(value) || !object(value.query)) throw new Error('铁路行程资料格式不正确');
  const query = { trainNum:railService(value.query.trainNum), startDate:railDate(value.query.startDate), boardingDate:railDate(value.query.boardingDate), origin:railStation(value.query.origin), destination:railStation(value.query.destination) };
  if (!/^(?:[GDCZTKYLS]\d{1,5}|\d{3,5})$/.test(query.trainNum) || !query.startDate || !query.boardingDate || !query.origin || !query.destination || query.origin === query.destination || !timestamp(value.queriedAt)) throw new Error('铁路行程查询条件不完整');
  if (Object.hasOwn(value.query, 'referenceFor')) {
    const referenceFor = railDate(value.query.referenceFor);
    if (!referenceFor || sameDate(referenceFor, query.boardingDate)) throw new Error('铁路参考资料的乘车日期无效');
    query.referenceFor = referenceFor;
  }
  if (!Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 300) throw new Error('铁路经停站资料格式不正确');
  const stops = value.stops.map(stop => {
    if (!object(stop) || !railStation(stop.station)) throw new Error('铁路经停站资料格式不正确');
    return { station:railStation(stop.station), trainCode:railService(stop.trainCode), distanceKm:Number.isFinite(stop.distanceKm) && stop.distanceKm>=0 && stop.distanceKm<=100000 ? stop.distanceKm : null, arrivalDate:railDate(stop.arrivalDate), arrivalTime:railTime(stop.arrivalTime), departureDate:railDate(stop.departureDate), departureTime:railTime(stop.departureTime), stopMinutes:Number.isInteger(stop.stopMinutes) && stop.stopMinutes >= 0 && stop.stopMinutes <= 1440 ? stop.stopMinutes : null };
  });
  const from=stops.findIndex(stop=>stop.station===query.origin),to=stops.findIndex(stop=>stop.station===query.destination);
  if(from<0 || to<=from || stops.filter(stop=>stop.station===query.origin).length!==1 || stops.filter(stop=>stop.station===query.destination).length!==1 || !sameDate(stops[from].departureDate,query.boardingDate) || !stops[from].departureTime || !stops[to].arrivalDate || !stops[to].arrivalTime)throw new Error('铁路资料与乘车区间不一致');
  if (calendarDate(query.startDate) > calendarDate(query.boardingDate)) throw new Error('铁路始发日期晚于乘车日期');
  let previous = calendarDate(stops[0].departureDate) + 'T' + stops[0].departureTime;
  for (const [index, stop] of stops.entries()) for (const side of (index === 0 ? [] : index === stops.length - 1 ? ['arrival'] : ['arrival','departure'])) {
    if (!!stop[side+'Date'] !== !!stop[side+'Time']) throw new Error('铁路经停站日期与时间不完整');
    if (stop[side+'Date']) {
      const instant = calendarDate(stop[side+'Date']) + 'T' + stop[side+'Time'];
      if (instant < previous) throw new Error('铁路经停站时间顺序不正确');
      previous = instant;
    }
  }
  const trainsets = (Array.isArray(value.trainsets) ? value.trainsets : []).slice(0, 2).filter(stock => object(stock) && /^CR[A-Z\d-]{3,35}$/.test(railService(stock.id))).map(stock => ({
    ...texts(stock, ['model','subModel','manufacturer','trailerManufacturer','depot','trainDepot','socket','customType','modelRemark','carRemark']),
    id:railService(stock.id), manufactureMonth:/^\d{4}-(?:0[1-9]|1[0-2])$/.test(stock.manufactureMonth) ? stock.manufactureMonth : '', queriedAt:timestamp(stock.queriedAt)
  }));
  let coaches = '';
  if (object(value.coaches) && timestamp(value.coaches.queriedAt)) {
    const images = list => (Array.isArray(list) ? list : []).slice(0, 32).filter(item => object(item) && picture(item.url)).map(item => ({ name:railText(item.name), url:picture(item.url), number:/^\d{1,2}$/.test(item.number) ? item.number : '' }));
    coaches = { ...texts(value.coaches, ['model','code','type']), queriedAt:timestamp(value.coaches.queriedAt), cars:images(value.coaches.cars), info:(Array.isArray(value.coaches.info) ? value.coaches.info : []).slice(0, 20).filter(item => object(item) && railText(item.name) && !/婴儿|护理台|办公席|无障碍|卫生间|商务座/.test(railText(item.name)) && railText(item.value)).map(item => ({ name:railText(item.name), value:railText(item.value) })) };
  }
  const access=(Array.isArray(value.access)?value.access:[]).slice(0,1).filter(item=>object(item)&&railStation(item.station)===query.origin).map(item=>({station:railStation(item.station),date:railDate(item.date),platform:railText(item.platform),gates:(Array.isArray(item.gates)?item.gates:[]).slice(0,20).map(railText).filter(Boolean)}));
  return { query, queriedAt:timestamp(value.queriedAt), stops, distanceQueriedAt:timestamp(value.distanceQueriedAt), trainsets, coupling:value.coupling === true, coaches,access };
}

export function sameRailTimetable(saved, fresh) {
  if (!saved?.query || !fresh?.query || saved.stops.length !== fresh.stops.length) return false;
  if (!['trainNum', 'origin', 'destination'].every(key => saved.query[key] === fresh.query[key])
      || !['startDate', 'boardingDate', 'referenceFor'].every(key => sameDate(saved.query[key], fresh.query[key]))) return false;
  return fresh.stops.every((stop, i) => {
    const old = saved.stops[i];
    return ['station', 'trainCode', 'arrivalTime', 'departureTime'].every(key => old[key] === stop[key])
      && ['arrivalDate', 'departureDate'].every(key => calendarDate(old[key]) === calendarDate(stop[key]));
  });
}

export function railJourneyMatches(record, journey = record.railJourney) {
  if (record.type !== 'rail' || record.template === 'rail-refund-receipt' || !journey?.query) return false;
  const query = journey.query;
  return railService(record.service).split('/')[0] === query.trainNum && sameDate(record.departureDate, query.referenceFor || query.boardingDate) && ['origin','destination'].every(side => {
    const place = resolvePlace(record, side);
    return !['ambiguous','conflict'].includes(place.status) && railStation(place.status === 'matched' ? place.name : record[side]) === query[side];
  });
}

export const normalizeRailTrainsets=value=>[...new Set(railText(value).normalize('NFKC').toUpperCase().split(/[/、,，;；+\n]+/).map(id=>id.replace(/\s/g,'')).filter(Boolean))].join(' / ');
export const railTrainsetIds=record=>record.type==='rail' ? normalizeRailTrainsets(record.railTrainsets).split(' / ').filter(Boolean) : [];

export function railJourneyRange(journey) {
  const from=journey.stops.findIndex(stop=>stop.station===journey.query.origin),to=journey.stops.findIndex(stop=>stop.station===journey.query.destination);
  return {from,to,stops:journey.stops.slice(from,to+1)};
}
