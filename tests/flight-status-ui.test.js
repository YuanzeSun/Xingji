import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { prepareCloud } from './helpers/cloud.js';
import { createRecord } from '../src/model.js';

test('an OPEN ticket can be saved without a flight or date, edited to invalid and retained in the archive outside travel counts', async()=>{
 const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',{url:'http://localhost/'}),{window}=dom;
 for(const key of ['window','document','location','history','sessionStorage','FormData'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
 Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});window.scrollTo=()=>{};window.confirm=()=>true;
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const normal=createRecord({id:'normal-flight',type:'flight',template:'air-boarding-pass',origin:'PEK',destination:'SHA',service:'CA1234',departureDate:'2023-11-18',carriage:'05'});
 const server=await prepareCloud([normal]),db=await import('../src/db.js');
 const wait=async check=>{for(let i=0;i<400;i++){if(await check())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Flight state UI did not settle');};
 const fill=(name,value)=>{const input=document.querySelector(`#editor-form [name="${name}"]`);assert.ok(input,name);input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));};
 const submit=()=>document.querySelector('#editor-form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 try{
  await import('../src/app.js');await wait(()=>document.querySelector('.ticket-card')&&document.querySelector('.sync-button').textContent.includes('已同步'));
  document.querySelector('.ticket-preview[data-id="normal-flight"]').click();await wait(()=>document.querySelector('.detail-grid'));
  assert.doesNotMatch(document.querySelector('.detail-grid').textContent,/铺位|05车/);assert.match(document.querySelector('.detail-grid').textContent,/机票状态正常/);
  document.querySelector('[data-action="close-modal"]').click();
  document.querySelector('[data-action="new"]').click();await wait(()=>document.querySelector('#editor-form'));fill('type','flight');
  const originInput=document.querySelector('#editor-form [name="origin"]');fill('origin','PEK');
  assert.equal(document.querySelector('#editor-form [name="origin"]'),originInput,'ordinary flight typing must not replace the form or lose focus');
  fill('flightStatus','open');
  assert.equal(document.querySelector('[name="service"]').required,false);assert.equal(document.querySelector('[name="departureDate"]').required,false);
  assert.equal(document.querySelector('[name="departureDateYear"]').value,String(new Date().getFullYear()));
  fill('departureDateYear','');
  assert.equal(document.querySelector('[data-seat-preset]').required,false);
  assert.equal(document.querySelector('[name="seatClass"]').getAttribute('aria-required'),'false');
  fill('origin','LHR');fill('destination','SYD');fill('passenger','TEST/USER');
  assert.equal(document.querySelectorAll('#editor-preview [data-flight-status="open"]').length,2);
  submit();await wait(async()=>server.records().length===2&&!document.querySelector('#editor-form')&&!(await db.get('syncMeta')).pending);
  let special=server.records().find(r=>r.id!==normal.id);assert.equal(special.flightStatus,'open');assert.equal(calendarDate(special.departureDate),'');assert.equal(special.service,'');
  const stats=document.querySelector('.stats').textContent;assert.match(stats,/机票1程/);assert.match(stats,/涉及城市2城/);assert.deepEqual([...document.querySelectorAll('.transport-tag.flight')].map(tag=>tag.textContent),['机票','机票']);
  document.querySelector(`.ticket-preview[data-id="${special.id}"]`).click();await wait(()=>document.querySelector('[data-action="edit"]'));assert.doesNotMatch(document.querySelector('.detail-grid').textContent,/铺位/);assert.match(document.querySelector('.detail-grid').textContent,/机票状态OPEN/);document.querySelector('[data-action="edit"]').click();await wait(()=>document.querySelector('#editor-form'));fill('flightStatus','invalid');submit();
  await wait(()=>server.records().find(r=>r.id===special.id).flightStatus==='invalid'&&!document.querySelector('#editor-form'));
  assert.deepEqual([...document.querySelectorAll('.transport-tag.flight')].map(tag=>tag.textContent),['机票','机票']);
  document.querySelector(`.ticket-preview[data-id="${special.id}"]`).click();await wait(()=>document.querySelector('[data-action="edit"]'));document.querySelector('[data-action="edit"]').click();await wait(()=>document.querySelector('#editor-form'));fill('flightStatus','normal');
  assert.equal(document.querySelector('[name="service"]').required,true);submit();await wait(()=>document.querySelector('#editor-error').textContent.includes('航班号'));
  assert.equal(server.records().find(r=>r.id===special.id).flightStatus,'invalid');
 }finally{dom.window.close();}
});
