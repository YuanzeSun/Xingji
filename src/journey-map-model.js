import {calendarDate} from './journey-date.js';
import { resolveCity } from './locations.js';
import { resolvePlace } from './places.js';
import { CITY_POINTS, AIRPORT_POINTS } from './data/map-reference.js';
import { isJourneyRecord } from './record-kind.js';

export function mapPoint(record, side) {
  if (record.type === 'flight') {
    const place = resolvePlace(record, side), coordinates = place.status === 'matched' && AIRPORT_POINTS[place.code];
    return coordinates ? { id: 'airport:' + place.code, name: place.name, code: place.code, coordinates } : null;
  }
  const city = resolveCity(record, side).city, coordinates = CITY_POINTS[city];
  return coordinates ? { id: 'city:' + city, name: city, code: '', coordinates: coordinates.slice(0, 2) } : null;
}

export function journeyNetwork(records, { type = 'all', year = 'all', deduplicate = true } = {}) {
  const rows = records.filter(record => isJourneyRecord(record) && (type === 'all' || record.type === type) && (year === 'all' || (year === 'unknown' ? !calendarDate(record.departureDate) : calendarDate(record.departureDate).startsWith(year))));
  const nodes = new Map(), routes = new Map(), unresolved = [];
  for (const record of rows) {
    const from = mapPoint(record, 'origin'), to = mapPoint(record, 'destination');
    if (!from || !to) { unresolved.push(record); continue; }
    for (const point of [from, to]) {
      if (!nodes.has(point.id)) nodes.set(point.id, { ...point, trips: new Set(), routes: new Set() });
      nodes.get(point.id).trips.add(record.id);
    }
    if (record.type === 'rail' && from.id === to.id) continue;
    const pair = [from, to].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), pairId = JSON.stringify([record.type, pair[0].id, pair[1].id]);
    const id = deduplicate ? pairId : JSON.stringify([record.type, record.id]);
    if (!routes.has(id)) routes.set(id, { id, pairId, aggregated: deduplicate, type: record.type, from: deduplicate ? pair[0] : from, to: deduplicate ? pair[1] : to, records: [] });
    routes.get(id).records.push(record);
    nodes.get(from.id).routes.add(id); nodes.get(to.id).routes.add(id);
  }
  for (const route of routes.values()) route.records.sort((a, b) => calendarDate(b.departureDate).localeCompare(calendarDate(a.departureDate)) || a.id.localeCompare(b.id));
  return { records: rows, mapped: rows.length - unresolved.length, unresolved, nodes: [...nodes.values()], routes: [...routes.values()].sort((a, b) => b.records.length - a.records.length || a.id.localeCompare(b.id)) };
}

const normalize = lon => ((lon + 180) % 360 + 360) % 360 - 180;
export function longitudeCenter(longitudes) {
  if (!longitudes.length) return 105;
  const values = longitudes.map(lon => ((lon % 360) + 360) % 360).sort((a, b) => a - b);
  let gap = -1, start = values[0];
  for (let i = 0; i < values.length; i++) {
    const next = values[(i + 1) % values.length] + (i === values.length - 1 ? 360 : 0), candidate = next - values[i];
    if (candidate > gap) { gap = candidate; start = next; }
  }
  return normalize(start + (360 - gap) / 2);
}
export function unwrapLongitude(lon, center) { return center + normalize(lon - center); }
export function projectPoint([lon, lat], center = 0) { return [(unwrapLongitude(lon, center) + 180) / 360 * 1000, (90 - lat) / 360 * 1000]; }

export function routeArc(a, b, type = 'flight', bendOffset = 0) {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
  if (length < .001) return { path: `M${a}c-12,-20 12,-20 0,0`, points: [a, [a[0] - 4, a[1] - 15], [a[0] + 4, a[1] - 15], b] };
  const bend = (type === 'flight' ? .3 : .22) + bendOffset, side = dx >= 0 ? -1 : 1;
  const control = [(a[0] + b[0]) / 2 - dy * bend * side, (a[1] + b[1]) / 2 + dx * bend * side];
  const points = Array.from({ length: 33 }, (_, i) => { const t = i / 32; return [0, 1].map(j => (1 - t) ** 2 * a[j] + 2 * (1 - t) * t * control[j] + t ** 2 * b[j]); });
  return { path: `M${a}Q${control} ${b}`, points };
}

export function networkGeometry(network, railway = null) {
  const allNodes = [...network.nodes, ...(railway?.nodes || [])];
  const center = longitudeCenter(allNodes.map(node => node.coordinates[0]));
  const nodes = allNodes.map(node => ({ ...node, point: projectPoint(node.coordinates, center) }));
  const repeated = new Map();
  for (const route of network.routes) if (!route.aggregated) {
    if (!repeated.has(route.pairId)) repeated.set(route.pairId, []);
    repeated.get(route.pairId).push(route.id);
  }
  const routes = network.routes.map(route => {
    const from = projectPoint(route.from.coordinates, center), longitude = unwrapLongitude(route.to.coordinates[0], (from[0] / 1000 * 360 - 180)), to = [(longitude + 180) / 360 * 1000, (90 - route.to.coordinates[1]) / 360 * 1000];
    const group = repeated.get(route.pairId), index = group?.indexOf(route.id) || 0;
    const spread = group?.length > 1 ? (index / (group.length - 1) - .5) * Math.min(.36, (group.length - 1) * .06) : 0;
    return { ...route, ...routeArc(from, to, route.type, spread) };
  });
  let bounds = [700, 98, 885, 215];
  if (routes.length || nodes.length) {
    bounds = [Infinity, Infinity, -Infinity, -Infinity];
    const include = ([x, y]) => {
      bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y);
    };
    for (const node of nodes) include(node.point);
    // The SVG draws repeated copies of each arc. Fit their points in the
    // same longitude window as the markers, even when an arc crosses its seam.
    const frame = (center + 180) / 360 * 1000;
    for (const route of routes) for (const [x, y] of route.points) {
      const wrapped = x - 1000 * Math.floor((x - frame + 500) / 1000);
      include([wrapped, y]);
    }
  }
  if (railway?.trackPath) {
    const middle = (railway.bounds[0] + railway.bounds[2]) / 2;
    const shift = projectPoint([middle / 1000 * 360 - 180, 0], center)[0] - middle;
    const railBounds = railway.bounds.map((value, i) => value + (i % 2 === 0 ? shift : 0));
    bounds = routes.length ? [Math.min(bounds[0], railBounds[0]), Math.min(bounds[1], railBounds[1]), Math.max(bounds[2], railBounds[2]), Math.max(bounds[3], railBounds[3])] : railBounds;
  }
  return { center, nodes, routes, bounds, trackPath: railway?.trackPath || '', lineLabels: railway?.lineLabels || [] };
}
