import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRecord,archive,readArchive} from '../src/model.js';
import {selectRailRoute,loadRailRoute} from '../src/rail-route.js';
import {normalizeRailRoute,railRouteNeedsSave} from '../src/rail-route-snapshot.js';
import {loadRailwayNetwork,uniqueRailEdges} from '../src/railway-network.js';
import {mountRailRoute} from '../src/rail-route-map.js';

const record=extra=>createRecord({service:'G21',origin:'济南西',destination:'南京南',departureDate:'2026-11-17',...extra});
const payload=()=>({success:true,data:{stations:[{'北京南':[116.378,39.865]},{'济南西':[116.891,36.669]},{'南京南':[118.797,31.969]},{'上海虹桥':[121.327,31.200]}],train:{'北京南-济南西':{index:0,line:[[116.378,39.865],[116.891,36.669]]},'济南西-南京南':{index:1,line:[[116.891,36.669],[118.797,31.969]]},'南京南-上海虹桥':{index:2,line:[[118.797,31.969],[121.327,31.200]]}}}});
const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(done=>setTimeout(done,5));}assert.fail('Full railway map did not settle');};

test('full route context persists independently of the traveled segments and stays outside the journey network',async()=>{
  const route=selectRailRoute(record(),payload());
  assert.deepEqual(route.stops.map(stop=>stop.name),['济南西','南京南']);assert.deepEqual(route.fullRoute.stops.map(stop=>stop.name),['北京南','济南西','南京南','上海虹桥']);
  const saved=record({railRoute:route});
  assert.deepEqual(readArchive(archive([saved]))[0].railRoute.fullRoute,route.fullRoute);
  const network=await loadRailwayNetwork([saved]);assert.equal(uniqueRailEdges(network.routes).length,1);
  const invalid=structuredClone(route);invalid.fullRoute.segments.splice(1,1);assert.throws(()=>normalizeRailRoute(invalid),/乘坐区间/);
  const partial=structuredClone(route);delete partial.fullRoute;assert.equal(railRouteNeedsSave(record({railRoute:partial}),route),true);assert.equal(railRouteNeedsSave(saved,partial),false);
});

test('only an explicit route refresh queries the API; the stored complete route loads offline',async()=>{
  const saved=record({railRoute:selectRailRoute(record(),payload())});let calls=0;
  const fetcher=async()=>{calls++;return Response.json(payload());};
  const refreshed=await loadRailRoute(saved,{fetcher,refresh:true});assert.equal(calls,1);assert.ok(refreshed.fullRoute);
  const offline=()=>{throw Error('offline');};
  assert.deepEqual(await loadRailRoute(record({railRoute:refreshed}),{fetcher:offline}),refreshed);
  await assert.rejects(loadRailRoute(saved,{fetcher:offline,refresh:true}),/offline/);
});

test('viewing a missing route does not query the provider or attempt to repair saved data',async()=>{
  const previous=globalThis.fetch,dom=new JSDOM('<section id="route"></section>');let calls=0;
  globalThis.fetch=()=>{calls++;throw Error('No lookup on viewing');};
  try{
    const data=await loadRailwayNetwork([record()]);assert.equal(data.routes.length,0);assert.equal(data.unmatched.length,1);
    const container=dom.window.document.querySelector('#route'),cleanup=mountRailRoute(container,record());assert.equal(container.innerHTML,'');cleanup();assert.equal(calls,0);
  }finally{globalThis.fetch=previous;dom.window.close();}
});

test('G21 detail draws the stored complete route and identifies traveled and other sections without querying',async()=>{
  const dom=new JSDOM('<section id="route"></section>'),previous={window:globalThis.window,fetch:globalThis.fetch,requestAnimationFrame:globalThis.requestAnimationFrame,cancelAnimationFrame:globalThis.cancelAnimationFrame};
  globalThis.window=dom.window;globalThis.fetch=()=>{throw Error('Saved full context must stay offline');};
  globalThis.requestAnimationFrame=fn=>setTimeout(fn,0);globalThis.cancelAnimationFrame=id=>clearTimeout(id);
  const container=dom.window.document.querySelector('#route'),route=selectRailRoute(record(),payload());
  route.lineLabels=[{name:'示例客专',coordinates:[117.844,34.319]}];
  const cleanup=mountRailRoute(container,record({railRoute:route}));
  try{
    await wait(()=>container.querySelector('[data-rail-stops] title'));
    assert.equal(container.querySelectorAll('.rail-full-track path').length,3);assert.equal(container.querySelectorAll('.rail-track path').length,1);
    assert.deepEqual([...container.querySelectorAll('[data-rail-segment="outside"] title')].map(node=>node.textContent).sort(),['上海虹桥','北京南'].sort());
    assert.deepEqual([...container.querySelectorAll('[data-rail-segment="selected"] title')].map(node=>node.textContent).sort(),['南京南','济南西'].sort());
    assert.match(container.querySelector('.rail-route-caption').textContent,/北京南 → 上海虹桥.*乘坐：济南西 → 南京南/);
    assert.ok(container.querySelector('[data-rail-line-name="示例客专"]'));
  }finally{cleanup();dom.window.close();for(const [key,value] of Object.entries(previous))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
});

test('ticket route playback follows track distance, keeps its progress on zoom, and can be replayed', () => {
  const dom = new JSDOM('<section id="route"></section>');
  const { window } = dom;
  const frames = new Map();
  let nextFrame = 0;
  window.matchMedia = () => ({ matches: true });
  window.requestAnimationFrame = callback => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  };
  window.cancelAnimationFrame = id => frames.delete(id);
  function advance(timestamp) {
    for (const [id, callback] of [...frames]) {
      if (frames.delete(id)) callback(timestamp);
    }
  }

  const data = payload();
  data.data.stations.splice(2, 0, { 徐州东: [117.2, 35.8] });
  data.data.train['南京南-上海虹桥'].index = 3;
  delete data.data.train['济南西-南京南'];
  data.data.train['济南西-徐州东'] = { index: 1, line: [[116.891, 36.669], [117.2, 35.8]] };
  data.data.train['徐州东-南京南'] = { index: 2, line: [[117.2, 35.8], [118.797, 31.969]] };
  const route = selectRailRoute(record(), data);
  const container = dom.window.document.querySelector('#route');
  const cleanup = mountRailRoute(container, record({ railRoute: route }));
  try {
    const svg = container.querySelector('svg');
    const button = container.querySelector('[data-rail-play-route]');
    const status = container.querySelector('[data-rail-play-status]');
    const [first, second] = svg.querySelectorAll('.rail-playback-track path');
    const litStops = () => [...svg.querySelectorAll('[data-rail-stop-lit] title')].map(node => node.textContent).sort();
    advance(0);
    assert.equal(button.textContent, '播放行程');
    assert.equal(svg.hasAttribute('data-rail-playback'), false);
    assert.deepEqual(litStops(), []);

    button.click();
    advance(10);
    assert.deepEqual(litStops(), ['济南西']);
    const viewBox = svg.getAttribute('viewBox');
    container.querySelector('[data-route-zoom="in"]').click();
    advance(3010);
    assert.notEqual(svg.getAttribute('viewBox'), viewBox);
    assert.deepEqual(litStops(), ['徐州东', '济南西']);
    assert.equal(first.style.strokeDashoffset, '0');
    assert.ok(Number(second.style.strokeDashoffset) > 0.5 && Number(second.style.strokeDashoffset) < 0.75);
    assert.equal(status.textContent, '');
    advance(6009);
    assert.equal(status.textContent, '');
    advance(6010);
    assert.deepEqual(litStops(), ['南京南', '徐州东', '济南西']);
    assert.equal(second.style.strokeDashoffset, '0');
    assert.equal(status.textContent, '已点亮济南西至南京南');
    assert.equal(button.textContent, '重播行程');

    button.click();
    assert.equal(first.style.strokeDashoffset, '1');
    assert.deepEqual(litStops(), ['济南西']);
    button.click();
    assert.equal(frames.size, 1);
    cleanup();
    button.click();
    assert.equal(frames.size, 0);
  } finally {
    cleanup();
    dom.window.close();
  }
});
