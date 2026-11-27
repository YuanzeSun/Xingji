import { resolvePlace } from './places.js';
import { normalizeRailElevation } from './rail-elevation.js';

export const railStationKey = value => String(value || '').trim().replace(/\s/g, '').replace(/站$/, '');
const service = value => String(value || '').trim().toUpperCase();
export const isRailCoordinate = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) < 90;

function geometry(value) {
  const { segments, stops, lineLabels } = value;
  if (!Array.isArray(segments) || !segments.length || segments.length > 1000 ||
      segments.some(line => !Array.isArray(line) || line.length < 2 || !line.every(isRailCoordinate)) ||
      segments.reduce((count, line) => count + line.length, 0) > 50000) throw new Error('铁路线路坐标格式不正确');
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 300 ||
      stops.some(stop => !stop || !railStationKey(stop.name) || !isRailCoordinate(stop.coordinates)) ||
      new Set(stops.map(stop => railStationKey(stop.name))).size !== stops.length) throw new Error('铁路线路车站资料不正确');
  if (lineLabels !== undefined && (!Array.isArray(lineLabels) || lineLabels.length > 400 ||
      lineLabels.some(label => !label || typeof label.name !== 'string' || !label.name.trim() ||
        label.name.length > 100 || !isRailCoordinate(label.coordinates)))) throw new Error('铁路线路名称格式不正确');
  return {
    segments: segments.map(line => line.map(coordinates => [...coordinates])),
    stops: stops.map(({ name, coordinates }) => ({ name: railStationKey(name).slice(0, 100), coordinates: [...coordinates] })),
    ...(lineLabels?.length && { lineLabels: lineLabels.map(({ name, coordinates }) => ({ name: name.trim(), coordinates: [...coordinates] })) })
  };
}

export function normalizeRailRoute(value) {
  if (!value) return '';
  const train = service(value.service), origin = railStationKey(value.origin), destination = railStationKey(value.destination);
  const { queriedAt, elevation } = value;
  if (typeof value !== 'object' || Array.isArray(value) || !/^[A-Z]?\d{1,5}(?:\/[A-Z]?\d{1,5})*$/.test(train) ||
      !origin || !destination || origin === destination || typeof queriedAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT/.test(queriedAt) || !Number.isFinite(Date.parse(queriedAt))) throw new Error('铁路线路资料格式不正确');
  const selected = geometry(value);
  if (selected.stops[0].name !== origin || selected.stops.at(-1).name !== destination) throw new Error('铁路线路车站资料不正确');
  let fullRoute;
  if (value.fullRoute) {
    fullRoute = geometry(value.fullRoute);
    const fullStops = fullRoute.stops.map(stop => stop.name);
    const from = fullStops.indexOf(origin), to = fullStops.indexOf(destination);
    const fullSegments = fullRoute.segments.map(line => JSON.stringify(line));
    const selectedSegments = selected.segments.map(line => JSON.stringify(line));
    const firstSegment = fullSegments.indexOf(selectedSegments[0]);
    if (from < 0 || to <= from || fullStops.slice(from, to + 1).join('\0') !== selected.stops.map(stop => stop.name).join('\0') ||
        firstSegment < 0 || selectedSegments.some((segment, i) => segment !== fullSegments[firstSegment + i])) {
      throw new Error('列车全程线路与乘坐区间不一致');
    }
  }
  return {
    service: train, origin, destination, ...selected, ...(fullRoute && { fullRoute }), queriedAt: queriedAt.slice(0, 40),
    ...(elevation === undefined ? {} : { elevation: normalizeRailElevation(elevation) })
  };
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
