import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPoint } from '../src/journey-map-model.js';
import { createRailMapContext, railMapAnnotations } from '../src/rail-map-context.js';
import { PROVINCE_LABELS } from '../src/data/map-reference.js';

const line = [[109.387, 24.309], [109.33, 24.1], [109.24, 23.75]].map(point => projectPoint(point));
const stops = [{ name: '柳州', point: line[0] }, { name: '来宾北', point: line.at(-1) }];
const fitted = (bounds, width, height) => ({ x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2, zoom: Math.min(1000 / (bounds[2] - bounds[0]) * .72, 1000 * height / width / (bounds[3] - bounds[1]) * .65) });
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

test('short railway view adds real nearby cities and province labels without duplicating station names', () => {
  const context = createRailMapContext([line]), view = fitted(context.bounds, 690, 340);
  const labels = railMapAnnotations(context, stops, view, 690, 340);
  assert.ok(labels.cities.some(city => city.name === '来宾' && city.alongRoute));
  assert.equal(labels.cities.some(city => city.name === '柳州' || city.name === '北京'), false);
  assert.ok(labels.provinces.some(province => province.name === '广西'));
  assert.deepEqual(labels.stops.filter(stop => stop.label).map(stop => stop.name), ['柳州', '来宾北']);
  assert.deepEqual(context.bounds, [Math.min(...line.map(point => point[0])), line[0][1], line[0][0], line.at(-1)[1]]);
});

test('regional view expands to the nearest provincial boundary and neighboring provinces', () => {
  const context = createRailMapContext([line]), view = fitted(context.regionalBounds, 690, 340);
  const labels = railMapAnnotations(context, stops, view, 690, 340);
  assert.ok(labels.provinces.some(province => province.name === '贵州'));
  assert.ok(labels.provinces.some(province => province.name === '广西'));
  assert.ok(labels.cities.length >= 5);
  assert.equal(Object.keys(PROVINCE_LABELS).length, 31);
});

test('labels stay inside desktop and mobile frames, avoid controls and each other, and update when panning', () => {
  const context = createRailMapContext([line]);
  for (const [width, height] of [[690, 340], [295, 290]]) {
    const viewport = fitted(context.regionalBounds, width, height), labels = railMapAnnotations(context, stops, viewport, width, height);
    const boxes = Object.values(labels).flat().map(row => row.label?.box).filter(Boolean);
    assert.ok(boxes.length >= 4);
    for (const [index, box] of boxes.entries()) {
      assert.ok(box[0] >= 7 && box[1] >= 7 && box[2] <= width - 7 && box[3] <= height - 7);
      assert.equal(overlaps(box, [width - 62, 8, width - 8, 184]), false);
      assert.equal(overlaps(box, [8, height - 33, 132, height - 4]), false);
      for (const other of boxes.slice(index + 1)) assert.equal(overlaps(box, other), false);
    }
    const moved = railMapAnnotations(context, stops, { ...viewport, x: projectPoint([120, 24])[0] }, width, height);
    assert.equal(moved.cities.some(city => labels.cities.some(previous => previous.name === city.name)), false);
  }
});
