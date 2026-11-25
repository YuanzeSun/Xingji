import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../src/model.js';
import { savedRailwayNetwork, uniqueRailEdges, railwayGeometry } from '../src/railway-network.js';
import { mountJourneyMap } from '../src/journey-map.js';

const record = extra => createRecord({ type: 'rail', service: 'D3759', origin: '柳州', destination: '来宾北', departureDate: '2024-01-01', ...extra });
const route = (segments = [[[109, 24], [109.5, 24], [110, 24]]]) => ({ service: 'D3759', origin: '柳州', destination: '来宾北', segments, stops: [{ name: '柳州', coordinates: segments[0][0] }, { name: '来宾北', coordinates: segments.at(-1).at(-1) }] });
const saved = (extra, track) => record({ railRoute: { ...route(), queriedAt: '2026-11-25T00:00:00Z', ...track }, ...extra });

test('track union removes repeats, reversed geometry and differently sampled partial overlaps without merging separate tracks', () => {
  const routes = [{ route: route() }, { route: route([[[110, 24], [109, 24]]]) }, { route: route([[[109.25, 24], [110.5, 24]]]) }, { route: route([[[109, 24.001], [110, 24.001]]]) }, { route: route([[[109.5, 23], [109.5, 25]]]) }];
  const edges = uniqueRailEdges(routes);
  assert.equal(edges.length, 3);
  assert.ok(edges.some(edge => JSON.stringify(edge) === JSON.stringify([[109, 24], [110.5, 24]])));
  assert.equal(uniqueRailEdges([{ route: route([[[109, 24], [109, 24]]]) }]).length, 0);
});

test('the saved railway network groups matching tickets and reports missing and invalid tracks', () => {
  const first = saved({ id: 'a' }), second = saved({ id: 'b', passenger: '另一位' });
  const missing = record({ id: 'missing' });
  const invalid = { ...first, id: 'broken', service: 'D3760',
    railRoute: { ...first.railRoute, service: 'D3760', segments: [] } };
  const data = savedRailwayNetwork([first, second, missing, invalid]);
  assert.deepEqual(data.unmatched, [missing]);
  assert.deepEqual(data.failed, [invalid]);
  assert.equal(data.routes.length, 1);
  assert.deepEqual(data.routes[0].records, [first, second]);
  const geometry = railwayGeometry(data);
  assert.equal(geometry.nodes.length, 2);
  assert.ok(geometry.bounds.every(Number.isFinite));
  assert.doesNotMatch(geometry.trackPath, /Q|NaN|Infinity/);
  assert.equal(geometry.nodes[0].trips.size, 2);
});

test('the railway layer renders saved tracks and labels for the selected year', () => {
  const dom = new JSDOM('<div id="map"></div>'), previous = globalThis.window;
  globalThis.window = dom.window;
  const root = dom.window.document.querySelector('#map'), options = { layers: ['railway'], year: '2024' };
  const rows = [record(), saved({ id: 'later', departureDate: '2025-01-01' }, { lineLabels: [{ name: '示例铁路', coordinates: [109.5, 24] }] })];
  const cleanup = mountJourneyMap(root, rows, { icon: () => '', options });
  try {
    assert.equal(root.querySelectorAll('.map-route').length, 0);
    assert.equal(root.querySelectorAll('.map-track').length, 0);
    assert.match(root.querySelector('.map-railway-status').textContent, /1未匹配/);
    const year = root.querySelector('[data-map-year]');
    year.value = '2025';
    year.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.ok(root.querySelector('.map-track'));
    assert.match(root.querySelector('.map-railway-status').textContent, /1 \/ 1/);
    assert.ok(root.querySelector('[data-rail-line-name="示例铁路"]'));
    assert.equal(root.querySelectorAll('.map-route').length, 0);
  } finally {
    cleanup();
    dom.window.close();
    globalThis.window = previous;
  }
});

test('map layers overlay railways with bidirectional air routes by default and enforce both exclusive pairs', () => {
  const dom=new JSDOM('<div id="map"></div>'),previous=globalThis.window;globalThis.window=dom.window;
  const root=dom.window.document.querySelector('#map'),options={};
  const air=extra=>createRecord({type:'flight',template:'air-boarding-pass',origin:'PEK',destination:'HND',service:'CA181',departureDate:'2024-01-01',...extra});
  const rows=[saved({id:'train'}),saved({id:'train-repeat'}),air({id:'air'}),air({id:'air-repeat'}),air({id:'return',origin:'HND',destination:'PEK'}),air({id:'next-year',departureDate:'2025-01-01'})];
  const before=JSON.stringify(rows),dispose=mountJourneyMap(root,rows,{icon:()=>'',options});
  const count=()=>new Set([...root.querySelectorAll('.map-route')].map(path=>path.dataset.mapRoute)).size;
  const selected=()=>[...root.querySelectorAll('[data-map-layer][aria-pressed="true"]')].map(button=>button.dataset.mapLayer).sort();
  const click=layer=>root.querySelector(`[data-map-layer="${layer}"]`).click();
  try{
    assert.ok(root.querySelector('.map-track'));
    assert.deepEqual(selected(),['airway','railway']);assert.equal(count(),1);
    assert.equal(root.querySelector('.map-totals strong').textContent,'6');assert.equal(root.querySelectorAll('.map-legend span').length,2);
    click('flight');assert.deepEqual(selected(),['flight','railway']);assert.equal(count(),4);assert.ok(root.querySelector('.map-track'));
    assert.equal(new Set([...root.querySelectorAll('.map-route')].map(path=>path.getAttribute('d'))).size,4);
    click('rail');assert.deepEqual(selected(),['flight','rail']);assert.equal(count(),6);assert.equal(root.querySelector('.map-track'),null);
    click('airway');assert.deepEqual(selected(),['airway','rail']);assert.equal(count(),3);
    click('railway');assert.deepEqual(selected(),['airway','railway']);assert.ok(root.querySelector('.map-track'));
    const year=root.querySelector('[data-map-year]');year.value='2025';year.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    assert.match(root.querySelector('.map-railway-status').textContent, /0 \/ 0/);
    assert.equal(count(),1);assert.equal(root.querySelector('.map-totals strong').textContent,'1');assert.equal(root.querySelector('.map-track'),null);
    click('airway');click('railway');assert.deepEqual(selected(),[]);assert.equal(count(),0);assert.match(root.querySelector('.map-empty').textContent,/请选择/);
    assert.equal(root.querySelectorAll('.map-legend span').length,0);assert.equal(JSON.stringify(rows),before);
  }finally{dispose();dom.window.close();globalThis.window=previous;}
});
