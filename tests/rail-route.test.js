import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, archive, readArchive } from '../src/model.js';
import { normalizeRailRoute } from '../src/rail-route-snapshot.js';
import { selectRailRoute, fetchRailRoute } from '../src/rail-route.js';
import { railMapPoint } from '../src/rail-projection.js';

const record = extra => createRecord({ type: 'rail', service: 'D3759', origin: '柳州', destination: '来宾北', departureDate: '2023-05-26', ...extra });
const payload = () => ({ success: true, data: {
  stations: [{ 柳州: [109.388, 24.307] }, { 来宾北: [109.244, 23.751] }, { 平南南: [110.432, 23.418] }],
  train: {
    '来宾北-平南南': { index: 2, line: [[109.244, 23.751], [109.7, 23.6], [110.432, 23.418]] },
    '柳州-来宾北': { index: 1, line: [[109.388, 24.307], [109.3, 24.25], [109.35, 24.1], [109.244, 23.751]] }
  }
} });

test('historical ticket takes only its ordered stop-to-stop track geometry from the current train', () => {
  const route = selectRailRoute(record(), payload());
  assert.equal(route.segments.length, 1);
  assert.deepEqual(route.segments[0], payload().data.train['柳州-来宾北'].line);
  assert.deepEqual(route.stops.map(stop => stop.name), ['柳州', '来宾北']);
  assert.equal(selectRailRoute(record({ origin: '柳州站' }), payload()).origin, '柳州');
  const through = selectRailRoute(record({ destination: '平南南' }), payload());
  assert.equal(through.segments.length, 2);
  assert.deepEqual(through.stops.map(stop => stop.name), ['柳州', '来宾北', '平南南']);
  const backwardsGeometry = payload(); backwardsGeometry.data.train['柳州-来宾北'].line.reverse();
  assert.deepEqual(selectRailRoute(record(), backwardsGeometry).segments, route.segments);
});

test('missing or reversed stops, same-city substitutions and broken or malformed tracks stay hidden', () => {
  for (const extra of [{ origin: '柳州西' }, { destination: '来宾' }, { origin: '来宾北', destination: '柳州' }, { type: 'flight', template: 'air-boarding-pass' }]) assert.equal(selectRailRoute(record(extra), payload()), null);
  const disconnected = payload(); disconnected.data.train['柳州-来宾北'].line[0] = [120, 40];
  assert.equal(selectRailRoute(record(), disconnected), null);
  const missing = payload(); delete missing.data.train['柳州-来宾北'];
  assert.equal(selectRailRoute(record(), missing), null);
  const gap = payload(); gap.data.train['来宾北-平南南'].line[0] = [110, 25];
  assert.equal(selectRailRoute(record({ destination: '平南南' }), gap), null);
  const corrupt = payload(); corrupt.data.train['柳州-来宾北'].line[1][0] = NaN;
  assert.equal(selectRailRoute(record(), corrupt), null);
  assert.equal(selectRailRoute(record(), { success: false }), null);
});

test('an explicit route query sends only the train number and accepts cancellation', async () => {
  const requests = [], fetcher = async function(url, options) { assert.equal(this, globalThis); requests.push({ url, options }); return Response.json(payload()); };
  const controller = new AbortController();
  const route = await fetchRailRoute(record({ passenger: 'PRIVATE' }), { fetcher, signal: controller.signal });
  assert.equal(route.segments.length, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://rg-api.zenglingkun.cn/api/v2/mapLine?train=D3759');
  assert.equal(requests[0].options.credentials, 'omit'); assert.equal(requests[0].options.referrerPolicy, 'no-referrer');
  controller.abort();
  assert.equal(requests[0].options.signal.aborted, true);
  assert.equal(await fetchRailRoute(record({ service: 'invalid&token=private' }), { fetcher }), null);
  assert.equal(requests.length, 1);
});

test('GCJ-02 track coordinates align with the WGS84 country basemap', () => {
  const [x, y] = railMapPoint([116.41024449916938, 39.91640428150164]);
  assert.ok(Math.abs(x - (116.404 + 180) / 360 * 1000) < .0001);
  assert.ok(Math.abs(y - (90 - 39.915) / 360 * 1000) < .0001);
});

test('saved route geometry survives JSON and is discarded when its train or endpoints change', () => {
  const route=selectRailRoute(record(),payload()),saved=record({railRoute:route});
  assert.deepEqual(readArchive(archive([saved]))[0].railRoute,route);
  assert.equal(record({...saved,service:'D3758'}).railRoute,'');
  assert.equal(record({...saved,destination:'平南南',destinationCode:''}).railRoute,'');
  assert.equal(record({...saved,type:'flight',template:'air-boarding-pass'}).railRoute,'');
  const invalid=structuredClone(route);invalid.segments[0][0][0]=Infinity;
  assert.throws(()=>normalizeRailRoute(invalid),/坐标/);
  invalid.segments=Array.from({length:1001},()=>[[109,24],[110,25]]);
  assert.throws(()=>normalizeRailRoute(invalid),/坐标/);
  assert.equal(Object.hasOwn(normalizeRailRoute({...route,passenger:'not route data'}),'passenger'),false);
});
