import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {prepareCloud} from './helpers/cloud.js';

test('switching new ticket modes clears all fields and editing saved tickets keeps the transport fixed',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',{url:'http://localhost/#archive'}),{window}=dom;
  for(const key of ['window','document','location','history','sessionStorage','FormData','Image'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});
  window.scrollTo=()=>{};globalThis.confirm=()=>true;
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const profile={chineseName:'示例旅客',firstName:'JANE',lastName:'DOE',documents:[{id:'id',type:'national-id',number:'000000200001011234'},{id:'passport',type:'passport',number:'P000001'}]};
  const server=await prepareCloud([],{profile});
  const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Transport editor did not settle: '+(document.querySelector('#editor-error')?.textContent || ''));};
  const form=()=>document.querySelector('#editor-form');
  const fill=(key,value,event='input')=>{const input=form().elements[key];assert.ok(input,key);input.value=value;input.dispatchEvent(new window.Event(event,{bubbles:true}));};
  const fillAll=values=>{for(const [key,value] of Object.entries(values))fill(key,value);};
  const controls=()=>[...form().querySelectorAll('input[name],select[name]')].map(input=>[input.name,input.value,input.checked]);
  const submit=async()=>{form().dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!form() && !document.querySelector('[data-action="new"]').disabled);};
  try{
    await import('../src/app.js');await wait(()=>document.querySelector('[data-action=new]:not(:disabled)'));
    document.querySelector('[data-action="new"]').click();await wait(form);
    assert.ok(form().querySelector('[data-rail-photo]'));
    const blankRail=controls();
    fillAll({origin:'北京南',destination:'南京南',service:'G21',departureDate:'2026-11-16',departureTime:'08:00',arrivalDate:'2026-11-16',arrivalTime:'12:00',passenger:'旧姓名',identity:'OLD123',carriage:'03',seat:'08A',seatClass:'二等座',railTrainsets:'CR400BF-B-5099',railBureau:'北京局',railModel:'CR400BF-B',railMileage:'1020',orderNumber:'OLDORDER',gate:'A10',price:'400',offsetX:'4'});
    document.querySelector('[data-mark-add]').click();fill('markText-0','孩');
    fill('type','flight','change');
    assert.equal(form().querySelector('[data-rail-photo]'),null);
    assert.ok(form().querySelector('#code-photo'));
    assert.equal(form().elements.template.value,'air-boarding-pass');
    assert.equal(form().elements.passenger.value,'DOE/JANE');assert.equal(form().elements.identity.value,'P000001');
    for(const key of ['origin','destination','originCode','destinationCode','service','departureDate','departureTime','arrivalDate','arrivalTime','seat','orderNumber','gate','price'])assert.equal(form().elements[key].value,'',key);
    assert.equal(form().elements.offsetX.value,'0');assert.equal(document.querySelector('[data-field-source="passenger"]').textContent,'个人资料');
    fillAll({origin:'PEK',destination:'LHR',service:'CA937',departureDate:'2026-11-17',departureTime:'09:00',arrivalDate:'2026-11-17',arrivalTime:'13:00',actualDepartureDate:'2026-11-17',actualDepartureTime:'09:10',actualArrivalDate:'2026-11-17',actualArrivalTime:'13:15',passenger:'OLD/NAME',identity:'OLDPASSPORT',seat:'20C',seatClass:'S',airline:'中国国际航空',aircraft:'777-300ER',aircraftRegistration:'B-0001',flightDistance:'8000',pnr:'ABC123',ticketNumber:'1230000000001',terminal:'T3',boardingTime:'08:30',orderNumber:'FLIGHTORDER',gate:'B20',price:'5000',offsetY:'5'});
    fill('type','rail');
    assert.deepEqual(controls(),blankRail,'switching back restores a fresh form, including hidden values, marks, dates and layout');
    fillAll({origin:'清河',destination:'天津',service:'G103',departureDate:'2026-11-15',departureTime:'08:00',carriage:'05',seat:'08F',seatClass:'二等座',railTrainsets:'cr400af-0001'});
    form().querySelector('[data-rail-standing]').click();
    assert.equal(form().elements.seat,undefined);
    await submit();
    const rail=server.records()[0];assert.equal(rail.type,'rail');assert.equal(rail.railTrainsets,'CR400AF-0001');
    assert.equal(rail.seatClass,'二等座');assert.equal(rail.railStanding,true);assert.equal(rail.seat,'');
    for(const key of ['actualDepartureDate','actualDepartureTime','actualArrivalDate','actualArrivalTime','flightDistance','airline','aircraft','aircraftRegistration','pnr','terminal','boardingTime','orderNumber','gate','price','boardingCode'])assert.equal(rail[key],'',key);
    assert.deepEqual(rail.ticketMarks,[]);assert.equal(rail.fieldSources.airline,undefined);
    document.querySelector('[data-action="new"]').click();await wait(form);fill('type','flight');
    fillAll({origin:'PEK',destination:'LHR',service:'CA937',departureDate:'2026-11-17',departureTime:'09:00',seat:'20C',seatClass:'Y'});await submit();
    document.querySelector('[data-action="navigate"][data-page="archive"]').click();
    for(const ticket of server.records()){
      await wait(()=>document.querySelector(`[data-action="view"][data-id="${ticket.id}"]`));
      document.querySelector(`[data-action="view"][data-id="${ticket.id}"]`).click();await wait(()=>document.querySelector('[data-action="edit"]:not(:disabled)'));
      document.querySelector('[data-action="edit"]').click();await wait(form);
      assert.equal(form().elements.type.disabled,true);
      fill('type',ticket.type==='rail'?'flight':'rail','change');assert.equal(form().elements.type.value,ticket.type);
      assert.equal(form().elements.template.value,ticket.template);
      fill('price','123');await submit();assert.equal(server.records().find(row=>row.id===ticket.id).type,ticket.type);
    }
  }finally{window.dispatchEvent(new window.Event('offline'));dom.window.close();}
});
