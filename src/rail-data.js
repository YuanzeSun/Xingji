import {calendarDate} from './journey-date.js';
import { loadRailRoute } from './rail-route.js';
import { railRouteMatches } from './rail-route-snapshot.js';
import { loadRailLineNames } from './rail-line-names.js';
import { railDetails } from './rail-lookup-model.js';
import {resolvePlace} from './places.js';
import { railText as clean, railService, railTime, railStation, isEmuModel, normalizeRailJourney, railJourneyRange, sameRailTimetable } from './rail-journey.js';
export const RAIL_DETAILS_SOURCE = 'https://api.railgo.dev/479755220e0';

async function requestJSON(url, { fetcher, signal }) {
  const response = await fetcher.call(globalThis, url.href, { credentials:'omit', referrerPolicy:'no-referrer', signal:signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
  if (response.status === 400 || response.status === 404) throw new Error('未查到该始发日期的列车资料，可手动填写');
  if (response.status === 429) throw new Error('RailGo 请求较频繁，请稍后再试');
  if (!response.ok) throw new Error('RailGo 暂时无法查询，请稍后重试或手动填写');
  const text = await response.text();
  if (text.length > 1000000) throw new Error('列车资料过大，未填入');
  try { return JSON.parse(text); } catch { throw new Error('未识别 RailGo 返回内容，未填入'); }
}

export function matchingRailTrainsets(payload, query) {
  if (payload?.success !== true || !Array.isArray(payload.data) || payload.data.length > 10000) return null;
  const day = `${query.date.slice(0,4)}-${query.date.slice(4,6)}-${query.date.slice(6)}`;
  const matches = payload.data.filter(row => typeof row?.runDate === 'string' && row.runDate.slice(0, 10) === day && railService(row.trainNum).split('/').includes(query.trainNum));
  const candidates = new Map();
  for (const row of matches) {
    if (!Array.isArray(row.trainCode) || row.trainCode.length < 1 || row.trainCode.length > 2) continue;
    const ids = [...new Set(row.trainCode.map(railService))];
    if (!ids.every(id => /^CR[A-Z\d-]{3,35}$/.test(id)) || (ids.length > 1 && row.coupling !== true)) continue;
    const key = [...ids].sort().join('/');
    candidates.set(key, { ids, coupling:row.coupling === true });
  }
  return candidates.size === 1 ? [...candidates.values()][0] : null;
}

function coachDetails(payload, queriedAt) {
  const row = payload?.data;
  if (payload?.success !== true || !row || Array.isArray(row)) return '';
  const images = list => (Array.isArray(list) ? list : []).slice(0,32).map(item => ({ name:clean(item.pictureName), url:clean(item.pictureUrl), number:clean(item.pictureName).match(/^(\d{1,2})车/)?.[1] || '' }));
  return { model:clean(row.trainStyle), code:clean(row.carCode), type:clean(row.carType), queriedAt, cars:images(row.coachPicList), info:(Array.isArray(row.carInfo) ? row.carInfo : []).slice(0,20).map(item => ({ name:clean(item.pictureName), value:clean(item.pictureValue) })) };
}

async function stockDetails(id, options, queriedAt) {
  const url = new URL('https://emu.railgo.zenglingkun.cn/api/car/info'); url.searchParams.set('id',id);
  const payload = await requestJSON(url, options), row = payload?.data;
  if (payload.success !== true || !row || railService(row.id) !== id) return { id };
  return { id, model:clean(row.model), subModel:clean(row.sub_model), manufactureMonth:clean(row.manufacture_month), manufacturer:clean(row.trainset_manufacturer), trailerManufacturer:clean(row.trailer_manufacturer), depot:clean(row.depot), trainDepot:clean(row.train_depot), socket:clean(row.socket_location),customType:clean(row.custom_type),modelRemark:clean(row.remark?.model),carRemark:clean(row.remark?.car?.note), queriedAt };
}

export function compactRailGates(gates) {
  return [...new Set(gates.flatMap(value=>{
    const match=value.match(/([A-Z]?\d+[A-Z]?(?:[-/、至—][A-Z]?\d+[A-Z]?)*)\s*检票口$/i);
    return match ? match[1].split(/[、/]/) : [value];
  }))].join(' / ');
}
async function stationAccess(result,options) {
  const journey=result.railJourney,index=journey.stops.findIndex(stop=>stop.station===journey.query.origin),stop=journey.stops[index];
  const place=resolvePlace({type:'rail',origin:stop.station},'origin');if(place.status!=='matched')return null;
  const date=stop.departureDate;
  const trainNum=journey.stops[index-1]?.trainCode||stop.trainCode||result.query.trainNum;
  const url=new URL('https://rg-api.zenglingkun.cn/api/v2/getExit');
  for(const [key,value] of Object.entries({trainNum,stationTelecode:place.code,date:calendarDate(date),kind:'departure'}))url.searchParams.set(key,value);
  const payload=await requestJSON(url,options),row=payload.data;
  if(payload.success!==true||!row||Array.isArray(row))return null;
  const gates=Array.isArray(row.entrance) ? [...new Set(row.entrance.map(clean).filter(Boolean))].slice(0,20) : [];
  const platform=clean(row.platform);if(!gates.length&&!platform)return null;
  return {station:stop.station,date,gates,platform};
}

function validDistances(distances) {
  return distances[0] === 0 && distances.every((km, i) =>
    Number.isFinite(km) && km <= 100000 && (i === 0 || km > distances[i - 1]));
}

function retainSavedDetails(journey, saved, { emuPossible }) {
  if (!saved) return;
  if (!journey.distanceQueriedAt && saved.distanceQueriedAt
      && validDistances(saved.stops.map(stop => stop.distanceKm))) {
    journey.stops.forEach((stop, i) => { stop.distanceKm = saved.stops[i].distanceKm; });
    journey.distanceQueriedAt = saved.distanceQueriedAt;
  }
  if (!journey.trainsets.length && emuPossible) {
    journey.trainsets = saved.trainsets;
    journey.coupling = saved.coupling;
  } else {
    const byId = new Map(saved.trainsets.map(stock => [stock.id, stock]));
    journey.trainsets = journey.trainsets.map(stock => ({
      ...byId.get(stock.id), ...Object.fromEntries(Object.entries(stock).filter(([, value]) => value)),
    }));
  }
  const oldAccess = saved.access.find(item => calendarDate(item.date) === calendarDate(journey.query.boardingDate));
  if (oldAccess) {
    const fresh = journey.access[0];
    journey.access = [fresh ? {
      ...fresh, platform: fresh.platform || oldAccess.platform,
      gates: fresh.gates.length ? fresh.gates : oldAccess.gates,
    } : oldAccess];
  }
  if (!saved.coaches) return;
  const fresh = journey.coaches, identity = ['model', 'code', 'type'];
  if (!fresh || ![...identity.map(key => fresh[key]), ...fresh.cars, ...fresh.info].some(Boolean)) {
    journey.coaches = saved.coaches;
  } else if (identity.every(key => !fresh[key] || fresh[key] === saved.coaches[key])) {
    for (const key of identity) fresh[key] ||= saved.coaches[key];
    if (!fresh.cars.length) fresh.cars = saved.coaches.cars;
    if (!fresh.info.length) fresh.info = saved.coaches.info;
  }
}

function retainFullRoute(route, saved, stops) {
  const coversJourney = candidate => candidate?.stops[0]?.name === stops[0].station
    && candidate.stops.at(-1)?.name === stops.at(-1).station;
  if (!coversJourney(route.fullRoute)) delete route.fullRoute;
  if (!route.fullRoute && coversJourney(saved?.fullRoute)
      && JSON.stringify(route.segments) === JSON.stringify(saved.segments)
      && JSON.stringify(route.stops) === JSON.stringify(saved.stops)) {
    route.fullRoute = structuredClone(saved.fullRoute);
  }
  return route;
}

export async function lookupRailDetails(query, { fetcher = globalThis.fetch, signal, enrich = true, railRoute = '', railJourney = '' } = {}) {
  const options = { fetcher, signal };
  const main = async input => {
    const url = new URL('https://rg-api.zenglingkun.cn/api/v2/getTrainMain');
    url.searchParams.set('trainNum',input.trainNum); url.searchParams.set('date',input.date);
    return railDetails(await requestJSON(url,options), input);
  };
  let result;
  try { result = await main(query); }
  catch (error) {
    // Only infer an earlier first-station date from a validated matching timetable.
    if (!error.startDate || query.date !== query.boardingDate.replaceAll('-','')) throw error;
    result = await main({ ...query, date:error.startDate.replaceAll('-','') });
  }
  if (!enrich) return result;
  const journey = result.railJourney, queriedAt = journey.queriedAt;
  const saved = sameRailTimetable(railJourney, journey) ? railJourney : null;
  const routeRecord = {type:'rail', service:result.query.trainNum, origin:result.query.origin, destination:result.query.destination};
  const previousRoute = railRouteMatches(routeRecord, railRoute) ? railRoute : null;
  const savedRoute = saved ? previousRoute : null;
  let partialStock = false;
  const stocks = async () => {
    if (!isEmuModel(result.railModel)) return;
    const url = new URL('https://emu.railgo.zenglingkun.cn/api/query'); url.searchParams.set('keyword',result.query.trainNum);
    const match = matchingRailTrainsets(await requestJSON(url,options),result.query);
    if (!match) return;
    journey.coupling = match.coupling;
    const details = await Promise.allSettled(match.ids.map(id => stockDetails(id,options,queriedAt)));
    partialStock = details.some(item => item.status === 'rejected');
    journey.trainsets = details.map((item,i) => item.status === 'fulfilled' ? item.value : { id:match.ids[i] });
  };
  const coaches = async () => {
    const url=new URL('https://rg-api.zenglingkun.cn/api/v2/getCoachPic');url.searchParams.set('train',result.query.trainNum);
    journey.coaches=coachDetails(await requestJSON(url,options),queriedAt);
  };
  const access=async()=>{
    const departure=await stationAccess(result,options);journey.access=departure?[departure]:[];
  };
  const mileage=async()=>{
    const url=new URL('https://data.railgo.zenglingkun.cn/api/train/query');url.searchParams.set('train',result.query.trainNum);
    const payload=await requestJSON(url,options),row=payload.data || payload,rows=row.timetable;
    if(!Array.isArray(row.numberFull) || !row.numberFull.includes(result.query.trainNum) || !Array.isArray(row.rundays) || !row.rundays.includes(result.query.date) || !Array.isArray(rows) || rows.length!==journey.stops.length)return;
    if(rows.some((stop,i)=>railStation(stop.station)!==journey.stops[i].station || railTime(stop.arrive)!==journey.stops[i].arrivalTime || railTime(stop.depart)!==journey.stops[i].departureTime || !Number.isInteger(stop.day) || (railTime(stop.arrive) && shiftRailDateForMileage(result.query.date,stop.day)!==calendarDate(journey.stops[i].arrivalDate)) || (railTime(stop.depart) && shiftRailDateForMileage(result.query.date,stop.day+(railTime(stop.arrive) && stop.depart<stop.arrive ? 1 : 0))!==calendarDate(journey.stops[i].departureDate))))return;
    if (!validDistances(rows.map(stop => stop.distance))) return;
    journey.stops.forEach((stop,i)=>{stop.distanceKm=rows[i].distance;});journey.distanceQueriedAt=queriedAt;
  };
  const extras = await Promise.allSettled([stocks(),coaches(),mileage(),access(), (async () => {
    const route = await loadRailRoute(routeRecord,{...options,refresh:true});
    if (route) {
      result.railRoute = await loadRailLineNames(retainFullRoute(route, savedRoute, journey.stops),options);
      // A name-source outage must not erase labels already verified for this geometry.
      for (const section of ['', 'fullRoute']) {
        const current=section ? result.railRoute[section] : result.railRoute, savedGeometry=section ? previousRoute?.[section] : previousRoute;
        if(current && !current.lineLabels?.length && savedGeometry?.lineLabels?.length && JSON.stringify(current.segments)===JSON.stringify(savedGeometry.segments)) current.lineLabels=structuredClone(savedGeometry.lineLabels);
      }
    }
  })()]);
  if (signal?.aborted) throw signal.reason;
  const fresh = normalizeRailJourney(journey);
  retainSavedDetails(fresh, saved, {emuPossible: !result.railModel || isEmuModel(result.railModel)});
  result.railJourney = fresh;
  if (savedRoute && !result.railRoute) result.railRoute = savedRoute;
  const accessAtOrigin = fresh.access[0];
  if (accessAtOrigin) {
    result.gate = compactRailGates(accessAtOrigin.gates);
    result.railPlatform = accessAtOrigin.platform;
  }
  if (fresh.distanceQueriedAt) {
    const {from, to} = railJourneyRange(fresh);
    result.railMileage = String(Math.round((fresh.stops[to].distanceKm - fresh.stops[from].distanceKm) * 1000) / 1000);
  }
  // Date-matched, identified stock is more specific than the main timetable's model snapshot.
  if (fresh.trainsets.length && fresh.trainsets.every(stock => stock.model)) result.railModel = [...new Set(fresh.trainsets.map(stock=>stock.model))].join(' / ');
  result.partial = partialStock || extras.some(item => item.status === 'rejected');
  return result;
}

function shiftRailDateForMileage(date,days){const value=new Date(date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6)+'T00:00:00Z');value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);}
