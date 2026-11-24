import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRecord} from '../src/model.js';
import {mountStatistics} from '../src/statistics.js';

const rows=()=>['2022-01-01','2023-06-01','2024-12-31'].map((departureDate,i)=>createRecord({id:'trip'+i,departureDate,origin:'北京南',destination:'上海虹桥'}));
function setup({reduced=true}={}) {
  const dom=new JSDOM('<div id="root"></div>'),root=dom.window.document.querySelector('#root');
  dom.window.matchMedia=()=>({matches:reduced});
  Object.defineProperty(dom.window.HTMLElement.prototype,'clientWidth',{get(){return this.matches('.statistics-chart-scroll') ? 360 : 0;},configurable:true});
  const records=rows(),options={period:'month',dateTo:'2026-11-17'};
  return {dom,root,records,options};
}
const width=root=>Number(root.querySelector('svg').getAttribute('viewBox').split(' ')[2]);
const position=root=>{const scroll=root.querySelector('.statistics-chart-scroll');return (scroll.scrollLeft+scroll.clientWidth/2-42)/(width(root)-84);};

test('chart buttons preserve the viewed date, fit the complete range and retain zoom without changing statistics',()=>{
  const f=setup(),{root,dom,records,options}=f,before=JSON.stringify(records);let cleanup=mountStatistics(root,records,{options});
  try{
    const summary=root.querySelector('.statistics-journey-metrics').textContent,scroll=root.querySelector('.statistics-chart-scroll');scroll.scrollLeft=1000;
    const center=position(root),initial=width(root);
    root.querySelector('[data-stat-zoom="in"]').click();assert.ok(width(root)>initial);assert.ok(Math.abs(position(root)-center)<.001);
    const saved=options.chartZoom;cleanup();cleanup=mountStatistics(root,records,{options});assert.equal(options.chartZoom,saved);
    root.querySelector('[data-stat-zoom="fit"]').click();assert.equal(width(root),360);assert.equal(root.querySelector('[data-stat-zoom="out"]').disabled,true);
    assert.ok(root.querySelectorAll('.statistics-axis').length<15);assert.equal(root.querySelectorAll('[data-stat-period]').length,72);
    root.querySelector('[data-stat-zoom="in"]').click();assert.ok(width(root)>360);
    assert.equal(root.querySelector('.statistics-journey-metrics').textContent,summary);assert.equal(JSON.stringify(records),before);
  }finally{cleanup();dom.window.close();}
});

test('pinch and modifier-wheel zoom around the gesture, ordinary scrolling remains available, and keyboard controls work',()=>{
  const {root,dom,records,options}=setup(),cleanup=mountStatistics(root,records,{options}),scroll=root.querySelector('.statistics-chart-scroll');
  const touch=(type,points)=>{const event=new dom.window.Event(type,{bubbles:true,cancelable:true});Object.defineProperty(event,'touches',{value:points.map(([clientX,clientY])=>({clientX,clientY}))});scroll.dispatchEvent(event);return event;};
  try{
    const old=options.chartZoom,wheel=new dom.window.WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true});scroll.dispatchEvent(wheel);assert.equal(wheel.defaultPrevented,false);assert.equal(options.chartZoom,old);
    const modified=new dom.window.WheelEvent('wheel',{deltaY:-50,ctrlKey:true,clientX:180,bubbles:true,cancelable:true});scroll.dispatchEvent(modified);assert.equal(modified.defaultPrevented,true);assert.ok(options.chartZoom>old);
    const before=options.chartZoom;touch('touchstart',[[100,40],[200,40]]);const move=touch('touchmove',[[50,40],[250,40]]);assert.equal(move.defaultPrevented,true);assert.ok(Math.abs(options.chartZoom-before*2)<.0001);
    touch('touchend',[[50,40]]);assert.equal(touch('touchmove',[[60,40]]).defaultPrevented,false);
    scroll.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'0',bubbles:true,cancelable:true}));assert.equal(width(root),360);
    scroll.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'+',bubbles:true,cancelable:true}));assert.ok(width(root)>360);
    const point=root.querySelector('[data-stat-period="2023-06"]');point.dispatchEvent(new dom.window.FocusEvent('focusin',{bubbles:true}));assert.equal(root.querySelectorAll('.statistics-dot.is-active').length,2);assert.match(root.querySelector('.statistics-chart-readout').textContent,/2023年6月.*火车 1 次/);
    assert.equal(scroll.querySelectorAll('[tabindex="0"]').length, 0);
    scroll.focus();
    scroll.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    assert.match(root.querySelector('.statistics-chart-readout').textContent,/2023年7月/);
    assert.equal(dom.window.document.activeElement,scroll);
    root.querySelector('[data-stat-scale="year"]').click();
    assert.equal(dom.window.document.activeElement.dataset.statScale,'year');
  }finally{cleanup();dom.window.close();}
});

test('zoom animation advances smoothly and disposing a chart cancels pending animation and gesture handlers',()=>{
  const {root,dom,records,options}=setup({reduced:false}),frames=new Map();let id=0;
  dom.window.requestAnimationFrame=callback=>{frames.set(++id,callback);return id;};dom.window.cancelAnimationFrame=key=>frames.delete(key);
  const cleanup=mountStatistics(root,records,{options}),initial=width(root);
  const tick=time=>{const [key,callback]=frames.entries().next().value;frames.delete(key);callback(time);};
  try{
    root.querySelector('[data-stat-zoom="in"]').click();assert.equal(frames.size,1);tick(0);tick(110);const middle=width(root);assert.ok(middle>initial && middle<initial*1.25);tick(220);assert.equal(width(root),initial*1.25);
    root.querySelector('[data-stat-zoom="in"]').click();assert.equal(frames.size,1);cleanup();assert.equal(frames.size,0);
    const previous=options.chartZoom;root.querySelector('.statistics-chart-scroll').dispatchEvent(new dom.window.WheelEvent('wheel',{deltaY:-100,ctrlKey:true,bubbles:true,cancelable:true}));assert.equal(options.chartZoom,previous);
  }finally{cleanup();dom.window.close();}
});
