import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createRecord, archive, readArchive} from '../src/model.js';
import {createBoardingCode,readBoardingCode} from '../src/bcbp.js';
import {normalizeCodeData} from '../src/barcode-data.js';
import {ticketCodeEditor,bindTicketCodeEditor} from '../src/code-editor.js';
import {boardingGeneratorMarkup} from '../src/boarding-code-generator.js';
import {BOARDING_SHARED_FIELDS} from '../src/boarding-code-state.js';
import {taggedBoardingPayload} from './helpers/tagged-boarding-code.js';

const values={passenger:'DOE/JANE',pnr:'ABC123',origin:'PEK',destination:'SHA',carrier:'CA',flightNumber:'1234',date:'2026-11-17',cabin:'Y',seat:'12A',sequence:'25',status:'3',electronic:'E'};
const flight=extra=>createRecord({type:'flight',template:'air-boarding-pass',passenger:'DOE/JANE',pnr:'ABC123',origin:'PEK',destination:'SHA',service:'CA1234',departureDate:'2026-11-17',seat:'12A',seatClass:'S',boardingLegIndex:'0',...extra});
function editor(draft,options={}){
  const dom=new JSDOM('<form>'+BOARDING_SHARED_FIELDS.map(key=>`<input name="${key}" value="${key.endsWith('Date')?calendarDate(draft[key]):draft[key]}">`).join('')+'<p id="editor-error" hidden></p>'+ticketCodeEditor(draft,options)+boardingGeneratorMarkup(draft)+'<button type="submit">保存</button></form>'),form=dom.window.document.querySelector('form');
  let saves=0;
  const cleanup=bindTicketCodeEditor(form,draft,()=>{},options);
  form.addEventListener('submit',event=>{event.preventDefault();saves++;});
  return {dom,form,draft,get saves(){return saves;},set(key,value){const input=form.elements[key];input.value=value;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));},submit(){form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));},dispose(){cleanup();dom.window.close();}};
}

function savedEditor(draft) {
  let data;
  const page = editor(draft, { editingSaved: true, loadRebuilder: async () => async () => ({ codes: [{ data, format: data.format }], issues: [] }) });
  const upload = page.form.querySelector('#code-photo');
  Object.defineProperty(upload, 'files', { value: [new Blob(['synthetic boarding pass'])] });
  return Object.assign(page, { async scan(code) {
    data = code;
    upload.dispatchEvent(new page.dom.window.Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
  } });
}

test('rescanning an electronic pass with a paper pass fills missing fields and replaces the original only when values change', async () => {
  const facts = {...values, passenger:'ZHANG/SAN', date:'2026-05-18', cabin:'Z'};
  const electronic = createBoardingCode(facts, 'QRCode');
  const paper = normalizeCodeData({
    ...createBoardingCode(facts), rawBytes: Buffer.from(taggedBoardingPayload(facts)).toString('base64')
  });
  const draft = flight({passenger:'ZHANG/SAN', departureDate:facts.date, seatClass:'Z', airline:'中国国际航空', terminal:'T3',
    boardingCode:electronic, boardingCodeSource:'original', fieldSources:{departureDate:'barcode', seat:'barcode'}});
  const page = savedEditor(draft);
  try {
    assert.equal(page.form.querySelector('#code-remove'), null);
    await page.scan(createBoardingCode({...facts, sequence:'48'}));
    assert.deepEqual(draft.boardingCode, electronic, 'format and check-in sequence alone do not replace the original');
    await page.scan(paper);
    assert.match(page.form.querySelector('#code-status').textContent, /已补充 3 项/);
    assert.equal(draft.actualBoardingTime, '18:21');
    assert.equal(draft.ticketNumber, '1230000000001');
    assert.equal(draft.gate, 'A101');
    assert.equal(draft.terminal, 'T3');
    assert.deepEqual(draft.boardingCode, paper);
    await page.scan(electronic);
    assert.deepEqual(draft.boardingCode, paper, 'a sparser code leaves the collected code untouched');
    assert.equal(draft.actualBoardingTime, '18:21');
  } finally { page.dispose(); }
});

test('rescan rejects another flight, allows cancellation, and persists individually reviewed changes', async () => {
  const original = createBoardingCode(values, 'QRCode');
  const draft = flight({ seatClass:'Y', airline:'中国国际航空', boardingCode:original, boardingCodeSource:'original',
    fieldSources:{departureDate:'barcode', seat:'barcode'} });
  const page = savedEditor(draft), before = structuredClone(draft);
  try {
    await page.scan(createBoardingCode({...values, flightNumber:'5678', date:'2026-11-18'}));
    assert.match(page.form.querySelector('#code-error').textContent, /已拒绝录入.*航班号.*出发日期/);
    assert.deepEqual(draft, before);
    const newer = createBoardingCode({...values, date:'2026-11-18', seat:'20C'});
    await page.scan(newer);
    for (const field of ['departureDate', 'seat']) assert.ok(page.form.querySelector(`[data-scan-conflict="${field}"]`));
    page.submit();
    assert.equal(page.saves, 0);
    page.form.querySelector('#code-cancel').click();
    assert.deepEqual(draft, before);

    const choose = (key, who) => page.form.querySelector(`[name="scan-${key}"][value="${who}"]`).click();
    await page.scan(newer);
    choose('departureDate', 'existing'); choose('seat', 'existing');
    page.form.querySelector('[data-scan-confirm]').click();
    assert.deepEqual(draft, before);

    await page.scan(newer);
    choose('departureDate', 'existing'); choose('seat', 'scanned');
    page.form.querySelector('[data-scan-confirm]').click();
    const [stored] = readArchive(archive([draft]));
    assert.equal(stored.seat, '20C');
    assert.equal(calendarDate(stored.departureDate), '2026-11-17');
    assert.deepEqual(stored.boardingCode, newer);
    assert.equal(page.form.elements.seat.readOnly, true);
    assert.match(page.form.querySelector('#code-consistency').textContent, /出发日期/);
  } finally { page.dispose(); }
});

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

test('generated codes update after edits, preserve adopted settings, and synchronously flush before saving',async()=>{
  const draft=flight({boardingCode:createBoardingCode(values),boardingCodeSource:'generated'}),page=editor(draft);
  try{
    page.set('seat','20C');
    await new Promise(resolve=>setTimeout(resolve,180));assert.equal(readBoardingCode(draft.boardingCode).seat,'20C');assert.equal(page.form.querySelector('#code-consistency').hidden,true);
    page.set('service','CA5678');page.set('departureDate','2024-12-31');page.set('pnr','XYZ789');page.submit();assert.equal(page.saves,1);
    const read=readBoardingCode(draft.boardingCode);assert.equal(read.service,'CA5678');assert.equal(read.dayOfYear,366);assert.equal(read.pnr,'XYZ789');assert.equal(read.status,'3');assert.equal(read.cabin,'S');assert.equal(read.sequence,'00025');
    page.set('seatClass','Z');page.set('seat','30A');page.submit();assert.equal(readBoardingCode(draft.boardingCode).cabin,'Z','the generated code follows the main booking code');
  }finally{page.dispose();}
});

test('missing or invalid barcode data allow saving without a stale code, and correcting them regenerates it',()=>{
  const draft=flight({boardingCode:createBoardingCode(values),boardingCodeSource:'generated'}),page=editor(draft);
  try{
    page.set('pnr','');page.submit();assert.equal(page.saves,1);assert.equal(draft.boardingCode,'');assert.equal(draft.boardingCodeSource,'');
    assert.equal(page.form.querySelector('#editor-error').hidden,true);assert.equal(page.form.querySelector('[data-bcbp="sequence"]').value,'00025');
    page.set('pnr','TOOLONGPNR');page.submit();assert.equal(page.saves,2);assert.equal(draft.boardingCode,'');
    page.set('pnr','XYZ789');page.submit();assert.equal(page.saves,3);assert.equal(readBoardingCode(draft.boardingCode).pnr,'XYZ789');
  }finally{page.dispose();}
});

test('automatic regeneration retains explicit operating flights and a disposed editor cannot change a ticket',async()=>{
  const draft=flight({boardingCode:createBoardingCode(values),boardingCodeSource:'generated',boardingCodeOperatingFlight:'AA45A'}),page=editor(draft);
  page.set('service','BA123');page.set('seat','20C');page.submit();assert.equal(readBoardingCode(draft.boardingCode).service,'AA45A');
  const before=structuredClone(draft.boardingCode);page.set('seat','30A');page.dispose();await new Promise(resolve=>setTimeout(resolve,180));assert.deepEqual(draft.boardingCode,before);
});

test('scanning fills and locks decoded facts and enables manual editing and generation after removing the original',async()=>{
  const code = createBoardingCode(values), draft = flight({ passenger: '默认姓名', pnr: 'MYPNR', seat: '20C',
    seatClass: 'M', airline: '手动航司', lockedFields: ['pnr', 'seatClass', 'airline'] });
  const page = editor(draft, { loadRebuilder: async () => async (_file, type) => {
    assert.equal(type, 'flight');
    return { codes: [{ data: code, format: code.format }], issues: [] };
  } });
  try{
    const photo=page.form.querySelector('#code-photo');Object.defineProperty(photo,'files',{value:[new Blob(['fixture'])]});photo.dispatchEvent(new page.dom.window.Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(draft.passenger,'DOE/JANE');assert.equal(draft.pnr,'ABC123');assert.equal(page.form.querySelector('[data-bcbp-fields]').disabled,true);
    assert.equal(draft.seatClass,'Y');assert.equal(draft.airline,'中国国际航空');assert.equal(page.form.elements.passenger.readOnly,true);assert.equal(page.form.elements.pnr.readOnly,true);
    assert.equal(draft.seat, '12A');
    assert.equal(page.form.elements.seat.value, '12A');
    assert.equal(page.form.elements.seat.readOnly, true);
    assert.deepEqual(draft.boardingCode, code);
    assert.equal(page.form.querySelector('canvas,[type="range"]:not([data-code-zoom-slider])'), null);
    assert.match(page.form.querySelector('#code-status').textContent, /PDF417/);
    const before=structuredClone(draft.boardingCode);page.submit();assert.deepEqual(draft.boardingCode,before);
    page.form.querySelector('#code-remove').click();assert.equal(page.form.querySelector('[data-bcbp-fields]').disabled,false);
    assert.equal(page.form.elements.passenger.readOnly,false);assert.equal(page.form.elements.pnr.readOnly,false);
    assert.equal(page.form.querySelector('[data-bcbp="sequence"]').value,'');
    page.submit();assert.equal(draft.boardingCode,'');
  }finally{page.dispose();}
});
