import { normalizeRailRoute, railStationKey, isRailCoordinate } from './rail-route-snapshot.js';
import { resolvePlace } from './places.js';

export const RAIL_ROUTE_SOURCE = 'https://api.railgo.dev/479769351e0';
const distance = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180), a[1] - b[1]) * 111;

function stationName(record, side) {
  const place = resolvePlace(record, side);
  return railStationKey(place.status === 'matched' ? place.name : record[side]);
}

// Require both advertised stops, their order and an unbroken chain of real track segments.
// A city-level match or a straight line between stations is never a substitute.
export function selectRailRoute(record, payload) {
  if (record.type !== 'rail' || payload?.success !== true) return null;
  const data = payload.data;
  if (!Array.isArray(data?.stations) || !data.train || typeof data.train !== 'object' || Array.isArray(data.train)) return null;
  const stops = [];
  for (const row of data.stations) {
    if (!row || Object.keys(row).length !== 1) return null;
    const [[name, coordinates]] = Object.entries(row);
    if (!isRailCoordinate(coordinates)) return null;
    stops.push({ name: railStationKey(name), coordinates });
  }
  if (new Set(stops.map(stop => stop.name)).size !== stops.length) return null;
  const origin = stationName(record, 'origin'), destination = stationName(record, 'destination');
  const start = stops.findIndex(stop => stop.name === origin), end = stops.findIndex(stop => stop.name === destination);
  if (start < 0 || end <= start) return null;
  const segments = Object.entries(data.train).map(([name, value]) => ({ names: name.split('-').map(railStationKey), line: value?.line, index: value?.index })).sort((a, b) => a.index - b.index);
  if (segments.length > 1000 || new Set(segments.map(segment => segment.index)).size !== segments.length) return null;
  if (segments.some(segment => segment.names.length !== 2 || !Number.isSafeInteger(segment.index) || !Array.isArray(segment.line) || segment.line.length < 2 || segment.line.length > 50000 || !segment.line.every(isRailCoordinate))) return null;
  if (segments.reduce((count, segment) => count + segment.line.length, 0) > 50000) return null;
  function section(origin,destination) {
    const start=stops.findIndex(stop=>stop.name===origin),end=stops.findIndex(stop=>stop.name===destination);
    for (let offset = 0; offset < segments.length; offset++) {
      if (!segments[offset].names.includes(origin)) continue;
      let current = origin;
      const selected = [], nodes = new Map();
      for (const segment of segments.slice(offset)) {
        if (!segment.names.includes(current)) break;
        const next = segment.names.find(name => name !== current);
        if (!next) break;
        const expected = nodes.get(current) || stops[start].coordinates;
        const line = distance(segment.line[0], expected) <= distance(segment.line.at(-1), expected) ? segment.line : [...segment.line].reverse();
        if (distance(line[0], expected) > 2) break;
        nodes.set(current, line[0]); nodes.set(next, line.at(-1)); selected.push(line);
        current = next;
        if (current !== destination) continue;
        const matchedStops = stops.slice(start, end + 1);
        if (matchedStops.some(stop => !nodes.has(stop.name) || distance(nodes.get(stop.name), stop.coordinates) > 2)) break;
        return {segments:selected,stops:matchedStops.map(stop=>({name:stop.name,coordinates:nodes.get(stop.name)}))};
      }
    }
    return null;
  }
  const selected=section(origin,destination);
  if(!selected)return null;
  const fullRoute=section(stops[0].name,stops.at(-1).name);
  return normalizeRailRoute({service:record.service,origin,destination,...selected,...(fullRoute ? {fullRoute} : {}),queriedAt:new Date().toISOString()});
}

export async function fetchRailRoute(record, { fetcher = globalThis.fetch, signal } = {}) {
  const service = String(record.service || '').trim().toUpperCase();
  if (record.type !== 'rail' || !/^[A-Z]?\d{1,5}(?:\/(?:[A-Z]?\d{1,5}))*$/.test(service)) return null;
  const train = service.split('/')[0];
  const timeout = AbortSignal.timeout(20000);
  const response = await fetcher.call(globalThis, 'https://rg-api.zenglingkun.cn/api/v2/mapLine?train=' + encodeURIComponent(train), {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout, credentials: 'omit', referrerPolicy: 'no-referrer'
  });
  if (!response.ok) throw new Error('暂未取得铁路线路');
  const text = await response.text();
  if (text.length > 4000000) throw new Error('铁路线路数据过大');
  return selectRailRoute(record, JSON.parse(text));
}
