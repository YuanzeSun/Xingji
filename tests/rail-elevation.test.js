import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { sampleRailElevation } from '../src/rail-elevation.js';
import { railMapPoint, railWgs84Point } from '../src/rail-projection.js';
import { mountRailRoute } from '../src/rail-route-map.js';

test('terrain sampling stays within one request, uses WGS84 and does not join gaps in the recorded route', () => {
  const lines = [[[100, 35], [104, 35]], [[108, 35], [114, 35]]];
  const projected = lines.map(line => line.map(railMapPoint));
  const { samples, total, pick, atMapDistance } = sampleRailElevation(lines, projected);
  assert.equal(samples.length, 100);
  assert.deepEqual(samples[0].coordinate, railWgs84Point(lines[0][0]));
  assert.deepEqual(samples.at(-1).coordinate, railWgs84Point(lines[1][1]));
  assert.deepEqual([...new Set(samples.map(sample => sample.group))], [0, 1]);
  assert.ok(total > 900 && total < 920);
  assert.equal(pick(projected[0][0], .2), 0);
  assert.equal(pick(projected[1][1], .2), 99);
  assert.equal(pick(railMapPoint([106, 35]), .2), null);
  const [[start, end], [secondStart, secondEnd]] = projected;
  const mapLength = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const secondMidpoint = atMapDistance(mapLength(start, end) + mapLength(secondStart, secondEnd) / 2);
  assert.equal(secondMidpoint.group, 1);
  assert.ok(Math.abs(secondMidpoint.mapPoint[0] - (secondStart[0] + secondEnd[0]) / 2) < 1e-9);
  assert.deepEqual(atMapDistance(Infinity).mapPoint, secondEnd);
});

test('the rail detail queries elevation on demand and synchronizes the map with the profile', async () => {
  const dom = new JSDOM('<section hidden></section>', { pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLCanvasElement.prototype.getContext = () => null;
  const frames = new Map();
  let nextFrame = 0;
  window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  window.cancelAnimationFrame = id => frames.delete(id);
  function advance(timestamp) {
    for (const [id, callback] of [...frames]) {
      if (frames.delete(id)) callback(timestamp);
    }
  }
  const root = window.document.querySelector('section');
  const segments = [[[116.38, 39.86], [116.52, 39.79], [116.72, 39.66]]];
  const record = { type: 'rail', service: 'G1', origin: '北京南', destination: '天津南', railRoute: {
    service: 'G1', origin: '北京南', destination: '天津南', queriedAt: '2026-11-27T00:00:00Z', segments,
    stops: [{ name: '北京南', coordinates: segments[0][0] }, { name: '天津南', coordinates: segments[0][2] }]
  } };
  const requests = [], previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push([new URL(url), options]);
    if (requests.length === 1) return new Response(null, { status: 503 });
    const count = requests.at(-1)[0].searchParams.get('latitude').split(',').length;
    return Response.json({ elevation: Array.from({ length: count }, (_, i) => 40 + i) });
  };
  const unmount = mountRailRoute(root, record);
  async function waitFor(selector) {
    for (let i = 0; i < 20; i++) {
      const element = root.querySelector(selector);
      if (element) return element;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('Missing ' + selector);
  }
  try {
    assert.equal(requests.length, 0);
    const details = root.querySelector('[data-rail-elevation]');
    details.open = true;
    (await waitFor('[data-retry-rail-elevation]')).click();
    const slider = await waitFor('[data-rail-elevation] input');
    const marker = root.querySelector('[data-rail-elevation-marker]');
    assert.equal(requests.length, 2);
    assert.deepEqual([...requests[1][0].searchParams.keys()], ['latitude', 'longitude']);
    assert.equal(requests[1][1].credentials, 'omit');
    assert.equal(marker.hasAttribute('data-active'), true);
    const start = marker.getAttribute('transform');
    slider.value = slider.max;
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.notEqual(marker.getAttribute('transform'), start);
    assert.match(slider.getAttribute('aria-valuetext'), /公里 · \d+ 米$/);

    const map = root.querySelector('.rail-route-frame svg');
    const [left, top, width, height] = map.getAttribute('viewBox').split(' ').map(Number);
    const [x, y] = railMapPoint(segments[0][0]);
    const point = { clientX: (x - left) / width * 640, clientY: (y - top) / height * 340 };
    for (const type of ['pointerdown', 'pointerup']) {
      map.dispatchEvent(new window.PointerEvent(type, { ...point, pointerId: 1, pointerType: 'mouse', bubbles: true }));
    }
    assert.equal(slider.value, '0');
    assert.equal(marker.getAttribute('transform'), start);
    details.open = false;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(marker.hasAttribute('data-active'), false);
    details.open = true;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(marker.hasAttribute('data-active'), true);
    assert.equal(requests.length, 2);

    details.open = false;
    await new Promise(resolve => setTimeout(resolve, 0));
    const play = root.querySelector('[data-rail-play-route]');
    play.click();
    advance(0);
    advance(1500);
    assert.equal(marker.hasAttribute('data-active'), false);
    assert.equal(requests.length, 2);
    details.open = true;
    await new Promise(resolve => setTimeout(resolve, 0));
    const initialProgress = Number(slider.value);
    const cursor = root.querySelector('[data-elevation-cursor]');
    const initialCursor = cursor.getAttribute('transform');
    const initialMarker = marker.getAttribute('transform');
    assert.ok(initialProgress > 0 && initialProgress < Number(slider.max));
    slider.value = '0';
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(Number(slider.value), initialProgress);
    advance(1505);
    assert.equal(Number(slider.value), initialProgress);
    assert.notEqual(cursor.getAttribute('transform'), initialCursor);
    assert.notEqual(marker.getAttribute('transform'), initialMarker);
    advance(6000);
    assert.equal(slider.value, slider.max);
    assert.notEqual(marker.getAttribute('transform'), start);
    play.click();
    assert.equal(slider.value, '0');
    assert.equal(marker.getAttribute('transform'), start);
  } finally {
    unmount();
    globalThis.fetch = previousFetch;
    window.close();
  }
});
