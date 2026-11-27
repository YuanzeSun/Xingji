import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readBCBP} from '../src/bcbp-reader.js';
import {readBoardingCode} from '../src/bcbp.js';
import {flightNameLanguage} from '../src/flight-passenger.js';
import {boardingPresentation} from '../src/boarding-language.js';
import {profilePassengerName,applyProfileDefaults} from '../src/personal-profile.js';
import {createRecord} from '../src/model.js';
import {ticketCodeEditor,bindTicketCodeEditor} from '../src/code-editor.js';
import {boardingGeneratorMarkup} from '../src/boarding-code-generator.js';
import {BOARDING_SHARED_FIELDS,refreshGeneratedCode} from '../src/boarding-code-state.js';
import {taggedBoardingPayload} from './helpers/tagged-boarding-code.js';
import {ticketSVG} from '../src/tickets.js';

const profile={chineseName:'张三',lastName:'ZHANG',firstName:'SAN',documents:[{id:'id',type:'national-id',number:'000000200001011234'},{id:'passport',type:'passport',number:'E00000000'}]};
const flight=extra=>createRecord({type:'flight',template:'air-boarding-pass',origin:'PEK',destination:'SHA',service:'CA1234',departureDate:'2026-05-18',passenger:'张三',pnr:'ABC123',seat:'12A',...extra});

test('the reader extracts the ticket number and individual airline tags without inventing a year',()=>{
  const payload=taggedBoardingPayload(),raw=String.fromCharCode(...new TextEncoder().encode(payload));
  for(const value of [payload,raw]){
    const read=readBCBP(value);
    assert.equal(read.passenger,'ZHANGSAN');assert.equal(read.passengerChinese,'张三');assert.equal(read.ticketNumber,'1230000000001');
    assert.equal(read.gate,'A101');assert.equal(read.boardingTime,'18:21');
    assert.equal(read.cabin,'Z');assert.equal(read.departureDate,undefined);
  }
  const partial = readBCBP(payload.replace('#91北京#92上海',''));
  assert.equal(partial.passengerChinese,'张三');
  assert.equal(partial.gate,'A101');
  assert.equal(partial.boardingTime,'18:21');
  assert.equal(readBCBP(payload.replace('#9418:21','#9429:90')).boardingTime,undefined);
});

test('profile names follow domestic and international routes without replacing manual corrections',()=>{
  const unknown={type:'flight'},domestic={...unknown,origin:'PEK',destination:'SHA'},international={...domestic,destination:'LHR'};
  assert.equal(flightNameLanguage(domestic),'zh');assert.equal(flightNameLanguage(international),'en');
  assert.equal(profilePassengerName(domestic,profile),'张三');
  for(const route of [international,{...domestic,origin:'LHR',destination:'MAN'},{...domestic,destination:'HKG'}]){
    assert.equal(profilePassengerName(route,profile),'ZHANG/SAN');
  }
  const initial=applyProfileDefaults(unknown,profile);
  const cn=applyProfileDefaults({...initial,...domestic},profile,{previousRecord:initial});
  assert.equal(cn.passenger,'张三');assert.equal(cn.identity,'000000200001011234');
  const en=applyProfileDefaults({...cn,...international},profile,{previousRecord:cn});
  assert.equal(en.passenger,'ZHANG/SAN');assert.equal(en.identity,'E00000000');
  const manual=applyProfileDefaults({...cn,...international,passenger:'其他旅客',identity:'',fieldSources:{identity:'manual'}},profile,{previousRecord:cn,passengerEdited:true});
  assert.equal(manual.passenger,'其他旅客');assert.equal(manual.identity,'');
});

test('a domestic Chinese ticket can generate an English-name BCBP without changing its printed Chinese name',()=>{
  const draft=flight(),dom=new JSDOM('<form>'+BOARDING_SHARED_FIELDS.map(key=>`<input name="${key}" value="${key.endsWith('Date')?calendarDate(draft[key]):draft[key]}">`).join('')+ticketCodeEditor(draft)+boardingGeneratorMarkup(draft)+'</form>'),form=dom.window.document.querySelector('form');
  const cleanup=bindTicketCodeEditor(form,draft,()=>{},{profile});
  try{
    assert.equal(form.querySelector('[data-bcbp="passenger"]').value,'ZHANG/SAN');assert.ok(form.querySelector('[data-bcbp-passenger-field] .barcode-required-mark'));
    form.querySelector('[data-bcbp="sequence"]').value='42';form.querySelector('[data-bcbp="status"]').value='1';form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
    assert.equal(form.querySelector('#code-error').textContent,'');assert.equal(draft.passenger,'张三');assert.equal(readBoardingCode(draft.boardingCode).passenger,'ZHANGSAN');
    assert.equal(boardingPresentation(draft).passenger,'张三');assert.equal(boardingPresentation({...draft,destination:'LHR',destinationCode:'LHR'}).passenger,'ZHANGSAN');
    draft.seat='20C';assert.equal(refreshGeneratedCode(draft),true);assert.equal(readBoardingCode(draft.boardingCode).seat,'20C');assert.equal(readBoardingCode(draft.boardingCode).passenger,'ZHANGSAN');
    const svg=new JSDOM(ticketSVG(draft),{contentType:'image/svg+xml'});assert.match(svg.window.document.querySelector('[data-boarding-section="main"]').textContent,/张三/);svg.window.close();
  }finally{cleanup();dom.window.close();}
});

test('a different Chinese passenger never inherits the profile owner’s English name',()=>{
  const draft=flight({passenger:'其他旅客'}),dom=new JSDOM('<form>'+ticketCodeEditor(draft)+boardingGeneratorMarkup(draft)+'</form>'),form=dom.window.document.querySelector('form');
  const cleanup=bindTicketCodeEditor(form,draft,()=>{},{profile});
  assert.equal(form.querySelector('[data-bcbp="passenger"]').value,'');cleanup();dom.window.close();
});
