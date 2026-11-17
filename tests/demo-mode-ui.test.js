import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {createRecord} from '../src/model.js';
import {prepareCloud} from './helpers/cloud.js';

test('sample mode exposes only browsing pages and preserves private records when switching back',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',{url:'http://localhost/#archive'}),{window}=dom;
  for(const key of ['window','document','location','history','sessionStorage','FormData','Image'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});
  window.scrollTo=()=>{};window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const original=createRecord({id:'private-ticket',origin:'清河',destination:'天津',service:'G103',departureDate:'2026-11-15'}),server=await prepareCloud([original]),db=await import('../src/db.js');
  const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Demo UI did not settle');};
  const pages=[['archive','我的票据'],['map','行程地图'],['statistics','数据统计'],['import','录入票据'],['data','数据与同步']];
  const go=async(page,title)=>{location.hash=page;await wait(()=>document.querySelector('.page-header h1')?.textContent===title);};
  const toggle=async enabled=>{const input=document.querySelector('#demo-toggle');input.checked=enabled;input.dispatchEvent(new window.Event('change',{bubbles:true}));await wait(async()=>await db.get('showDemo')===enabled && !document.querySelector('#demo-toggle').disabled);};
  try{
    await import('../src/app.js');await wait(()=>document.querySelector('#demo-toggle'));
    for(const [page,title] of pages){await go(page,title);assert.equal(document.querySelectorAll('#demo-toggle').length,1);assert.equal(document.querySelector('.page-header #demo-toggle').checked,false);}
    await toggle(true);
    for(const [page,title] of pages.slice(0,3)){
      await go(page,title);assert.equal(document.querySelectorAll('#demo-toggle').length,1);assert.equal(document.querySelector('.page-header #demo-toggle').checked,true);
      assert.equal(document.querySelector('[data-action="new"],[data-action="scan-ticket"],#camera-file,#import-files,#import-text'),null,page);
      assert.equal(document.querySelector('nav [data-page="import"],nav [data-page="data"],[data-action="sync"],.connection-notice'),null);
      assert.equal(document.querySelector('.guest-demo-notice'),null);
    }
    for(const page of ['data','import']){location.hash=page;await wait(()=>location.hash==='#archive');assert.equal(document.querySelector('#profile-form,#github-form,#import-text'),null);}
    await go('archive','我的票据');assert.equal(document.querySelectorAll('.ticket-card').length,7);document.querySelector('[data-action="view"][data-id="demo-2"]').click();await wait(()=>document.querySelector('.detail-grid'));
    assert.equal(document.querySelector('#modal-root [data-action="new"],#modal-root [data-action="edit"],#modal-root [data-action="delete"]'),null);
    document.querySelector('[data-action="close-modal"]').click();await go('archive','我的票据');await toggle(false);
    assert.ok(document.querySelector('[data-action="new"]'));assert.ok(document.querySelector('nav [data-page="import"]'));assert.ok(document.querySelector('nav [data-page="data"]'));
    await go('archive','我的票据');assert.ok(document.querySelector('[data-action="scan-ticket"]'));assert.ok(document.querySelector('[data-action="new"]'));assert.equal(document.querySelectorAll('.ticket-card').length,1);
    await go('import','录入票据');assert.ok(document.querySelector('.manual-panel'));assert.ok(document.querySelector('#camera-file'));
    assert.deepEqual(await db.get('records'),[original]);assert.deepEqual(server.records(),[original]);
  }finally{window.dispatchEvent(new window.Event('offline'));dom.window.close();}
});
