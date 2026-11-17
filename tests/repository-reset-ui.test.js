import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {createRecord} from '../src/model.js';
import {prepareCloud} from './helpers/cloud.js';
import {answerArithmetic} from './helpers/arithmetic.js';

test('manual repository reset bypasses unreadable ticket data and preserves only personal settings in the current tree',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',{url:'http://localhost/#data'}),{window}=dom;
  for(const key of ['window','document','location','history','sessionStorage','FormData','Image'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});
  window.scrollTo=()=>{};window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const wait=async fn=>{for(let i=0;i<300;i++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Manual reset did not settle');};
  const click=selector=>{const node=document.querySelector(selector);assert.ok(node,selector);node.click();};
  try{
    const db=await import('../src/db.js'),settings={profile:{chineseName:'保留资料'},flightMcpKey:'keep-mcp'};
    const server=await prepareCloud([createRecord({departureDate:'2025-01-01'})],settings);
    await db.set('obsolete-version-data',{old:true});server.corrupt('archive/2025.json','this is not valid ticket JSON');server.corrupt('old-cache.json','discard');
    const oldHead=server.head;
    await import('../src/app.js');await wait(()=>document.querySelector('[data-action="reset-repository"]'));
    let unblock, held=0;
    const gate=new Promise(resolve=>unblock=resolve);
    globalThis.fetch=async(url,options)=>{held++;await gate;return server.fetch(url,options);};
    click('[data-action="reset-repository"]');
    await wait(()=>document.querySelector('[data-reset-preparing]'));
    assert.match(document.querySelector('[data-reset-preparing]').textContent,/正在读取仓库状态/);
    await wait(()=>held>=1);const preparing=document.querySelector('[data-reset-preparing]');
    click('[data-action="reset-repository"]');await Promise.resolve();
    assert.equal(document.querySelector('[data-reset-preparing]'),preparing,'repeated clicks retain the same preparation');
    click('[data-reset-preparing] [data-action="close-modal"]');unblock();
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(document.querySelector('dialog'),null,'cancelled preparation cannot reopen the reset dialog');
    globalThis.fetch=server.fetch;
    click('[data-action="reset-repository"]');await wait(()=>document.querySelector('[data-archive-reset]'));
    assert.match(document.querySelector('.archive-reset-body').textContent,/保留|个人资料|MCP/);
    click('[name="confirm-reset"]');document.querySelector('[name="arithmetic-answer"]').value='999999';
    document.querySelector('[data-archive-reset]').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    assert.match(document.querySelector('[data-arithmetic-error]').textContent,/不正确/);assert.equal(server.head,oldHead);
    answerArithmetic(document);document.querySelector('[data-archive-reset]').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
    assert.match(document.querySelector('[data-archive-reset] [type="submit"]').textContent,/重置中/);
    assert.equal(document.querySelector('[data-archive-reset]').getAttribute('aria-busy'),'true');
    await wait(async()=>!document.querySelector('dialog') && (await db.get('records')).length===0);
    const files=server.trees.get(server.commits.get(server.head).tree);assert.deepEqual(Object.keys(files),['archive/index.json']);
    assert.equal(server.settings().profile.chineseName,'保留资料');assert.equal(server.settings().flightMcpKey,'keep-mcp');assert.equal(server.ancestor(oldHead,server.head),true);
    assert.equal(await db.get('obsolete-version-data'),undefined);assert.equal((await db.get('settings')).flightMcpKey,'keep-mcp');assert.equal((await db.get('github')).id,77);assert.ok((await db.get('syncMeta')).generation);
  }finally{window.dispatchEvent(new window.Event('offline'));dom.window.close();}
});
