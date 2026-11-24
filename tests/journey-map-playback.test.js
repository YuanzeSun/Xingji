import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../src/model.js';
import { mountJourneyMap } from '../src/journey-map.js';

test('map playback reveals trips in departure order for one year or the whole archive', async t => {
  const dom = new JSDOM('<div id="map"></div>');
  const { window } = dom, previous = globalThis.window;
  globalThis.window = window;
  const frames = new Map();
  let sequence = 0;
  window.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const frame = timestamp => {
    const scheduled = [...frames.values()];
    frames.clear();
    for (const callback of scheduled) callback(timestamp);
  };

  const rail = (id, changes) => createRecord({ id, service: 'G1', origin: '北京南', destination: '天津',
    departureDate: '2025-01-03', ...changes });
  const flight = (id, changes) => createRecord({ id, type: 'flight', template: 'air-boarding-pass', service: 'CA181',
    origin: '北京首都', destination: '东京羽田', departureDate: '2025-01-03', ...changes });
  const records = [rail('rail-late', { departureTime: '10:00' }), flight('return', { origin: '东京羽田', destination: '北京首都', departureTime: '12:00' }),
    rail('other-year', { departureDate: '2026-01-03' }), rail('rail-early', { departureTime: '08:00' }), flight('outbound', { departureTime: '07:00' }),
    rail('fallback', { service: 'G5', destination: '济南西', departureDate: '2025-01-04' }),
    flight('unknown-date', { origin: 'JFK', destination: 'LHR', departureDate: '' }), flight('unknown-shared', { departureDate: '' }),
    rail('unknown-rail', { service: 'G10', origin: '哈尔滨', destination: '大连', departureDate: '' })];
  const from = [116.3794, 39.8641], middle = [117.016, 39.373], to = [117.21, 39.137];
  const route = { segments: [[from, middle], [middle, to]], stops: [{ name: '北京南', coordinates: from }, { name: '武清', coordinates: middle }, { name: '天津', coordinates: to }],
    lineLabels: [{ name: '京津城际线', coordinates: middle }, { name: '京津城际线', coordinates: [116.77, 39.62] }] };
  const harbin = [126.63, 45.76], dalian = [121.63, 38.92];
  const undatedRoute = { segments: [[harbin, dalian]], stops: [{ name: '哈尔滨', coordinates: harbin }, { name: '大连', coordinates: dalian }] };
  const container = window.document.querySelector('#map');
  const options = { layers: ['airway'] };
  const cleanup = mountJourneyMap(container, records, { icon: () => '', options, railLoader: record => ({ G1: route, G10: undatedRoute })[record.service] || null });
  t.after(() => { cleanup(); dom.window.close(); globalThis.window = previous; });
  const select = selector => container.querySelector(selector);
  const playback = () => select('[data-map-playback-button]');
  const current = () => select('.map-playback-trip.is-current');
  const currentPath = () => current().querySelector('path');
  const lines = () => container.querySelectorAll('[data-rail-line-name="京津城际线"]').length;
  const year = value => {
    const field = select('[data-map-year]');
    field.value = value;
    field.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  assert.equal(playback().textContent, '播放全部行程');
  assert.equal(playback().disabled, false);
  select('[data-map-layer="railway"]').click();
  year('2025');
  assert.equal(playback().disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(playback().disabled, false);
  playback().click();
  assert.equal(select('.map-route'), null);
  assert.equal(lines(), 0);
  assert.equal(current().dataset.mapPlaybackTrip, 'outbound');
  assert.equal(currentPath().hasAttribute('d'), false);
  assert.match(select('[data-map-playback-status]').textContent, /1 \/ 5.*CA181/);
  frame(0); frame(2000);
  const half = currentPath().getAttribute('d').slice(1).split('L');
  assert.ok(half.length > 2 && half.length < 33);
  frame(3999);
  assert.equal(current().dataset.mapPlaybackTrip, 'outbound');
  frame(4000);
  assert.equal(current().dataset.mapPlaybackTrip, 'rail-early');
  const outbound = select('[data-map-playback-trip="outbound"] path').getAttribute('d').slice(1).split('L');
  assert.equal(outbound.length, 33);
  assert.deepEqual(half.slice(0, -1), outbound.slice(0, half.length - 1));
  assert.equal(current().querySelectorAll('path').length, 2);
  frame(5000);
  const earlyPartial = currentPath().getAttribute('d');
  assert.equal(current().querySelectorAll('path')[1].hasAttribute('d'), false);
  const stationReached = () => [...container.querySelectorAll('.map-nodes title')].some(title => title.textContent.includes('武清'));
  assert.equal(stationReached(), false);
  frame(8000);
  assert.equal(current().dataset.mapPlaybackTrip, 'rail-late');
  assert.equal(lines(), 1);
  assert.equal(stationReached(), true);
  frame(9000);
  assert.equal(currentPath().getAttribute('d'), earlyPartial);
  frame(12000);
  assert.equal(current().dataset.mapPlaybackTrip, 'return');
  assert.equal(select('[data-map-playback-trip="rail-late"]'), null);
  assert.equal(currentPath().hasAttribute('d'), false);
  frame(15999);
  assert.equal(currentPath().getAttribute('d').slice(1).split('L')[0], outbound.at(-1));
  frame(16000);
  assert.equal(current().dataset.mapPlaybackTrip, 'fallback');
  frame(20000);
  assert.ok(select('[data-map-playing]'));
  assert.equal(current(), null);
  frame(20450);
  assert.equal(frames.size, 0);
  assert.equal(playback().textContent, '重播年度行程');
  assert.ok(select('.map-route'));
  assert.equal(lines(), 1);

  playback().click();
  playback().click();
  assert.equal(frames.size, 0);
  assert.equal(current(), null);
  playback().click();
  year('all');
  assert.equal(frames.size, 0);
  assert.equal(current(), null);
  assert.equal(playback().textContent, '播放全部行程');
  assert.equal(playback().disabled, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(playback().disabled, false);
  const allRoutesView = select('.journey-map-canvas').getAttribute('viewBox');
  playback().click();
  assert.notEqual(select('.journey-map-canvas').getAttribute('viewBox'), allRoutesView);
  for (const [index, id] of ['outbound', 'rail-early', 'rail-late', 'return', 'fallback', 'other-year'].entries()) {
    frame(24000 + index * 4000);
    assert.equal(current().dataset.mapPlaybackTrip, id);
  }
  assert.match(select('[data-map-playback-status]').textContent, /6 \/ 6 · 2026-01-03/);
  frame(48000);
  frame(48450);
  assert.equal(playback().textContent, '重播全部行程');
  assert.equal(select('[data-map-playback-status]').textContent, '已播放 6 程');
  assert.equal(select('.journey-map-canvas').getAttribute('viewBox'), allRoutesView);
  assert.equal(frames.size, 0);
  year('unknown');
  assert.equal(playback(), null);
});
