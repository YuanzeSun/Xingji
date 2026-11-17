import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountJourneyMap } from '../src/journey-map.js';
import { demoRecords } from '../src/demo.js';
import { createMapBasemap, simplifyMapPath } from '../src/map-basemap.js';
import { COUNTRY_PATH, PROVINCE_PATH } from '../src/data/map-reference.js';

test('a burst of pinch moves paints only once per frame and retains route, node and label elements until release',()=>{
  const dom=new JSDOM('<div id="map"></div>'),previous=globalThis.window;globalThis.window=dom.window;
  const frames=new Map();let sequence=0;
  dom.window.requestAnimationFrame=callback=>{frames.set(++sequence,callback);return sequence;};dom.window.cancelAnimationFrame=id=>frames.delete(id);
  const flush=()=>{const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback());};
  const root=dom.window.document.querySelector('#map'),options={layers:['rail','flight'],viewport:{x:800,y:170,zoom:3},userMoved:true};
  const dispose=mountJourneyMap(root,demoRecords(),{icon:()=>'',options});
  const svg=root.querySelector('svg'),route=root.querySelector('.map-route'),node=root.querySelector('.map-node'),label=root.querySelector('.map-labels text'),grid=root.querySelector('.map-graticule path');
  const pointer=(type,id,x,y)=>{const event=new dom.window.MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperty(event,'pointerId',{value:id});svg.dispatchEvent(event);};
  try{
    const initial=svg.getAttribute('viewBox');pointer('pointerdown',1,400,310);pointer('pointerdown',2,600,310);
    for(let i=0;i<80;i++)pointer('pointermove',2,601+i,310);
    assert.equal(frames.size,1);assert.equal(svg.getAttribute('viewBox'),initial);assert.ok(options.viewport.zoom>3);
    flush();assert.notEqual(svg.getAttribute('viewBox'),initial);
    assert.equal(root.querySelector('.map-route'),route);assert.equal(root.querySelector('.map-node'),node);assert.equal(root.querySelector('.map-labels text'),label);assert.equal(root.querySelector('.map-graticule path'),grid);
    pointer('pointerup',2,680,310);pointer('pointerup',1,400,310);assert.equal(frames.size,1);flush();assert.equal(root.querySelector('.map-graticule path'),grid);
    pointer('pointerdown',1,400,310);pointer('pointermove',1,440,310);assert.equal(frames.size,1);dispose();assert.equal(frames.size,0);flush();
  }finally{dispose();dom.window.close();globalThis.window=previous;}
});

test('cached basemap paths keep country and province borders while limiting redraw resolution on dense screens',()=>{
  const created=[],draws=[],context={setLineDash(){},setTransform(){},clearRect(){},save(){},restore(){},translate(){},fill(path){draws.push(['fill',path]);},stroke(path){draws.push(['stroke',path]);}};
  class Path {constructor(d){this.d=d;created.push(this);}}
  const canvas={width:0,height:0,getContext:()=>context},map=createMapBasemap(canvas,{Path2D:Path,devicePixelRatio:3});
  map.draw({x:500,y:250,zoom:2},1000,500);assert.equal(created.length,3);assert.equal(canvas.width,2000);assert.equal(canvas.height,1000);
  assert.ok(draws.some(([kind,path])=>kind==='stroke'&&path.d===COUNTRY_PATH));
  map.draw({x:505,y:250,zoom:2.1},1000,500,true);const count=created.length;
  assert.equal(count,6);map.draw({x:510,y:250,zoom:2.1},1000,500,true);assert.equal(created.length,count);
  map.draw({x:510,y:250,zoom:2.1},1000,500);assert.equal(created.length,count);assert.equal(draws.at(-2)[1].d,COUNTRY_PATH);
});

test('subpixel simplification preserves separate boundaries, endpoints, corners and closed shapes',()=>{
  assert.equal(simplifyMapPath('M0,0L1,0L2,0L2,2L0,2L0,0Z',.1),'M0,0L2,0L2,2L0,2L0,0Z');
  const simplified=simplifyMapPath(COUNTRY_PATH,.15);
  assert.equal((simplified.match(/M/g)||[]).length,(COUNTRY_PATH.match(/M/g)||[]).length);
  assert.ok(simplified.length<COUNTRY_PATH.length);assert.doesNotMatch(simplified,/NaN|Infinity/);
});

test('rail detail can emphasize real province borders while the journey map keeps its own styling', () => {
  const strokes = [], dashes = [];
  const context = { setLineDash(value) { dashes.push(value); }, setTransform() {}, clearRect() {}, save() {}, restore() {}, translate() {}, fill() {}, stroke(path) { strokes.push({ path: path.d, color: this.strokeStyle, width: this.lineWidth, opacity: this.globalAlpha }); } };
  class Path { constructor(d) { this.d = d; } }
  const canvas = { width: 0, height: 0, getContext: () => context }, view = { Path2D: Path, devicePixelRatio: 1 };
  createMapBasemap(canvas, view, { provinceContrast: true }).draw({ x: 800, y: 180, zoom: 10 }, 600, 340);
  const highlighted = strokes.find(stroke => stroke.path === PROVINCE_PATH);
  assert.equal(highlighted.color, '#a4bac9'); assert.equal(highlighted.opacity, .95); assert.ok(dashes[0].every(value => value > 0));
  strokes.length = 0;
  createMapBasemap(canvas, view).draw({ x: 800, y: 180, zoom: 10 }, 600, 340);
  assert.equal(strokes.find(stroke => stroke.path === PROVINCE_PATH).color, '#526d80');
});
