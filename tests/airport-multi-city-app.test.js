import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {createRecord} from '../src/model.js';
import {prepareCloud} from './helpers/cloud.js';

test('dual-city filters, details and airport edits stay consistent when the saved transport selector is disabled',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',{url:'http://localhost/#archive'}),{window}=dom;
  for(const key of ['window','document','location','history','sessionStorage','FormData','Image'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});
  window.scrollTo=()=>{};globalThis.confirm=()=>true;
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const record=createRecord({id:'flight',type:'flight',template:'air-boarding-pass',origin:'XNN',destination:'SHA',service:'CA1234',departureDate:'2026-11-16',departureTime:'08:00',passenger:'示例旅客',identity:'P000001',seat:'20C',seatClass:'Y'}),server=await prepareCloud([record]);
  const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Airport editor did not settle');};
  const fill=(selector,value,event='input')=>{const input=document.querySelector(selector);input.value=value;input.dispatchEvent(new window.Event(event,{bubbles:true}));};
  const open=async()=>{document.querySelector('[data-action="view"][data-id="flight"]').click();await wait(()=>document.querySelector('.detail-grid'));};
  try{
    await import('../src/app.js');await wait(()=>document.querySelector('#search-originCity'));
    fill('#search-originCity','海东');await wait(()=>document.querySelector('#city-context').textContent.includes('海东'));
    assert.equal(document.querySelectorAll('.ticket-card').length,1);await open();assert.match(document.querySelector('.detail-grid').textContent,/出发城市西宁 \/ 海东/);
    await wait(()=>document.querySelector('[data-action="edit"]:not(:disabled)'));document.querySelector('[data-action="edit"]').click();await wait(()=>document.querySelector('#editor-form'));assert.equal(document.querySelector('[name="type"]').disabled,true);
    fill('[name="origin"]','PKX');assert.equal(document.querySelector('[name="originCode"]').value,'PKX');
    document.querySelector('#editor-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!document.querySelector('#editor-form'));
    assert.equal(server.records()[0].originCode,'PKX');assert.equal(server.records()[0].originCity,'北京 / 廊坊');assert.equal(server.records()[0].departureZone,'Asia/Shanghai');
    fill('#search-originCity','廊坊');await wait(()=>document.querySelector('#city-context').textContent.includes('廊坊'));
    assert.equal(document.querySelectorAll('.ticket-card').length,1);await open();assert.match(document.querySelector('.detail-grid').textContent,/出发城市北京 \/ 廊坊/);
  }finally{window.dispatchEvent(new window.Event('offline'));dom.window.close();}
});
