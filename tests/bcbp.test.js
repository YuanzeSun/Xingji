import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {prepareZXingModule,readBarcodes} from 'zxing-wasm/reader';
import {encodeBCBP,createBoardingCode,boardingCodeDefaults,BCBP_FORMATS} from '../src/bcbp.js';
import {symbolImage} from '../src/barcode-symbols.js';
import {codeBytes,symbolFromCodeData} from '../src/barcode-data.js';
import {createRecord,archive,readArchive,csv} from '../src/model.js';
import {parseCSV} from '../src/importers.js';
import {ticketCodeEditor,bindTicketCodeEditor} from '../src/code-editor.js';
import {DEMO_BOARDING_CODE} from '../src/demo-boarding-code.js';

const values=()=>({passenger:'DESMARAIS/LUC',pnr:'ABC123',origin:'YUL',destination:'FRA',carrier:'AC',flightNumber:'834',date:'2009-08-14',cabin:'F',seat:'1A',sequence:'25',status:'1',electronic:'E'});
const flight=extra=>createRecord({type:'flight',template:'air-boarding-pass',passenger:'DESMARAIS/LUC',pnr:'ABC123',origin:'YUL',destination:'FRA',service:'AC834',departureDate:'2009-08-14',seat:'1A',seatClass:'F',...extra});

test('single-leg mandatory BCBP matches fixed-width reference fields, handles leap dates and never truncates values',()=>{
  const raw=encodeBCBP(values());
  assert.equal(raw,'M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A00025100');assert.equal(raw.length,60);
  assert.equal(encodeBCBP({...values(),date:'2024-12-31'}).slice(44,47),'366');
  assert.equal(encodeBCBP({...values(),carrier:'u2',flightNumber:'12a',seat:'INF',sequence:'A12'}).slice(36,44),'U2 0012A');
  assert.equal(encodeBCBP({...values(),electronic:''})[22],' ');
  assert.equal(encodeBCBP({...values(),electronic:undefined})[22],' ');
  for(const [key,value] of [['passenger','姓名'],['passenger','SURNAME/GIVENNAMETOOLONG'],['pnr','ABCD1234'],['origin','PE'],['flightNumber','12345'],['date','2025-02-29'],['date','2024'],['seat','12345A'],['sequence','123456'],['status',''],['cabin','K1']])assert.throws(()=>encodeBCBP({...values(),[key]:value}));
});

test('new generators default to no electronic marker and economy Y while saved codes retain their values',()=>{
  const defaults=boardingCodeDefaults(flight({seatClass:''}));
  assert.equal(defaults.electronic,'');assert.equal(defaults.cabin,'Y');
  for(const code of ['S','M','Z','J'])assert.equal(boardingCodeDefaults(flight({seatClass:code})).cabin,code);
  assert.equal(boardingCodeDefaults(flight({seatClass:'头等舱'})).cabin,'F');
  for(const electronic of ['','E']){
    const saved=boardingCodeDefaults(flight({boardingCode:createBoardingCode({...values(),electronic})}));
    assert.equal(saved.electronic,electronic);assert.equal(saved.cabin,'F');
  }
});

test('all generated symbologies decode to the complete BCBP and survive metadata exports',async()=>{
  await prepareZXingModule({overrides:{wasmBinary:await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')},fireImmediately:true});
  for(const format of BCBP_FORMATS){
    const code=createBoardingCode(values(),format),image=symbolImage(symbolFromCodeData(code),'flight');
    const result=(await readBarcodes(image,{formats:[format],textMode:'Plain',tryHarder:true})).find(result=>result.isValid);
    assert.ok(result,format);assert.equal(result.text,encodeBCBP(values()));assert.deepEqual(result.bytes,codeBytes(code.rawBytes));
    assert.equal(result.symbologyIdentifier,code.symbologyIdentifier);
    const record=flight({boardingCode:code});assert.deepEqual(readArchive(archive([record]))[0].boardingCode,code);assert.deepEqual(parseCSV(csv([record]))[0].boardingCode,code);
    assert.equal(createRecord({...record,deleted:true}).boardingCode,'');
  }
});

test('expanded generator reuses the current ticket fields and keeps additional required fields separate',()=>{
  const draft=flight({boardingCode:DEMO_BOARDING_CODE});
  const shared=['passenger','pnr','origin','destination','service','departureDate','seat','seatClass'];
  const dom=new JSDOM(`<form>${shared.map(key=>`<input name="${key}" value="${key.endsWith('Date')?calendarDate(draft[key]):draft[key]}">`).join('')}${ticketCodeEditor(draft)}</form>`),form=dom.window.document.querySelector('form');let changes=0;
  const cleanup=bindTicketCodeEditor(form,draft,()=>changes++);
  const set=(key,value)=>{const input=form.querySelector(`[data-bcbp="${key}"]`);input.value=value;input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  try{
    assert.equal(form.querySelector('[data-bcbp="cabin"]'),null);assert.equal(form.querySelector('[data-bcbp="status"]').value,'');
    assert.equal(form.querySelector('[data-bcbp="electronic"]').value,'');assert.equal(form.querySelector('[data-bcbp="electronic"] option:checked').textContent,'无');
    assert.equal(form.querySelector('[data-bcbp-generate]').disabled,true);
    form.querySelector('[data-bcbp-generate]').click();assert.deepEqual(draft.boardingCode,DEMO_BOARDING_CODE);
    form.querySelector('#code-remove').click();changes=0;assert.equal(form.querySelector('[data-bcbp-generate]').disabled,false);
    form.querySelector('[data-bcbp-generate]').click();assert.equal(draft.boardingCode,'');assert.ok(form.querySelector('#code-error').textContent);
    assert.equal(form.querySelector('details[data-bcbp-generator]'),null);
    for(const key of ['passenger','pnr','origin','destination','flightNumber','date','seat'])assert.equal(form.querySelector(`[data-bcbp="${key}"]`),null);
    for(const key of ['status','sequence','format']){const mark=form.querySelector(`[data-bcbp="${key}"]`).closest('.field').querySelector('.barcode-required-mark');assert.ok(mark);assert.equal(mark.getAttribute('aria-label'),'生成条码必填');}
    assert.match(form.querySelector('.barcode-required-legend').textContent,/生成条码必填/);
    form.elements.seatClass.value='F';set('status','1');set('sequence','25');set('electronic','E');form.elements.passenger.value='desmarais/luc';
    form.querySelector('[data-bcbp-generate]').click();
    assert.equal(changes,1);assert.equal(String.fromCharCode(...codeBytes(draft.boardingCode.rawBytes)),encodeBCBP(values()));assert.match(form.querySelector('#code-status').textContent,/已生成/);
    const defaults=boardingCodeDefaults(draft);assert.equal(defaults.cabin,'F');assert.equal(defaults.sequence,'00025');assert.equal(defaults.status,'1');
    form.elements.seatClass.value='Z';form.elements.seatClass.dispatchEvent(new dom.window.Event('input',{bubbles:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(String.fromCharCode(...codeBytes(draft.boardingCode.rawBytes))[47],'Z');
    form.elements.seatClass.value='F';form.elements.seatClass.dispatchEvent(new dom.window.Event('input',{bubbles:true}));form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    const saved=draft.boardingCode,beforeFailure=changes;form.elements.pnr.value='';form.querySelector('[data-bcbp-generate]').click();assert.deepEqual(draft.boardingCode,saved);assert.equal(changes,beforeFailure);
    form.elements.pnr.value='ABC123';form.elements.service.value='AC835';form.querySelector('[data-bcbp-generate]').click();
    assert.equal(String.fromCharCode(...codeBytes(draft.boardingCode.rawBytes)),encodeBCBP({...values(),flightNumber:'835'}));
    set('operatingFlight','ua34a');assert.equal(form.querySelector('[data-bcbp="operatingFlight"]').value,'UA34A');form.querySelector('[data-bcbp-generate]').click();
    assert.equal(String.fromCharCode(...codeBytes(draft.boardingCode.rawBytes)).slice(36,44),'UA 0034A');assert.equal(form.elements.service.value,'AC835');
    assert.doesNotMatch(ticketCodeEditor(createRecord()),/data-bcbp-generator/);
  }finally{cleanup();dom.window.close();}
});
