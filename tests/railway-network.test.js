import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../src/model.js';
import { loadRailwayNetwork, uniqueRailEdges, railwayGeometry } from '../src/railway-network.js';
import { mountJourneyMap } from '../src/journey-map.js';

const record = extra => createRecord({ type: 'rail', service: 'D3759', origin: '柳州', destination: '来宾北', departureDate: '2024-01-01', ...extra });
const route = (segments = [[[109, 24], [109.5, 24], [110, 24]]]) => ({ service: 'D3759', origin: '柳州', destination: '来宾北', segments, stops: [{ name: '柳州', coordinates: segments[0][0] }, { name: '来宾北', coordinates: segments.at(-1).at(-1) }] });
const wait = async predicate => { for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Railway map did not settle'); };

test('track union removes repeats, reversed geometry and differently sampled partial overlaps without merging separate tracks', () => {
  const routes = [{ route: route() }, { route: route([[[110, 24], [109, 24]]]) }, { route: route([[[109.25, 24], [110.5, 24]]]) }, { route: route([[[109, 24.001], [110, 24.001]]]) }, { route: route([[[109.5, 23], [109.5, 25]]]) }];
  const edges = uniqueRailEdges(routes);
  assert.equal(edges.length, 3);
  assert.ok(edges.some(edge => JSON.stringify(edge) === JSON.stringify([[109, 24], [110.5, 24]])));
  assert.equal(uniqueRailEdges([{ route: route([[[109, 24], [109, 24]]]) }]).length, 0);
});

test('network loading groups identical queries, bounds parallel work and reports unmatched and failed tickets', async () => {
  const rows = [record({ id: 'a' }), record({ id: 'b', passenger: '另一位' }), ...Array.from({ length: 7 }, (_, i) => record({ service: 'D' + (100 + i) }))];
  let active = 0, maximum = 0, calls = 0; const progress = [];
  const loader = async r => { calls++; active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; if (r.service === 'D100') throw new Error('offline'); return r.service === 'D101' ? null : route(); };
  const data = await loadRailwayNetwork(rows, { loader, onProgress: p => progress.push(p.completed) });
  assert.equal(calls, 8); assert.equal(maximum, 4); assert.equal(data.failed.length, 1); assert.equal(data.unmatched.length, 1);
  assert.equal(data.routes.reduce((count, item) => count + item.records.length, 0), 7); assert.equal(progress.at(-1), 9);
  const geometry = railwayGeometry(data);
  assert.equal(geometry.edgeCount, 1); assert.equal(geometry.nodes.length, 2); assert.ok(geometry.bounds.every(Number.isFinite));
  assert.doesNotMatch(geometry.trackPath, /Q|NaN|Infinity/);
  assert.equal(geometry.nodes[0].trips.size, 7);
});

test('cancelling a railway load stops scheduling and discards late results', async () => {
  const controller = new AbortController(); let calls = 0, completed = 0;
  const data = await loadRailwayNetwork(Array.from({ length: 8 }, (_, i) => record({ service: 'D' + i })), { signal: controller.signal, concurrency: 1, loader: async () => { calls++; controller.abort(); return route(); }, onProgress: () => completed++ });
  assert.equal(calls, 1); assert.equal(completed, 0); assert.equal(data.routes.length, 0); assert.equal(data.cancelled, true);
});

test('the railway layer renders real shared tracks, filters years, retries and ignores late responses after disposal', async () => {
  const dom = new JSDOM('<div id="map"></div>'), previous = globalThis.window; globalThis.window = dom.window;
  const root = dom.window.document.querySelector('#map'), options = { layers: ['railway'], year: '2024' };
  let calls = 0;
  const rows = [record(), record({ id: 'later', departureDate: '2025-01-01' })];
  const cleanup = mountJourneyMap(root, rows, { icon: () => '', options, railLoader: async () => { if (++calls === 1) throw new Error('offline'); return {...route(),lineLabels:[{name:'示例铁路',coordinates:[109.5,24]}]}; } });
  try {
    await wait(() => root.querySelector('[data-railway-retry]'));
    assert.equal(root.querySelectorAll('.map-route').length, 0); assert.equal(root.querySelectorAll('.map-track').length, 0);
    assert.match(root.querySelector('.map-railway-status').textContent, /1加载失败/);
    root.querySelector('[data-railway-retry]').click();
    await wait(() => root.querySelector('.map-track'));
    assert.equal(calls, 2); assert.match(root.querySelector('.map-railway-status').textContent, /1 \/ 1/);
    assert.ok(root.querySelector('[data-rail-line-name="示例铁路"]'));
    const year = root.querySelector('[data-map-year]'); year.value = '2025'; year.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    await wait(() => calls === 3 && root.querySelector('.map-track'));
    assert.equal(root.querySelectorAll('.map-route').length, 0);
  } finally { cleanup(); dom.window.close(); globalThis.window = previous; }
  const second = new JSDOM('<div id="map"></div>'); globalThis.window = second.window;
  let resolve; const target = second.window.document.querySelector('#map');
  const dispose = mountJourneyMap(target, [record()], { icon: () => '', options: { layers: ['railway'] }, railLoader: () => new Promise(done => { resolve = done; }) });
  dispose(); const before = target.innerHTML; resolve(route()); await new Promise(done => setTimeout(done, 5));
  assert.equal(target.innerHTML, before); second.window.close(); globalThis.window = previous;
});

test('map layers overlay railways with bidirectional air routes by default and enforce both exclusive pairs', async () => {
  const dom=new JSDOM('<div id="map"></div>'),previous=globalThis.window;globalThis.window=dom.window;
  const root=dom.window.document.querySelector('#map'),options={};let calls=0;
  const air=extra=>createRecord({type:'flight',template:'air-boarding-pass',origin:'PEK',destination:'HND',service:'CA181',departureDate:'2024-01-01',...extra});
  const rows=[record({id:'train'}),record({id:'train-repeat'}),air({id:'air'}),air({id:'air-repeat'}),air({id:'return',origin:'HND',destination:'PEK'}),air({id:'next-year',departureDate:'2025-01-01'})];
  const before=JSON.stringify(rows),dispose=mountJourneyMap(root,rows,{icon:()=>'',options,railLoader:async()=>{calls++;return route();}});
  const count=()=>new Set([...root.querySelectorAll('.map-route')].map(path=>path.dataset.mapRoute)).size;
  const selected=()=>[...root.querySelectorAll('[data-map-layer][aria-pressed="true"]')].map(button=>button.dataset.mapLayer).sort();
  const click=layer=>root.querySelector(`[data-map-layer="${layer}"]`).click();
  try{
    await wait(()=>root.querySelector('.map-track'));
    assert.deepEqual(selected(),['airway','railway']);assert.equal(count(),1);assert.equal(calls,1);
    assert.equal(root.querySelector('.map-totals strong').textContent,'6');assert.equal(root.querySelectorAll('.map-legend span').length,2);
    click('flight');assert.deepEqual(selected(),['flight','railway']);assert.equal(count(),4);assert.ok(root.querySelector('.map-track'));assert.equal(calls,1);
    assert.equal(new Set([...root.querySelectorAll('.map-route')].map(path=>path.getAttribute('d'))).size,4);
    click('rail');assert.deepEqual(selected(),['flight','rail']);assert.equal(count(),6);assert.equal(root.querySelector('.map-track'),null);
    click('airway');assert.deepEqual(selected(),['airway','rail']);assert.equal(count(),3);
    click('railway');assert.deepEqual(selected(),['airway','railway']);assert.ok(root.querySelector('.map-track'));assert.equal(calls,1);
    const year=root.querySelector('[data-map-year]');year.value='2025';year.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    await wait(()=>root.querySelector('.map-railway-status')?.textContent.includes('0 / 0'));
    assert.equal(count(),1);assert.equal(root.querySelector('.map-totals strong').textContent,'1');assert.equal(root.querySelector('.map-track'),null);
    click('airway');click('railway');assert.deepEqual(selected(),[]);assert.equal(count(),0);assert.match(root.querySelector('.map-empty').textContent,/请选择/);
    assert.equal(root.querySelectorAll('.map-legend span').length,0);assert.equal(JSON.stringify(rows),before);
  }finally{dispose();dom.window.close();globalThis.window=previous;}
});
