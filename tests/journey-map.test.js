import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { mapPoint, journeyNetwork, routeArc, longitudeCenter, networkGeometry } from '../src/journey-map-model.js';
import { LAND_PATH, PROVINCE_PATH, COUNTRY_PATH, MAP_REFERENCE } from '../src/data/map-reference.js';
import { railwayGeometry } from '../src/railway-network.js';

const rail = (extra = {}) => createRecord({ id: 'rail', origin: '清河', destination: '上海虹桥', departureDate: '2025-08-16', service: 'G103', ...extra });
const flight = (extra = {}) => createRecord({ id: 'flight', type: 'flight', template: 'air-boarding-pass', origin: '首都国际机场', destination: '东京羽田', departureDate: '2026-01-01', service: 'CA181', ...extra });

test('map endpoints use verified cities and airport identities; ambiguous or conflicting places stay unplotted', () => {
  assert.equal(mapPoint(rail(), 'origin').id, 'city:北京');
  assert.deepEqual(mapPoint(rail({ origin: '北京南' }), 'origin').coordinates, mapPoint(rail(), 'origin').coordinates);
  assert.equal(mapPoint(flight(), 'origin').id, 'airport:PEK');
  assert.notDeepEqual(mapPoint(flight(), 'origin').coordinates, mapPoint(flight({ origin: '北京大兴' }), 'origin').coordinates);
  assert.equal(mapPoint(flight({ originCode: 'SHA' }), 'origin'), null);
  assert.equal(mapPoint(rail({ origin: '北京不存在站' }), 'origin'), null);
  assert.equal(mapPoint(rail({ origin: '历史车站', originCity: '无法确认的城市' }), 'origin'), null);
  const xingan = mapPoint(rail({ origin: '乌兰浩特' }), 'origin');
  assert.equal(xingan.id, 'city:兴安'); assert.ok(xingan.coordinates[0] > 120 && xingan.coordinates[1] > 45, '兴安 must not be confused with the namesake county in Guangxi');
});

test('route aggregation combines return journeys while retaining transport, airport and year distinctions', () => {
  const records = [rail(), rail({ id: 'return', origin: '上海虹桥', destination: '北京南', departureDate: '2026-02-01' }), flight({ destination: '上海虹桥' }), flight({ id: 'other-airport', origin: '北京大兴', destination: '上海虹桥' }), rail({ id: 'deleted', deleted: true }), rail({ id: 'unknown', origin: '未知地点', departureDate: '' })];
  const before = JSON.stringify(records), all = journeyNetwork(records);
  assert.equal(all.mapped, 4); assert.equal(all.routes.length, 3); assert.equal(all.unresolved.length, 1);
  assert.equal(all.routes.find(route => route.type === 'rail').records.length, 2);
  assert.equal(journeyNetwork(records, { type: 'rail' }).mapped, 2);
  assert.equal(journeyNetwork(records, { year: '2025' }).mapped, 1);
  assert.equal(journeyNetwork(records, { year: 'unknown' }).unresolved.length, 1);
  assert.equal(JSON.stringify(records), before, 'viewing the map must not change stored tickets');
});

test('visible route arcs preserve endpoints and use the short crossing of the date line', () => {
  const a = [100, 30], b = [180, 32], line = routeArc(a, b).points;
  assert.deepEqual(line[0], a); assert.deepEqual(line.at(-1), b);
  assert.ok(routeArc(a, b).path.includes('Q'));
  assert.ok(line[16][1] < Math.min(a[1], b[1]), 'the middle of a route must visibly curve away from a straight line');
  assert.ok(routeArc(a, b, 'rail').path.includes('Q'));
  assert.ok(Math.abs(Math.abs(longitudeCenter([179, -179])) - 180) < .001);
  for (const points of [line, routeArc([0, 0], [500, 0]).points, routeArc([0, 0], [0, 500]).points, routeArc(a, a).points]) assert.ok(points.flat().every(Number.isFinite));
  const pacific = journeyNetwork([flight({ origin: '东京羽田', destination: '旧金山', destinationCode: 'SFO' })]);
  const geometry = networkGeometry(pacific);
  assert.equal(geometry.routes.length, 1);
  assert.ok(geometry.bounds[2] - geometry.bounds[0] < 400, 'Pacific routes must not span the long way around the world');
  assert.ok(!/NaN|Infinity/.test(geometry.routes[0].path));
  assert.ok(PROVINCE_PATH.startsWith('M')); assert.ok(MAP_REFERENCE.provincialBoundaries >= 60);
  assert.equal((LAND_PATH.match(/[ML]/g) || []).length, MAP_REFERENCE.landVertices);
  assert.equal((PROVINCE_PATH.match(/[ML]/g) || []).length, MAP_REFERENCE.provinceVertices);
  assert.ok(MAP_REFERENCE.countryBoundaries >= 300);
  assert.equal((COUNTRY_PATH.match(/[ML]/g) || []).length, MAP_REFERENCE.countryVertices);
});

test('same-city and empty maps remain finite and retain their tickets', () => {
  const same = journeyNetwork([rail({ origin: '北京南', destination: '清河' })]);
  assert.equal(same.mapped, 1); assert.equal(same.nodes.length, 1); assert.equal(same.routes.length, 1);
  assert.ok(!/NaN|Infinity/.test(networkGeometry(same).routes[0].path));
  assert.deepEqual(networkGeometry(journeyNetwork([])).routes, []);
  assert.ok(networkGeometry(journeyNetwork([])).bounds.every(Number.isFinite));
});

test('individual journeys retain repeated and return flights while air routes merge both directions by airport pair', () => {
  const records = [flight(), flight({id:'repeat'}), flight({id:'return',origin:'东京羽田',destination:'北京首都'}), flight({id:'other',origin:'北京大兴'}), flight({id:'open',flightStatus:'open'})];
  const trips = journeyNetwork(records, {type:'flight',deduplicate:false}), routes = journeyNetwork(records,{type:'flight'});
  assert.equal(trips.mapped,4);assert.equal(trips.routes.length,4);assert.equal(routes.routes.length,2);
  assert.equal(routes.routes.find(route=>route.records.length===3).records.length,3);
  assert.equal(trips.routes.find(route=>route.records[0].id==='return').from.code,'HND');
  const geometry = networkGeometry(trips);
  assert.equal(new Set(geometry.routes.filter(route=>route.records[0].id!=='other').map(route=>route.path)).size,3);
  for(const route of geometry.routes){
    const points=route.points;
    assert.ok(points.flat().every(Number.isFinite));
    assert.deepEqual(points[0],geometry.nodes.find(node=>node.id===route.from.id).point);
  }
});

test('airport arcs and saved railway tracks share a date-line-safe viewport and keep both sets of endpoints', () => {
  const railway=railwayGeometry({routes:[{records:[rail()],route:{segments:[[[116,39],[117,38]]],stops:[{name:'起点',coordinates:[116,39]},{name:'终点',coordinates:[117,38]}]}}]});
  const network=journeyNetwork([flight({origin:'SFO',destination:'JFK'})]);
  const geometry=networkGeometry(network,railway);
  assert.equal(geometry.nodes.length,4);assert.equal(geometry.routes.length,1);assert.equal(geometry.trackPath,railway.trackPath);
  assert.ok(geometry.center<0);assert.ok(geometry.bounds[0]<0);assert.ok(geometry.bounds[2]-geometry.bounds[0]<550);
  for(const node of geometry.nodes)assert.ok(node.point[0]>=geometry.bounds[0]-.001 && node.point[0]<=geometry.bounds[2]+.001);
  assert.ok(geometry.bounds.every(Number.isFinite));
});
