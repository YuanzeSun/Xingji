import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {indexedDB} from 'fake-indexeddb';
import {prepareCloud} from './helpers/cloud.js';
import {calendarDate} from '../src/journey-date.js';

test('archive entries preselect each transport and share a switchable editor',async()=>{
  const dom=new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',{url:'http://localhost/#archive'}),{window}=dom;
  for(const key of ['window','document','location','history','sessionStorage','FormData','Image'])Object.defineProperty(globalThis,key,{value:key==='window'?window:window[key],configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:window.navigator,configurable:true});Object.defineProperty(globalThis,'indexedDB',{value:indexedDB,configurable:true});
  window.scrollTo=()=>{};globalThis.confirm=()=>true;
  window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const profile={chineseName:'示例旅客',firstName:'JANE',lastName:'DOE',documents:[{id:'id',type:'national-id',number:'000000200001011234'},{id:'passport',type:'passport',number:'P000001'}]};
  const server=await prepareCloud([],{profile});
  const wait=async predicate=>{for(let i=0;i<300;i++){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}assert.fail('Transport editor did not settle: '+(document.querySelector('#editor-error')?.textContent || ''));};
  const form=()=>document.querySelector('#editor-form');
  const entry=type=>document.querySelector(`.page-header [data-action="new"][data-type="${type}"]`);
  const fill=(key,value,event='input')=>{const input=form().elements[key];assert.ok(input,key);input.value=value;input.dispatchEvent(new window.Event(event,{bubbles:true}));};
  const fillAll=values=>{for(const [key,value] of Object.entries(values))fill(key,value);};
  const controls=()=>[...form().querySelectorAll('input[name],select[name]')].map(input=>[input.name,input.value,input.checked]);
  const submit=async()=>{form().dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>!form() && !document.querySelector('[data-action="new"]').disabled);};
  try{
    await import('../src/app.js');await wait(()=>entry('rail')?.disabled===false && entry('flight')?.disabled===false);
    assert.equal(document.querySelectorAll('[data-action="new"]').length,2);
    assert.equal(entry('rail').textContent,'录入火车');
    assert.equal(entry('flight').textContent,'录入机票');
    entry('rail').click();await wait(form);
    assert.equal(form().elements.type.value,'rail');
    assert.equal(form().elements.departureDateYear.value,'');
    assert.equal(form().elements.departureTime.required,true);
    assert.ok(form().querySelector('[data-rail-photo]'));
    assert.equal(form().elements.offsetX, undefined);
    assert.equal(form().elements.offsetY, undefined);
    const blankRail=controls();
    fillAll({origin:'北京南',destination:'南京南',service:'G21',departureDate:'2026-11-16',departureTime:'08:00',arrivalDate:'2026-11-16',arrivalTime:'12:00',passenger:'旧姓名',identity:'OLD123',carriage:'03',seat:'08A',seatClass:'二等座',railTrainsets:'CR400BF-B-5099',railBureau:'北京局',railModel:'CR400BF-B',railMileage:'1020',orderNumber:'OLDORDER',gate:'A10',price:'400'});
    document.querySelector('[data-mark-add]').click();fill('markText-0','孩');fill('markX-0','4');fill('markY-0','-3');
    fill('type','flight','change');
    assert.equal(form().querySelector('[data-rail-photo]'),null);
    assert.ok(form().querySelector('#code-photo'));
    assert.equal(form().elements.template.value,'air-boarding-pass');
    assert.equal(form().elements.passenger.value,'DOE/JANE');assert.equal(form().elements.identity.value,'');
    for(const key of ['origin','destination','originCode','destinationCode','service','departureTime','arrivalDate','arrivalTime','seat','gate','price'])assert.equal(form().elements[key].value,'',key);
    assert.equal(form().elements.orderNumber, undefined);
    assert.equal(form().elements.departureDateYear.value,'');
    assert.equal(form().elements.offsetX, undefined);assert.equal(form().elements.offsetY, undefined);assert.equal(document.querySelector('[data-field-source="passenger"]').textContent,'个人资料');
    fillAll({origin:'PEK',destination:'LHR',service:'CA937',departureDate:'2026-11-17',departureTime:'09:00',arrivalDate:'2026-11-17',arrivalTime:'13:00',actualDepartureDate:'2026-11-17',actualDepartureTime:'09:10',actualArrivalDate:'2026-11-17',actualArrivalTime:'13:15',passenger:'OLD/NAME',identity:'OLDPASSPORT',seat:'20C',seatClass:'S',airline:'中国国际航空',aircraft:'777-300ER',aircraftRegistration:'B-0001',flightDistance:'8000',pnr:'ABC123',ticketNumber:'1230000000001',departureTerminal:'T3',boardingTime:'08:30',gate:'B20',price:'5000'});
    fill('type','rail');
    assert.deepEqual(controls(),blankRail,'switching back restores a fresh form, including hidden values, marks, dates and layout');
    fillAll({origin:'清河',destination:'天津',service:'G103',departureDate:'2026-11-15',departureTime:'08:00',carriage:'05',seat:'08F',seatClass:'二等座',railTrainsets:'cr400af-0001'});
    form().querySelector('[data-rail-standing]').click();
    assert.equal(form().elements.seat,undefined);
    await submit();
    const rail=server.records()[0];assert.equal(rail.type,'rail');assert.equal(rail.railTrainsets,'CR400AF-0001');
    assert.equal(rail.seatClass,'二等座');assert.equal(rail.railStanding,true);assert.equal(rail.seat,'');
    for(const key of ['actualDepartureDate','actualDepartureTime','actualArrivalDate','actualArrivalTime','flightDistance','airline','aircraft','aircraftRegistration','pnr','departureTerminal','boardingTime','orderNumber','gate','price','boardingCode'])assert.equal(rail[key],'',key);
    assert.deepEqual(rail.ticketMarks,[]);assert.equal(rail.fieldSources.airline,undefined);
    entry('flight').click();await wait(form);
    assert.equal(form().elements.type.value,'flight');
    assert.equal(form().elements.type.disabled,false);
    assert.equal(form().elements.departureDateYear.value,'');
    assert.equal(form().elements.departureDateMonth.value,'');
    assert.equal(form().elements.departureDateDay.value,'');
    assert.equal(form().elements.departureTime.required,false);
    assert.equal(form().querySelector('[data-field-source="departureDateYear"]').textContent,'未填写');
    assert.equal(form().querySelector('[data-field-source="departureDate"]').textContent,'未填写');
    fill('flightStopAirport','法兰克福机场');
    fillAll({origin:'PEK',destination:'LHR',service:'CA937',departureDateYear:'2026',departureDateMonth:'06',departureDateDay:'30',seat:'20C',seatClass:'Y'});
    for (const key of ['arrivalDate', 'actualDepartureDate', 'actualArrivalDate']) {
      assert.deepEqual(['Year','Month','Day',''].map(part => form().elements[key + part].value), ['2026','06','','']);
      assert.equal(form().querySelector(`[data-field-source="${key}Year"]`).textContent, '默认值');
    }
    const expectIncomplete = message => {
      form().dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
      assert.match(form().querySelector('#editor-error').textContent, message);
    };
    fill('actualDepartureTime','09:00');
    expectIncomplete(/实际起飞日期和时间/);
    fill('actualDepartureTime','');
    fill('arrivalDateMonth','07');
    fill('departureDateMonth','05');
    assert.equal(form().elements.arrivalDateMonth.value,'07');
    assert.equal(form().elements.actualArrivalDateMonth.value,'05');
    fill('departureDateMonth','06');
    expectIncomplete(/计划到达日期和时间/);
    fill('arrivalDateDay','01');
    expectIncomplete(/计划到达日期和时间/);
    fill('arrivalTime','13:00');
    await submit();
    const flight=server.records().find(row=>row.type==='flight');
    assert.equal(calendarDate(flight.departureDate),'2026-06-30');
    assert.equal(flight.departureTime,'');
    assert.equal(calendarDate(flight.arrivalDate),'2026-07-01');
    assert.equal(flight.arrivalTime,'13:00');
    for (const key of ['actualDepartureDate','actualDepartureTime','actualArrivalDate','actualArrivalTime']) assert.equal(flight[key],'');
    assert.equal(flight.flightStop.airport,'FRA');
    assert.equal(flight.fieldSources.flightStop,'manual');
    document.querySelector('[data-action="navigate"][data-page="archive"]').click();
    for(const ticket of server.records()){
      await wait(()=>document.querySelector(`[data-action="view"][data-id="${ticket.id}"]`));
      document.querySelector(`[data-action="view"][data-id="${ticket.id}"]`).click();await wait(()=>document.querySelector('[data-action="edit"]:not(:disabled)'));
      document.querySelector('[data-action="edit"]').click();await wait(form);
      assert.equal(form().elements.type.disabled,true);
      fill('type',ticket.type==='rail'?'flight':'rail','change');assert.equal(form().elements.type.value,ticket.type);
      assert.equal(form().elements.template.value,ticket.template);
      if (ticket.type === 'flight') {
        assert.equal(form().elements.arrivalDateMonth.value,'07');
        assert.equal(form().elements.arrivalDateDay.value,'01');
        assert.equal(form().elements.actualArrivalDateMonth.value,'06');
        assert.equal(form().elements.actualArrivalDateDay.value,'');
        fillAll({arrivalDateYear:'',arrivalDateMonth:'',arrivalDateDay:'',arrivalTime:''});
      }
      fill('price','123');await submit();assert.equal(server.records().find(row=>row.id===ticket.id).type,ticket.type);
      if (ticket.type === 'flight') {
        const updated = server.records().find(row=>row.id===ticket.id);
        assert.equal(updated.arrivalDate,'');
        assert.equal(updated.arrivalTime,'');
      }
    }
  }finally{window.dispatchEvent(new window.Event('offline'));dom.window.close();}
});
