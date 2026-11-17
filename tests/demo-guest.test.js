import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';

test('a fresh visitor can browse examples without GitHub, then return to the connection form',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',{url:'http://localhost/#archive'}),{window}=dom;
  for(const key of ['window','document','location','history','sessionStorage','FormData','Image'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});
  window.scrollTo=()=>{};window.requestAnimationFrame=()=>0;window.cancelAnimationFrame=()=>{};
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const requests=[];globalThis.fetch=async url=>{requests.push(String(url));return new Response('{}',{status:404});};
  const db=await import('../src/db.js');
  const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Guest demo did not settle');};
  const click=selector=>{const button=document.querySelector(selector);assert.ok(button,selector);button.click();};
  try{
    await import('../src/app.js');await wait(()=>document.querySelector('.cloud-setup [data-action="enter-demo"]'));
    assert.equal(document.querySelector('[data-action="enter-demo"]').textContent,'进入示例模式');
    const owner=document.querySelector('[name="owner"]');owner.value='draft-owner';owner.dispatchEvent(new window.Event('input',{bubbles:true}));
    click('[data-action="enter-demo"]');
    await wait(()=>document.querySelectorAll('.ticket-card').length===7);
    assert.equal(await db.get('showDemo'),true);assert.equal(document.querySelector('.cloud-setup'),null);
    for(const page of ['map','statistics','archive']){
      click('nav [data-page="'+page+'"]');await wait(()=>document.querySelector('nav [data-page="'+page+'"][aria-current="page"]'));
      assert.equal(document.querySelector('#demo-toggle').checked,true);
      assert.equal(document.querySelector('nav [data-page="data"],nav [data-page="import"],#github-form,#profile-form,[data-action="sync"],.connection-notice'),null);
      assert.equal(document.querySelectorAll('.guest-demo-notice').length,1);assert.match(document.querySelector('.guest-demo-notice').textContent,/登录后即可开始记录自己的旅程/);
      if(['map','archive'].includes(page))click('.guest-demo-notice [data-action="exit-demo"]');
      else{const toggle=document.querySelector('#demo-toggle');toggle.checked=false;toggle.dispatchEvent(new window.Event('change',{bubbles:true}));}
      await wait(()=>document.querySelector('.cloud-setup #github-form'));assert.equal(await db.get('showDemo'),false);
      assert.equal(document.querySelector('[name="owner"]').value,'draft-owner');
      click('[data-action="enter-demo"]');await wait(()=>document.querySelectorAll('.ticket-card').length===7);
    }
    click('[data-action="view"][data-id="demo-2"]');await wait(()=>document.querySelector('.detail-grid'));
    assert.equal(document.querySelector('#modal-root [data-action="edit"],#modal-root [data-action="delete"]'),null);click('[data-action="close-modal"]');
    for(const page of ['data','import']){location.hash=page;await wait(()=>location.hash==='#archive');assert.equal(document.querySelector('#github-form,#profile-form,#import-text'),null);}
    assert.deepEqual(await db.get('records',[]),[]);assert.equal(await db.get('github'),undefined);
    click('[data-action="exit-demo"]');await wait(()=>document.querySelector('.cloud-setup #github-form'));
    assert.equal(await db.get('showDemo'),false);assert.equal(document.querySelector('[name="owner"]').value,'draft-owner');
    assert.ok(document.querySelector('[data-action="enter-demo"]'));assert.equal(document.querySelector('nav'),null);
    assert.equal(requests.some(url=>url.includes('api.github.com')),false);
  }finally{window.dispatchEvent(new window.Event('offline'));dom.window.close();}
});
