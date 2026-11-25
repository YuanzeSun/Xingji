import { resolvePlace } from './places.js';

export const railStationKey = value => String(value || '').trim().replace(/\s/g, '').replace(/站$/, '');
const service = value => String(value || '').trim().toUpperCase();
export const isRailCoordinate = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) < 90;

function geometry(value) {
  if (!Array.isArray(value.segments) || !value.segments.length || value.segments.length > 1000 || value.segments.some(line => !Array.isArray(line) || line.length < 2 || !line.every(isRailCoordinate)) || value.segments.reduce((count,line) => count + line.length,0) > 50000) throw new Error('铁路线路坐标格式不正确');
  if (!Array.isArray(value.stops) || value.stops.length < 2 || value.stops.length > 300 || value.stops.some(stop => !stop || !railStationKey(stop.name) || !isRailCoordinate(stop.coordinates)) || new Set(value.stops.map(stop=>railStationKey(stop.name))).size!==value.stops.length) throw new Error('铁路线路车站资料不正确');
  if(value.lineLabels!==undefined&&(!Array.isArray(value.lineLabels)||value.lineLabels.length>400||value.lineLabels.some(label=>!label||typeof label.name!=='string'||!label.name.trim()||label.name.length>100||!isRailCoordinate(label.coordinates))))throw new Error('铁路线路名称格式不正确');
  return {segments:value.segments.map(line=>line.map(coordinates=>[...coordinates])),stops:value.stops.map(stop=>({name:railStationKey(stop.name).slice(0,100),coordinates:[...stop.coordinates]})),...(value.lineLabels?.length?{lineLabels:value.lineLabels.map(label=>({name:label.name.trim(),coordinates:[...label.coordinates]}))}:{})};
}

export function normalizeRailRoute(value) {
  if (!value) return '';
  if (typeof value !== 'object' || Array.isArray(value) || !/^[A-Z]?\d{1,5}(?:\/[A-Z]?\d{1,5})*$/.test(service(value.service)) || !railStationKey(value.origin) || !railStationKey(value.destination) || railStationKey(value.origin) === railStationKey(value.destination) || typeof value.queriedAt !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value.queriedAt) || !Number.isFinite(Date.parse(value.queriedAt))) throw new Error('铁路线路资料格式不正确');
  const selected=geometry(value);
  if(selected.stops[0].name!==railStationKey(value.origin) || selected.stops.at(-1).name!==railStationKey(value.destination))throw new Error('铁路线路车站资料不正确');
  let fullRoute;
  if(value.fullRoute){
    fullRoute=geometry(value.fullRoute);
    const from=fullRoute.stops.findIndex(stop=>stop.name===railStationKey(value.origin)),to=fullRoute.stops.findIndex(stop=>stop.name===railStationKey(value.destination));
    const keys=fullRoute.segments.map(line=>JSON.stringify(line)),segment=keys.indexOf(JSON.stringify(selected.segments[0]));
    if(from<0 || to<=from || fullRoute.stops.slice(from,to+1).map(stop=>stop.name).join('\0')!==selected.stops.map(stop=>stop.name).join('\0') || segment<0 || selected.segments.some((line,i)=>JSON.stringify(line)!==keys[segment+i]))throw new Error('列车全程线路与乘坐区间不一致');
  }
  return { service:service(value.service), origin:railStationKey(value.origin).slice(0,100), destination:railStationKey(value.destination).slice(0,100), ...selected,...(fullRoute ? {fullRoute} : {}), queriedAt:value.queriedAt.slice(0,40) };
}

export const savedRailRoute = record => railRouteMatches(record) ? normalizeRailRoute(record.railRoute) : null;

export function railRouteNeedsSave(record, route) {
  if (!railRouteMatches(record, route)) return false;
  if (!railRouteMatches(record)) return true;
  // With a saved timetable, the lookup has already checked whether it can retain the full route.
  if (!record.railJourney && record.railRoute.fullRoute && !route.fullRoute) return false;
  return JSON.stringify(record.railRoute) !== JSON.stringify(route);
}

export function railRouteMatches(record, route = record.railRoute) {
  if (record.type !== 'rail' || record.template === 'rail-refund-receipt' || !route || service(record.service).split('/')[0] !== service(route.service).split('/')[0]) return false;
  return ['origin','destination'].every(side => {
    const place = resolvePlace(record,side);
    return !['ambiguous','conflict'].includes(place.status) && railStationKey(place.status === 'matched' ? place.name : record[side]) === route[side];
  });
}
