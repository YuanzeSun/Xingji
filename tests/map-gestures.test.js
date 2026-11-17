import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountJourneyMap } from '../src/journey-map.js';

test('pinching zooms more responsively, follows the finger midpoint and continues dragging after a finger lifts', () => {
  const dom = new JSDOM('<div id="map"></div>');
  const previous = globalThis.window; globalThis.window = dom.window;
  const container = dom.window.document.querySelector('#map'), options = { viewport: { x: 650, y: 230, zoom: 3 }, userMoved: true };
  const cleanup = mountJourneyMap(container, [], { icon: () => '', options });
  try {
    assert.ok(container.querySelector('.map-countries use'));
    const svg = container.querySelector('svg');
    const pointer = (type, id, x, y) => { const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }); Object.defineProperty(event, 'pointerId', { value: id }); svg.dispatchEvent(event); };
    pointer('pointerdown', 1, 400, 310); pointer('pointerdown', 2, 600, 310);
    pointer('pointermove', 2, 620, 310);
    assert.ok(options.viewport.zoom > 3.45 && options.viewport.zoom < 3.6);
    assert.ok(options.viewport.x < 650, 'the map follows the moving pinch midpoint');
    pointer('pointerup', 2, 620, 310);
    const x = options.viewport.x;
    pointer('pointermove', 1, 415, 310); assert.ok(options.viewport.x < x);
    pointer('pointerup', 1, 415, 310);
    const zoom = options.viewport.zoom;
    svg.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: 500, clientY: 310, cancelable: true }));
    assert.ok(options.viewport.zoom / zoom > 1.075);
    svg.dispatchEvent(new dom.window.WheelEvent('wheel', { deltaY: 10, ctrlKey: true, clientX: 500, clientY: 310, cancelable: true }));
    assert.ok(Math.abs(options.viewport.zoom - zoom) < .0001);
  } finally { cleanup(); dom.window.close(); globalThis.window = previous; }
});
