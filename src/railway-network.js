import { normalizeRailRoute, railRouteMatches } from './rail-route-snapshot.js';
import { railMapPoint, railWgs84Point } from './rail-projection.js';
import { isJourneyRecord } from './record-kind.js';

export function savedRailwayNetwork(records) {
  const rows = records.filter(record => record.type === 'rail' && isJourneyRecord(record));
  const groups = new Map();
  const routes = [], unmatched = [], failed = [];
  for (const record of rows) {
    if (!railRouteMatches(record)) {
      unmatched.push(record);
      continue;
    }
    const { origin, destination } = record.railRoute;
    const service = record.service.trim().toUpperCase().split('/')[0];
    const key = JSON.stringify([service, origin, destination]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const group of groups.values()) {
    try {
      routes.push({ route: normalizeRailRoute(group[0].railRoute), records: group });
    } catch {
      failed.push(...group);
    }
  }
  return { records: rows, routes, unmatched, failed };
}

export function railwayTicketPicker(routes) {
  const paths = routes.map(({ route, records }) => {
    const segments = route.segments.map(line => line.map(railMapPoint));
    const bounds = segments.flat().reduce(([left, top, right, bottom], [x, y]) =>
      [Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)],
    [Infinity, Infinity, -Infinity, -Infinity]);
    return { segments, bounds, records };
  });
  return ([mapX, y], unit) => {
    const x = ((mapX % 1000) + 1000) % 1000, radius = 9 * unit;
    let nearest = radius;
    const matches = [];
    for (const { segments, bounds: [left, top, right, bottom], records } of paths) {
      if (x < left - radius || x > right + radius || y < top - radius || y > bottom + radius) continue;
      let distance = Infinity;
      for (const line of segments) for (let index = 1; index < line.length; index++) {
        const [ax, ay] = line[index - 1], [bx, by] = line[index];
        const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
        const fraction = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
        distance = Math.min(distance, Math.hypot(x - ax - fraction * dx, y - ay - fraction * dy));
      }
      if (distance > radius) continue;
      nearest = Math.min(distance, nearest);
      matches.push({ distance, records });
    }
    return matches.filter(match => match.distance <= nearest + 2 * unit).flatMap(match => match.records);
  };
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
    if (!nodes.has(id)) nodes.set(id, { id, name: stop.name, code: '', coordinates: railWgs84Point(stop.coordinates), trips: new Set(), routes: new Set() });
    for (const record of records) nodes.get(id).trips.add(record.id);
  }
  const projected = edges.map(edge => edge.map(railMapPoint));
  const bounds = projected.length ? projected.flat().reduce((box, [x, y]) => [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)], [Infinity, Infinity, -Infinity, -Infinity]) : [700, 98, 885, 215];
  const path = projected.map(([a, b]) => `M${a.map(value => value.toFixed(6)).join(',')}L${b.map(value => value.toFixed(6)).join(',')}`).join('');
  return { bounds, nodes: [...nodes.values()], trackPath: path, lineLabels: [...lineLabels.values()] };
}
