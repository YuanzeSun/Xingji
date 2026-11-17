import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRecord} from '../src/model.js';
import {createBoardingCode,readBoardingCode} from '../src/bcbp.js';
import {ticketCodeEditor,bindTicketCodeEditor} from '../src/code-editor.js';
import {BOARDING_SHARED_FIELDS} from '../src/boarding-code-state.js';

const values={passenger:'DOE/JANE',pnr:'ABC123',origin:'PEK',destination:'SHA',carrier:'CA',flightNumber:'1234',date:'2026-11-17',cabin:'Y',seat:'12A',sequence:'25',status:'3',electronic:'E'};
const flight=extra=>createRecord({type:'flight',template:'air-boarding-pass',passenger:'DOE/JANE',pnr:'ABC123',origin:'PEK',destination:'SHA',service:'CA1234',departureDate:'2026-11-17',seat:'12A',seatClass:'S',...extra});
function editor(draft,options={}){
  const dom=new JSDOM('<form>'+BOARDING_SHARED_FIELDS.map(key=>`<input name="${key}" value="${key.endsWith('Date')?calendarDate(draft[key]):draft[key]}">`).join('')+'<p id="editor-error" hidden></p>'+ticketCodeEditor(draft)+'<button type="submit">保存</button></form>'),form=dom.window.document.querySelector('form');
  let saves=0;
  const cleanup=bindTicketCodeEditor(form,draft,()=>{},options);
  form.addEventListener('submit',event=>{event.preventDefault();saves++;});
  return {dom,form,draft,get saves(){return saves;},set(key,value){const input=form.elements[key];input.value=value;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));},submit(){form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));},dispose(){cleanup();dom.window.close();}};
}

test('reading an original barcode fills the generator, carrier and supplied cabin code without guessing a date',async()=>{
  const code=createBoardingCode(values),draft=flight({passenger:'',pnr:'',origin:'',destination:'',originCode:'',destinationCode:'',service:'',departureDate:'',seat:'',seatClass:''});
  const page=editor(draft,{loadRebuilder:async()=>async()=>({codes:[{data:code,format:code.format}],issues:[]})});
  try{
    const photo=page.form.querySelector('#code-photo');Object.defineProperty(photo,'files',{value:[new Blob(['fixture'])]});photo.dispatchEvent(new page.dom.window.Event('change',{bubbles:true}));
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(page.form.querySelector('[data-bcbp="sequence"]').value,'00025');assert.equal(page.form.querySelector('[data-bcbp="status"]').value,'3');assert.equal(page.form.querySelector('[data-bcbp="cabin"]'),null);
    assert.equal(page.form.querySelector('[data-bcbp-fields]').disabled,true);assert.ok([...page.form.querySelectorAll('[data-bcbp]')].every(input=>input.disabled));
    assert.equal(draft.boardingCodeSource,'original');assert.equal(draft.passenger,'DOE/JANE');assert.equal(draft.pnr,'ABC123');assert.equal(draft.originCode,'PEK');assert.equal(draft.destinationCode,'SHA');assert.equal(draft.seat,'12A');
    assert.equal(calendarDate(draft.departureDate),'');assert.equal(draft.seatClass,'Y');assert.equal(draft.airline,'中国国际航空');assert.equal(page.form.elements.departureDate.value,'');
    page.set('seat','20C');page.submit();assert.equal(page.saves,1);assert.deepEqual(draft.boardingCode,code);
    assert.equal(page.form.elements.seat.value,'12A');assert.equal(page.form.elements.seat.readOnly,true);assert.equal(page.form.querySelector('#code-consistency').hidden,true);
  }finally{page.dispose();}
});

test('original barcode reading replaces conflicting input with decoded facts and locks those fields',async()=>{
  const code=createBoardingCode(values),draft=flight({seat:'20C'}),page=editor(draft,{loadRebuilder:async()=>async()=>({codes:[{data:code,format:code.format}],issues:[]})});
  try{
    const photo=page.form.querySelector('#code-photo');Object.defineProperty(photo,'files',{value:[new Blob(['fixture'])]});photo.dispatchEvent(new page.dom.window.Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(draft.seat,'12A');assert.equal(page.form.elements.seat.value,'12A');assert.equal(page.form.elements.seat.readOnly,true);assert.deepEqual(draft.boardingCode,code);
  }finally{page.dispose();}
});

test('generated codes update after edits, preserve adopted settings, and synchronously flush before saving',async()=>{
  const draft=flight({boardingCode:createBoardingCode(values),boardingCodeSource:'generated'}),page=editor(draft);
  try{
    page.set('seat','20C');assert.match(page.form.querySelector('#code-consistency').textContent,/待更新/);
    await new Promise(resolve=>setTimeout(resolve,180));assert.equal(readBoardingCode(draft.boardingCode).seat,'20C');assert.equal(page.form.querySelector('#code-consistency').hidden,true);
    page.set('service','CA5678');page.set('departureDate','2024-12-31');page.set('pnr','XYZ789');page.submit();assert.equal(page.saves,1);
    const read=readBoardingCode(draft.boardingCode);assert.equal(read.service,'CA5678');assert.equal(read.dayOfYear,366);assert.equal(read.pnr,'XYZ789');assert.equal(read.status,'3');assert.equal(read.cabin,'S');assert.equal(read.sequence,'00025');
    page.set('seatClass','Z');page.set('seat','30A');page.submit();assert.equal(readBoardingCode(draft.boardingCode).cabin,'Z','the generated code follows the main booking code');
  }finally{page.dispose();}
});

test('an incomplete generated code blocks submission, keeps its previous bytes, locates the field and recovers after correction',()=>{
  const draft=flight({boardingCode:createBoardingCode(values),boardingCodeSource:'generated'}),page=editor(draft),before=structuredClone(draft.boardingCode);
  try{
    page.set('pnr','');page.submit();assert.equal(page.saves,0);assert.deepEqual(draft.boardingCode,before);assert.equal(page.dom.window.document.activeElement.name,'pnr');assert.equal(page.form.querySelector('#editor-error').hidden,false);
    page.set('pnr','TOOLONGPNR');page.submit();assert.equal(page.saves,0);assert.equal(page.dom.window.document.activeElement.name,'pnr');
    page.set('pnr','XYZ789');page.submit();assert.equal(page.saves,1);assert.equal(page.form.querySelector('#editor-error').hidden,true);assert.equal(readBoardingCode(draft.boardingCode).pnr,'XYZ789');
    page.form.querySelector('#code-remove').click();assert.equal(draft.boardingCodeSource,'');assert.equal(draft.boardingCodeOperatingFlight,'');assert.equal(draft.boardingCode,'');
    page.set('pnr','');page.submit();assert.equal(page.saves,2,'removing the generated code restores ordinary ticket saving');
  }finally{page.dispose();}
});

test('automatic regeneration retains explicit operating flights and a disposed editor cannot change a ticket',async()=>{
  const draft=flight({boardingCode:createBoardingCode(values),boardingCodeSource:'generated',boardingCodeOperatingFlight:'AA45A'}),page=editor(draft);
  page.set('service','BA123');page.set('seat','20C');page.submit();assert.equal(readBoardingCode(draft.boardingCode).service,'AA45A');
  const before=structuredClone(draft.boardingCode);page.set('seat','30A');page.dispose();await new Promise(resolve=>setTimeout(resolve,180));assert.deepEqual(draft.boardingCode,before);
});

test('scanning fills and locks decoded facts and enables manual editing and generation after removing the original',async()=>{
  const code=createBoardingCode(values),draft=flight({passenger:'默认姓名',pnr:'MYPNR',seatClass:'M',airline:'手动航司',lockedFields:['pnr','seatClass','airline']}),page=editor(draft,{replaceDefaults:true,loadRebuilder:async()=>async()=>({codes:[{data:code,format:code.format}],issues:[]})});
  try{
    const photo=page.form.querySelector('#code-photo');Object.defineProperty(photo,'files',{value:[new Blob(['fixture'])]});photo.dispatchEvent(new page.dom.window.Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(draft.passenger,'DOE/JANE');assert.equal(draft.pnr,'ABC123');assert.equal(page.form.querySelector('[data-bcbp-generate]').disabled,true);
    assert.equal(draft.seatClass,'Y');assert.equal(draft.airline,'中国国际航空');assert.equal(page.form.elements.passenger.readOnly,true);assert.equal(page.form.elements.pnr.readOnly,true);
    const before=structuredClone(draft.boardingCode);page.form.querySelector('[data-bcbp-generate]').dispatchEvent(new page.dom.window.Event('click',{bubbles:true}));assert.deepEqual(draft.boardingCode,before);
    page.form.querySelector('#code-remove').click();assert.equal(page.form.querySelector('[data-bcbp-fields]').disabled,false);assert.equal(page.form.querySelector('[data-bcbp-generate]').disabled,false);
    assert.equal(page.form.elements.passenger.readOnly,false);assert.equal(page.form.elements.pnr.readOnly,false);
    assert.equal(page.form.querySelector('[data-bcbp="sequence"]').value,'00025');
  }finally{page.dispose();}
});
