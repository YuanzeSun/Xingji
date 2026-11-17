import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {barcodeFieldLocked,refreshBarcodeFieldLocks} from '../src/barcode-fields.js';
import {createRecord,archive,readArchive} from '../src/model.js';
import {createBoardingCode} from '../src/bcbp.js';
import {applyLookupValues,markManualFields} from '../src/lookup-values.js';
import {applyProfileDefaults} from '../src/personal-profile.js';
import {seatClassField} from '../src/seat-class-field.js';

const record=()=>createRecord({type:'flight',template:'air-boarding-pass',origin:'PEK',destination:'SHA',service:'CA1234',departureDate:'2026-11-17',passenger:'张三',seat:'12A',seatClass:'Z',gate:'A101',boardingCodeSource:'original',boardingCode:createBoardingCode({passenger:'ZHANG/SAN',pnr:'ABC123',origin:'PEK',destination:'SHA',carrier:'CA',flightNumber:'1234',date:'2026-11-17',cabin:'Z',seat:'12A',sequence:'25',status:'1'}),fieldSources:{passenger:'barcode',origin:'barcode',destination:'barcode',service:'barcode',seat:'barcode',seatClass:'barcode',gate:'barcode'}});

test('barcode-derived fields stay protected against manual attribution, provider updates and profile defaults after reopening',()=>{
  const current=readArchive(archive([record()]))[0];
  assert.equal(barcodeFieldLocked(current,'passenger'),true);assert.equal(barcodeFieldLocked(current,'type'),true);assert.equal(barcodeFieldLocked(current,'departureDate'),false);
  applyLookupValues(current,{gate:'B9',departureTime:'08:00',passenger:'OTHER'},true,{kind:'flight-lookup'});
  assert.equal(current.gate,'A101');assert.equal(current.passenger,'张三');assert.equal(current.departureTime,'08:00');
  markManualFields(current,['passenger']);assert.equal(current.fieldSources.passenger,'barcode');
  const filled=applyProfileDefaults(current,{autoFill:true,chineseName:'王五',documents:[]},{previousProfile:{autoFill:true,chineseName:'张三',documents:[]}});
  assert.equal(filled.passenger,'张三');
});

test('readonly controls and the seat preset unlock only after the original code is removed',()=>{
  const current=record(),dom=new JSDOM('<form><label class="field"><span>交通方式</span><select name="type"><option value="flight">机票</option></select></label><label class="field"><span>姓名</span><input name="passenger"></label><label class="field"><span>日期</span><input type="date" name="departureDate"></label>'+seatClassField(current)+'</form>'),form=dom.window.document.querySelector('form');
  try{
    refreshBarcodeFieldLocks(form,current);
    assert.equal(form.elements.passenger.readOnly,true);assert.equal(form.elements.passenger.value,'张三');assert.equal(form.elements.type.disabled,true);assert.equal(form.querySelector('[data-seat-preset]').disabled,true);assert.equal(form.elements.departureDate.readOnly,false);
    assert.ok(form.querySelector('[data-source-locked]'));
    current.boardingCode='';current.boardingCodeSource='';refreshBarcodeFieldLocks(form,current);
    assert.equal(form.elements.passenger.readOnly,false);assert.equal(form.elements.type.disabled,false);assert.equal(form.querySelector('[data-seat-preset]').disabled,false);
  }finally{dom.window.close();}
});

test('self-generated codes leave their ticket fields editable',()=>{
  const current={...record(),boardingCodeSource:'generated'};
  for(const key of ['type','passenger','service','seat','seatClass','gate'])assert.equal(barcodeFieldLocked(current,key),false,key);
});
