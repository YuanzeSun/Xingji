import { railRouteMatches, savedRailRoute } from './rail-route-snapshot.js';
import { resolvePlace } from './places.js';
import { railMapPoint, railWgs84Point } from './rail-projection.js';
import { isJourneyRecord } from './record-kind.js';

const endpoint = (record, side) => {
  const place = resolvePlace(record, side);
  return place.status === 'matched' ? place.name : String(record[side] || '').trim().replace(/站$/, '');
};
const railJourneyKey = record => JSON.stringify([record.service.trim().toUpperCase().split('/')[0], endpoint(record, 'origin'), endpoint(record, 'destination')]);

export async function loadRailwayNetwork(records, { loader = savedRailRoute, onProgress = () => {}, signal, concurrency = 4 } = {}) {
  const rows = records.filter(record => isJourneyRecord(record) && record.type === 'rail'), groups = new Map();
  const routes = [], unmatched = [], failed = [];
  for (const record of rows) {
    if (loader === savedRailRoute && !railRouteMatches(record)) { unmatched.push(record); continue; }
    const key = railJourneyKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const queue = [...groups.values()];
  let cursor = 0, completed = unmatched.length;
  if (completed && !signal?.aborted) onProgress({ completed, total: rows.length });
  async function worker() {
    while (cursor < queue.length && !signal?.aborted) {
      const group = queue[cursor++];
      try {
        const route = await loader(group.find(record => railRouteMatches(record)) || group[0]);
        if (signal?.aborted) break;
        if (route) routes.push({ route, records: group }); else unmatched.push(...group);
      } catch {
        if (signal?.aborted) break;
        failed.push(...group);
      }
      completed += group.length;
      onProgress({ completed, total: rows.length });
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), 4, queue.length) }, worker));
  return { records: rows, routes, unmatched, failed, cancelled: !!signal?.aborted };
}

// A sub-metre identity grid joins coincident track vertices. Collinear interval
// union also removes partial overlaps with different sampling and direction.
export function uniqueRailEdges(routes) {
  const scale = 1e6, edges = new Map();
  for (const { route } of routes) for (const line of route.segments) for (let i = 1; i < line.length; i++) {
    let a = line[i - 1].map(value => Math.round(value * scale)), b = line[i].map(value => Math.round(value * scale));
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) [a, b] = [b, a];
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const key = a.join(',') + ':' + b.join(',');
    if (!edges.has(key)) edges.set(key, { a, b });
  }
  const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  const lines = new Map();
  for (const edge of edges.values()) {
    const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1], divisor = gcd(Math.abs(dx), Math.abs(dy));
    const ux = dx / divisor, uy = dy / divisor, cross = BigInt(ux) * BigInt(edge.a[1]) - BigInt(uy) * BigInt(edge.a[0]);
    const key = `${ux},${uy},${cross}`, axis = ux ? 0 : 1;
    if (!lines.has(key)) lines.set(key, { axis, edges: [] });
    lines.get(key).edges.push(edge);
  }
  const result = [];
  for (const { axis, edges: group } of lines.values()) {
    group.sort((a, b) => a.a[axis] - b.a[axis]);
    let current;
    for (const edge of group) {
      if (current && edge.a[axis] <= current.b[axis]) { if (edge.b[axis] > current.b[axis]) current.b = edge.b; }
      else { if (current) result.push(current); current = { ...edge }; }
    }
    if (current) result.push(current);
  }
  return result.map(({ a, b }) => [a.map(value => value / scale), b.map(value => value / scale)]);
}

export function railwayGeometry(data) {
  const edges = uniqueRailEdges(data.routes), nodes = new Map();
  const lineLabels=new Map();
  for(const {route}of data.routes)for(const label of route.lineLabels||[]){const key=label.name+':'+label.coordinates.map(value=>value.toFixed(2)).join(',');if(lineLabels.size<10000)lineLabels.set(key,label);}
  for (const { route, records } of data.routes) for (const stop of [route.stops[0], route.stops.at(-1)]) {
    const id = 'station:' + stop.name;
    if (!nodes.has(id)) nodes.set(id, { id, name: stop.name, code: '', coordinates: railWgs84Point(stop.coordinates), point: railMapPoint(stop.coordinates), trips: new Set(), routes: new Set() });
    for (const record of records) nodes.get(id).trips.add(record.id);
  }
  const projected = edges.map(edge => edge.map(railMapPoint));
  const bounds = projected.length ? projected.flat().reduce((box, [x, y]) => [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)], [Infinity, Infinity, -Infinity, -Infinity]) : [700, 98, 885, 215];
  const path = projected.map(([a, b]) => `M${a.map(value => value.toFixed(6)).join(',')}L${b.map(value => value.toFixed(6)).join(',')}`).join('');
  return { center: 0, bounds, nodes: [...nodes.values()], routes: [], trackPath: path, edgeCount: edges.length,lineLabels:[...lineLabels.values()] };
}
