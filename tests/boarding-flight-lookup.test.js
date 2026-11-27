import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRecord} from '../src/model.js';
import {normalizeCodeData} from '../src/barcode-data.js';
import {BOARDING_SHARED_FIELDS} from '../src/boarding-code-state.js';
import {ticketCodeEditor,bindTicketCodeEditor} from '../src/code-editor.js';
import {boardingGeneratorMarkup} from '../src/boarding-code-generator.js';
import {flightLookupMarkup,bindFlightLookup} from '../src/flight-lookup.js';
import {taggedBoardingPayload} from './helpers/tagged-boarding-code.js';

const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
function code(flightNumber='1234') {
  const text=taggedBoardingPayload({flightNumber}),bytes=new TextEncoder().encode(text);bytes[22]=32;
  return normalizeCodeData({version:1,format:'PDF417',rawBytes:Buffer.from(bytes).toString('base64'),symbologyIdentifier:']L2',gs1:false,eci:[],parameters:{symbolVersion:'',errorCorrectionLevel:'',mask:null}});
}
function editor(lookup) {
  const draft=createRecord({type:'flight',template:'air-boarding-pass'}),fields=[...BOARDING_SHARED_FIELDS,'departureTime','arrivalDate','arrivalTime','airline','aircraft','departureTerminal'];
  const dom=new JSDOM('<form>'+fields.map(key=>`<input name="${key}" value="${draft[key]}">`).join('')+ticketCodeEditor(draft)+boardingGeneratorMarkup(draft)+flightLookupMarkup()+'</form>'),form=dom.window.document.querySelector('form');
  let scanned=code(),applies=0;
  const stopCode=bindTicketCodeEditor(form,draft,()=>{},{loadRebuilder:async()=>async()=>({codes:[{data:scanned,format:'PDF417'}],issues:[]})});
  const stopLookup=bindFlightLookup(form,{getRecord:()=>draft,getKey:()=> 'fictional-key',canQuery:()=>true,desktop:()=>true,lookup,apply:changes=>{applies++;Object.assign(draft,changes);for(const [key,value]of Object.entries(changes))if(form.elements[key])form.elements[key].value=value;}});
  const photo=form.querySelector('#code-photo');Object.defineProperty(photo,'files',{value:[new Blob(['synthetic QR'])]});
  return {dom,form,draft,get applies(){return applies;},async scan(number='1234'){scanned=code(number);photo.dispatchEvent(new dom.window.Event('change',{bubbles:true}));await settle();},date(value){draft.departureDate=value;form.elements.departureDate.value=value;form.elements.departureDate.dispatchEvent(new dom.window.Event('input',{bubbles:true}));},query(){form.querySelector('[data-flight-lookup]').click();},dispose(){stopLookup();stopCode();dom.window.close();}};
}
const schedule=()=>createRecord({type:'flight',template:'air-boarding-pass',service:'CA1234',origin:'PEK',destination:'SHA',departureDate:'2026-05-18',departureTime:'18:00',arrivalDate:'2026-05-18',arrivalTime:'20:00',airline:'中国国际航空',aircraft:'A320',aircraftRegistration:'B-306R',departureTerminal:'T3',gate:'B2',passenger:'UNRELATED/NAME',seat:'99Z',pnr:'OTHER',ticketNumber:'9999999999999',boardingTime:'16:00',boardingCode:code('4321'),boardingCodeSource:'original',boardingLegIndex:'0'});

test('scanning then querying fills only missing schedule data and preserves the Chinese name, gate and rebuilt barcode',async()=>{
  const page=editor(async(query,key)=>{assert.equal(key,'fictional-key');assert.deepEqual(query,{fnum:'CA1234',date:'2026-05-18',dep:'PEK',arr:'SHA'});return [schedule()];});
  try{
    await page.scan();assert.equal(calendarDate(page.draft.departureDate),'');page.date('2026-05-18');
    const before=structuredClone(page.draft);page.query();await settle();
    assert.equal(page.applies,1);assert.equal(page.draft.departureTime,'18:00');assert.equal(page.draft.arrivalTime,'20:00');assert.equal(page.draft.departureTerminal,'T3');
    for(const key of ['passenger','seat','seatClass','airline','pnr','ticketNumber','gate','boardingCode','boardingCodeSource','boardingTime'])assert.deepEqual(page.draft[key],before[key],key);
    assert.equal(page.draft.seatClass,'Z');assert.equal(page.draft.airline,'中国国际航空');
    assert.equal(page.draft.passenger,'张三');assert.equal(page.draft.gate,'A101');assert.equal(before.boardingTime,'18:21');assert.equal(page.draft.boardingTime,'18:21');assert.equal(page.form.querySelector('[data-bcbp-fields]').disabled,true);
  }finally{page.dispose();}
});

test('a new scan during a pending flight lookup discards the response for the old flight',async()=>{
  let resolve;
  const page=editor(()=>new Promise(done=>{resolve=done;}));
  try{
    await page.scan();page.date('2026-05-18');page.query();
    await page.scan('4321');
    page.form.querySelector('[name=scan-service][value=scanned]').click();
    page.form.querySelector('[data-scan-confirm]').click();
    const before=structuredClone(page.draft);resolve([schedule()]);await settle();
    assert.equal(page.applies,0);assert.deepEqual(page.draft,before);assert.equal(page.draft.service,'CA4321');assert.match(page.form.querySelector('[data-flight-status]').textContent,/已改变/);
  }finally{page.dispose();}
});
