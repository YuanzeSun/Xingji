import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {prepareCloud} from './helpers/cloud.js';

test('manual entry highlights missing fields, focuses visible controls and blocks repeated saves while GitHub is slow',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',{url:'http://localhost/#import'}),{window}=dom;
  for(const key of ['window','document','location','history','sessionStorage','FormData','Image'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});
  window.scrollTo=()=>{};window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Editor did not settle');};
  const fill=(name,value)=>{const input=document.querySelector(`[name="${name}"]`);input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));};
  try{
    const server=await prepareCloud();await import('../src/app.js');
    await wait(()=>document.querySelector('[data-action="new"]:not(:disabled)'));document.querySelector('[data-action="new"]').click();
    await wait(()=>document.querySelector('#editor-form'));
    const form=document.querySelector('#editor-form'),submit=()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    submit();assert.equal(document.querySelector('#editor-error').hidden,false);
    assert.match(document.querySelector('#editor-error').textContent,/必填信息/);
    assert.equal(document.activeElement.name,'origin');assert.equal(document.activeElement.getAttribute('aria-invalid'),'true');
    for(const [key,value] of Object.entries({origin:'北京南',destination:'南京南',service:'G21',departureDate:'2026-11-17',departureTime:'08:00',passenger:'示例旅客',identity:'P000001',carriage:'03',seat:'08A'}))fill(key,value);
    submit();assert.ok(document.activeElement.matches('[data-seat-preset]'),'hidden seatClass value focuses the visible select');
    const preset=document.querySelector('[data-seat-preset]');preset.value='二等座';preset.dispatchEvent(new window.Event('change',{bubbles:true}));
    assert.equal(document.querySelector('#editor-error').hidden,true);assert.equal(document.querySelector('.field-invalid'),null);
    let unblock,held=0;const gate=new Promise(resolve=>unblock=resolve);
    globalThis.fetch=async(url,options)=>{held++;await gate;return server.fetch(url,options);};
    submit();assert.match(form.querySelector('[type="submit"]').textContent,/保存中/);assert.equal(form.getAttribute('aria-busy'),'true');
    assert.equal(form.querySelector('[type="submit"]').disabled,true);submit();await wait(()=>held===1);
    document.querySelector('.modal-heading [data-action="close-modal"]').click();assert.ok(form.isConnected);
    unblock();await wait(()=>!document.querySelector('dialog'));
    assert.equal(server.records().length,1);assert.equal(server.calls.filter(call=>call.method==='PATCH').length,1);
    globalThis.fetch=server.fetch;
    document.querySelector('[data-action="new"]').click();await wait(()=>document.querySelector('#editor-form'));
    for(const [key,value] of Object.entries({origin:'北京南',destination:'南京南',service:'G23',departureDate:'2026-11-17',departureTime:'09:00',passenger:'示例旅客',identity:'P000001',carriage:'03',seat:'08A',seatClass:'二等座'}))fill(key,value);
    server.available=false;
    const retryForm=document.querySelector('#editor-form');retryForm.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    await wait(()=>!retryForm.dataset.pending);
    assert.equal(retryForm.getAttribute('aria-busy'),null);assert.match(retryForm.querySelector('[type="submit"]').textContent,/保存票据/);
    assert.equal(retryForm.elements.service.value,'G23');assert.equal(retryForm.querySelector('#editor-error').hidden,false);
    server.available=true;window.dispatchEvent(new window.Event('online'));
    await wait(()=>!retryForm.querySelector('[type="submit"]').disabled);
    assert.equal(retryForm.elements.service.disabled,false,'network recovery restores controls after a failed save');
  }finally{window.dispatchEvent(new window.Event('offline'));dom.window.close();}
});
