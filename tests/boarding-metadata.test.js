import test from 'node:test';
import assert from 'node:assert/strict';
import {readBCBP} from '../src/bcbp-reader.js';
import {readBoardingCode} from '../src/bcbp.js';
import {boardingScanRecords} from '../src/boarding-pass.js';
import {createRecord,archive,readArchive,applyImport} from '../src/model.js';
import {barcodeFieldLocked} from '../src/barcode-fields.js';
import {boardingJourneyMarkup,boardingMetadataDetails} from '../src/boarding-details.js';
import {scanCandidate,createScanConsensus} from '../src/scan-engine.js';
import {calendarDate} from '../src/journey-date.js';
import {ticketSVG} from '../src/tickets.js';
import {multilegCode,multilegPayload} from './helpers/multileg-boarding-code.js';

test('standard optional sections and up to four legs remain separate with strict length validation',()=>{
  for(const count of [1,2,3,4]){
    const read=readBCBP(multilegPayload({count}));assert.equal(read.legCount,count);assert.equal(read.legs.length,count);
    assert.equal(read.legs[0].ticketNumber,'1230000000001');assert.equal(read.legs[0].frequentFlyerNumber,'00000123456789');assert.equal(read.legs[0].freeBaggageAllowance,'20K');assert.equal(read.legs[0].marketingCarrier,'LH');
    assert.deepEqual(read.legs[0].baggageSeries,[{number:'0123456789',count:2}]);assert.equal(read.legs[0].recordedBoardingTime,'18:21');
    if(count>1){assert.equal(read.legs[1].service,'UA857');assert.equal(read.legs[1].dayOfYear,1);assert.equal(read.legs[1].ticketNumber,'1230000000002');assert.equal(read.legs[1].recordedBoardingTime,undefined);assert.equal(read.legs[1].gate,undefined);}
  }
  const payload=multilegPayload();assert.equal(readBCBP(payload.slice(0,-5)),null);assert.equal(readBCBP(payload.replace(/^M2/,'M4')),null);assert.equal(readBCBP(payload.slice(0,58)+'FF'+payload.slice(60)),null);
});

test('one barcode creates distinct linked records, preserves unknown years and never copies OCR times to another leg',()=>{
  const code=multilegCode(),rows=boardingScanRecords('fixture',{boardingCodes:[code],boardingTime:'17:30'});
  assert.equal(rows.length,2);assert.equal(rows[0].boardingLegIndex,'0');assert.equal(rows[1].boardingLegIndex,'1');assert.equal(rows[1].departureDate.year,null);assert.equal(rows[1].departureDate.dayOfYear,1);assert.equal(rows[1].departureTime,'');assert.equal(rows[1].boardingTime,'');assert.equal(rows[1].actualBoardingTime,'');
  assert.equal(rows[0].actualBoardingTime,'18:21');assert.equal(rows[0].boardingTime,'');assert.equal(rows[0].departureDate.year,null);assert.equal(rows[0].checkedBaggageCount,'2');assert.equal(rows[0].baggageTagNumbers,'0123456789–0123456790');assert.equal(rows[1].frequentFlyerCarrier,'CA');
  for(const key of ['actualBoardingTime','checkedBaggageCount','freeBaggageAllowance','frequentFlyerNumber','marketingCarrier'])assert.equal(barcodeFieldLocked(rows[0],key),true,key);
  const second=createRecord({...rows[1],departureDate:{year:2025,dayOfYear:1}});assert.equal(calendarDate(second.departureDate),'2025-01-01');assert.equal(readBoardingCode(second.boardingCode,second.boardingLegIndex).service,'UA857');
  assert.equal(applyImport(rows,rows).records.length,2);assert.equal(readArchive(archive([second]))[0].frequentFlyerNumber,second.frequentFlyerNumber);
  assert.match(boardingJourneyMarkup(rows[0],rows),new RegExp('data-id="'+rows[1].id+'"'));assert.ok(boardingMetadataDetails(second).some(([key])=>key==='marketingCarrier'));
  assert.equal(ticketSVG({...rows[0],actualBoardingTime:'22:00',frequentFlyerNumber:'OTHER'}),ticketSVG(rows[0]));
  assert.throws(()=>createRecord({...second,boardingLegIndex:'3'}),/航段/);
  assert.throws(()=>createRecord({type:'flight',template:'air-boarding-pass',checkedBaggageCount:'-1'}),/行李件数/);
  assert.throws(()=>createRecord({type:'flight',template:'air-boarding-pass',checkedBaggageCount:'1.5'}),/行李件数/);
  assert.equal(createRecord({type:'flight',template:'air-boarding-pass',checkedBaggageCount:'2997'}).checkedBaggageCount,'2997');
});

test('camera consensus accepts one confirmed multileg barcode and retains all leg candidates',()=>{
  const code=multilegCode(),candidate=scanCandidate('',90,'flight',{boardingCodes:[code]});
  assert.equal(candidate.boardingCandidates.length,2);const consensus=createScanConsensus();assert.equal(consensus.observe(candidate,90),null);assert.equal(consensus.observe(candidate,90).boardingCandidates[1].service,'UA857');
});
