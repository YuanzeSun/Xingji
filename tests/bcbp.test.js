import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {prepareZXingModule,readBarcodes} from 'zxing-wasm/reader';
import {encodeBCBP,createBoardingCode,boardingCodeDefaults,BCBP_FORMATS} from '../src/bcbp.js';
import { readBCBP } from '../src/bcbp-reader.js';
import {symbolImage} from '../src/barcode-symbols.js';
import {codeBytes,symbolFromCodeData} from '../src/barcode-data.js';
import {createRecord,archive,readArchive} from '../src/model.js';
import {ticketCodeEditor,bindTicketCodeEditor} from '../src/code-editor.js';
import {boardingGeneratorMarkup} from '../src/boarding-code-generator.js';
import {DEMO_BOARDING_CODE} from '../src/demo-boarding-code.js';
import {bindUppercaseInputs} from '../src/uppercase-input.js';

const values=()=>({passenger:'DESMARAIS/LUC',pnr:'ABC123',origin:'YUL',destination:'FRA',carrier:'AC',flightNumber:'834',date:'2009-08-14',cabin:'F',seat:'1A',sequence:'25',status:'1',electronic:'E'});
const flight=extra=>createRecord({type:'flight',template:'air-boarding-pass',passenger:'DESMARAIS/LUC',pnr:'ABC123',origin:'YUL',destination:'FRA',service:'AC834',departureDate:'2009-08-14',seat:'1A',seatClass:'F',boardingCodeSource:'original',boardingLegIndex:'0',...extra});

test('single-leg BCBP round-trips fixed-width fields and rejects invalid values or payloads',()=>{
  const raw=encodeBCBP(values());
  assert.equal(raw,'M1DESMARAIS/LUC       EABC123 YULFRAAC 0834 226F001A00025100');assert.equal(raw.length,60);
  const decoded = readBCBP(raw), fields = values();
  assert.deepEqual([decoded.passenger, decoded.pnr, decoded.originCode, decoded.destinationCode, decoded.carrier,
    decoded.service, decoded.dayOfYear, decoded.cabin, decoded.seat],
    [fields.passenger, fields.pnr, fields.origin, fields.destination, fields.carrier, 'AC834', 226, 'F', '1A']);
  assert.equal(encodeBCBP({...values(),date:'2024-12-31'}).slice(44,47),'366');
  assert.equal(encodeBCBP({...values(),carrier:'u2',flightNumber:'12a',seat:'INF',sequence:'A12'}).slice(36,44),'U2 0012A');
  assert.equal(encodeBCBP({...values(),electronic:''})[22],' ');
  assert.equal(encodeBCBP({...values(),electronic:undefined})[22],' ');
  for(const [key,value] of [['passenger','姓名'],['passenger','SURNAME/GIVENNAMETOOLONG'],['pnr','ABCD1234'],['origin','PE'],['flightNumber','12345'],['date','2025-02-29'],['date','2024'],['seat','12345A'],['sequence','123456'],['status',''],['cabin','K1']])assert.throws(()=>encodeBCBP({...values(),[key]:value}));
  for (const malformed of ['https://example.com', raw.slice(0, 59), 'M2' + raw.slice(2),
    raw.slice(0, 58) + 'FF', raw.slice(0, 44) + '999' + raw.slice(47), raw.slice(0, 2) + '张' + raw.slice(3)]) {
    assert.equal(readBCBP(malformed), null);
  }
});

test('new generators default to check-in status 1, no electronic marker and economy Y while saved codes retain their values',()=>{
  const defaults=boardingCodeDefaults(flight({seatClass:''}));
  assert.equal(defaults.electronic,'');assert.equal(defaults.cabin,'Y');assert.equal(defaults.status,'1');
  for(const code of ['S','M','Z','J'])assert.equal(boardingCodeDefaults(flight({seatClass:code})).cabin,code);
  assert.equal(boardingCodeDefaults(flight({seatClass:'头等舱'})).cabin,'F');
  for(const electronic of ['','E']){
    const saved=boardingCodeDefaults(flight({boardingCode:createBoardingCode({...values(),electronic,status:'0'})}));
    assert.equal(saved.electronic,electronic);assert.equal(saved.cabin,'F');assert.equal(saved.status,'0');
  }
});

test('all generated symbologies decode to the complete BCBP and survive metadata exports',async()=>{
  await prepareZXingModule({overrides:{wasmBinary:await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')},fireImmediately:true});
  for(const format of BCBP_FORMATS){
    const code=createBoardingCode(values(),format),image=symbolImage(symbolFromCodeData(code),'flight');
    const result=(await readBarcodes(image,{formats:[format],textMode:'Plain',tryHarder:true})).find(result=>result.isValid);
    assert.ok(result,format);assert.equal(result.text,encodeBCBP(values()));assert.deepEqual(result.bytes,codeBytes(code.rawBytes));
    assert.equal(result.symbologyIdentifier,code.symbologyIdentifier);
    const record=flight({boardingCode:code});assert.deepEqual(readArchive(archive([record]))[0].boardingCode,code);
    assert.equal(createRecord({...record,deleted:true}).boardingCode,'');
  }
});

test('the generator gets shared fields from the ticket and creates or updates the preview automatically',async()=>{
  const draft=flight({boardingCode:DEMO_BOARDING_CODE});
  const shared=['passenger','pnr','origin','destination','service','departureDate','seat','seatClass'];
  const dom=new JSDOM(`<form>${shared.map(key=>`<input name="${key}" value="${key.endsWith('Date')?calendarDate(draft[key]):draft[key]}">`).join('')}${ticketCodeEditor(draft)}${boardingGeneratorMarkup(draft)}</form>`),form=dom.window.document.querySelector('form');
  bindUppercaseInputs(form);
  const cleanup=bindTicketCodeEditor(form,draft,()=>{});
  const set=(key,value)=>{const input=form.querySelector(`[data-bcbp="${key}"]`) || form.elements[key];input.value=value;input.dispatchEvent(new dom.window.InputEvent('input',{bubbles:true}));};
  const submit=()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  const waitForPreview=()=>new Promise(resolve=>setTimeout(resolve,200));
  try{
    assert.equal(form.querySelector('[data-bcbp="cabin"]'),null);
    assert.equal(form.querySelector('[data-bcbp="electronic"] option:checked').textContent,'无');
    assert.equal(form.querySelector('[data-bcbp-generate]'),null);
    assert.equal(form.querySelector('[data-bcbp-fields]').disabled,true);
    submit();assert.deepEqual(draft.boardingCode,DEMO_BOARDING_CODE);
    form.querySelector('#code-remove').click();
    assert.equal(form.querySelector('[data-bcbp-fields]').disabled,false);
    assert.equal(draft.boardingCode,'');
    for(const key of ['passenger','pnr','origin','destination','flightNumber','date','seat'])assert.equal(form.querySelector(`[data-bcbp="${key}"]`),null);
    for(const key of ['status','sequence','format']){
      const input=form.querySelector(`[data-bcbp="${key}"]`);
      assert.equal(input.closest('.field').querySelector('.barcode-required-mark').getAttribute('aria-label'),'生成条码必填');
      assert.equal(input.required,false);
    }
    assert.equal(form.querySelector('.barcode-required-legend'), null);
    assert.equal(form.querySelector('[data-bcbp="status"]').value,'1');
    const payload=()=>String.fromCharCode(...codeBytes(draft.boardingCode.rawBytes));
    set('sequence','25');submit();assert.equal(payload(),encodeBCBP({...values(),electronic:''}));
    set('electronic','E');set('passenger','desmarais/luc');set('status','3');submit();
    assert.equal(payload(),encodeBCBP({...values(),status:'3'}));
    set('status','1');
    await waitForPreview();
    assert.equal(payload(),encodeBCBP(values()));
    assert.match(form.querySelector('#code-status').textContent,/自动生成/);
    assert.equal(form.querySelector('#code-remove').hidden,true);
    set('seatClass','Z');submit();assert.equal(payload()[47],'Z');
    set('seatClass','F');set('pnr','');await waitForPreview();assert.equal(draft.boardingCode,'');
    set('pnr','ABC123');set('service','AC835');submit();
    assert.equal(payload(),encodeBCBP({...values(),flightNumber:'835'}));
    set('operatingFlight','ua34a');submit();
    assert.equal(form.querySelector('[data-bcbp="operatingFlight"]').value,'UA34A');
    assert.equal(payload().slice(36,44),'UA 0034A');assert.equal(form.elements.service.value,'AC835');
    assert.doesNotMatch(ticketCodeEditor(createRecord()),/data-bcbp-generator/);
  }finally{cleanup();dom.window.close();}
});
