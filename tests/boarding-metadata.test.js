import test from 'node:test';
import assert from 'node:assert/strict';
import {readBCBP} from '../src/bcbp-reader.js';
import {readBoardingCode} from '../src/bcbp.js';
import {createRecord,archive,readArchive,mergeBackupRecords} from '../src/model.js';
import {ticketFieldLocked} from '../src/barcode-fields.js';
import {boardingJourneyMarkup,boardingMetadataDetails} from '../src/boarding-details.js';
import {boardingMetadataValues} from '../src/boarding-metadata.js';
import {markFieldSources} from '../src/field-sources.js';
import {calendarDate} from '../src/journey-date.js';
import {ticketDimensions,ticketSVG} from '../src/tickets.js';
import {multilegCode,multilegPayload} from './helpers/multileg-boarding-code.js';

test('standard optional sections and up to four legs remain separate with strict length validation',()=>{
  for(const count of [1,2,3,4]){
    const read=readBCBP(multilegPayload({count}));assert.equal(read.legCount,count);assert.equal(read.legs.length,count);
    assert.equal(read.legs[0].ticketNumber,'1230000000001');assert.equal(read.legs[0].frequentFlyerNumber,'00000123456789');assert.equal(read.legs[0].marketingCarrier,'LH');
    assert.deepEqual(read.legs[0].baggageSeries,[{number:'0123456789',count:2}]);assert.equal(read.legs[0].recordedBoardingTime,'18:21');
    if(count>1){assert.equal(read.legs[1].service,'UA857');assert.equal(read.legs[1].dayOfYear,1);assert.equal(read.legs[1].ticketNumber,'1230000000002');assert.equal(read.legs[1].recordedBoardingTime,undefined);assert.equal(read.legs[1].gate,undefined);}
  }
  const payload=multilegPayload();assert.equal(readBCBP(payload.slice(0,-5)),null);assert.equal(readBCBP(payload.replace(/^M2/,'M4')),null);assert.equal(readBCBP(payload.slice(0,58)+'FF'+payload.slice(60)),null);
});

test('individually archived legs retain their barcode metadata and display links to one another',()=>{
  const code = multilegCode();
  const rows = readBoardingCode(code).legs.map((leg, index) => {
    const metadata = boardingMetadataValues(leg);
    const values = {
      type: 'flight', template: 'air-boarding-pass', service: leg.service, pnr: leg.pnr,
      origin: leg.originCode, destination: leg.destinationCode,
      departureDate: { year: null, dayOfYear: leg.dayOfYear },
      boardingCode: code, boardingCodeSource: 'original', boardingLegIndex: String(index), ...metadata
    };
    markFieldSources(values, Object.keys(metadata), 'barcode');
    return createRecord(values);
  });
  assert.equal(rows[0].actualBoardingTime,'18:21');assert.equal(rows[0].baggageTagNumbers,'0123456789–0123456790');
  for(const key of ['actualBoardingTime','checkedBaggageCount','frequentFlyerNumber','marketingCarrier'])assert.equal(ticketFieldLocked(rows[0],key),true,key);
  assert.equal(rows[0].checkedBaggageWeight, '');
  assert.equal(rows[1].checkedBaggageCount, '');
  assert.equal(rows[1].baggageTagNumbers, '');
  assert.doesNotMatch(ticketSVG(rows[1]), /data-boarding-baggage-sticker/);
  const second=createRecord({...rows[1],departureDate:{year:2025,dayOfYear:1}});assert.equal(calendarDate(second.departureDate),'2025-01-01');assert.equal(readBoardingCode(second.boardingCode,second.boardingLegIndex).service,'UA857');
  assert.equal(mergeBackupRecords(rows,rows).length,2);assert.equal(readArchive(archive([second]))[0].frequentFlyerNumber,second.frequentFlyerNumber);
  assert.match(boardingJourneyMarkup(rows[0],rows),new RegExp('data-id="'+rows[1].id+'"'));assert.ok(boardingMetadataDetails(second).some(([key])=>key==='marketingCarrier'));
  assert.equal(ticketSVG({...rows[0],actualBoardingTime:'22:00',frequentFlyerNumber:'OTHER'}),ticketSVG(rows[0]));
  assert.match(ticketSVG(rows[0]), /data-boarding-baggage-sticker="true"/);
  assert.match(ticketSVG(rows[0]), /0123456789–0123456790/);
  const withoutBaggage = { ...rows[0], baggageTagNumbers: '', checkedBaggageCount: '' };
  assert.doesNotMatch(ticketSVG(withoutBaggage), /data-boarding-baggage-sticker/);
  assert.ok(ticketDimensions(rows[0]).height > ticketDimensions(withoutBaggage).height);
  assert.match(ticketSVG(rows[0]), /data-baggage-tag-code="reencoded"/);
  assert.match(ticketSVG(rows[0]), /BAG: 02\/</);
  const brandedSticker = ticketSVG({ ...rows[0], airline: '中国国际航空' }).split('data-boarding-baggage-sticker')[1];
  assert.match(brandedSticker, /data-baggage-airline-logo="true".*?[\s\S]*AIR CHINA[\s\S]*中国国际航空/);
  assert.throws(()=>createRecord({...second,boardingLegIndex:'3'}),/航段/);
  assert.throws(()=>createRecord({type:'flight',template:'air-boarding-pass',checkedBaggageCount:'-1'}),/行李件数/);
  assert.throws(()=>createRecord({type:'flight',template:'air-boarding-pass',checkedBaggageCount:'1.5'}),/行李件数/);
  assert.equal(createRecord({type:'flight',template:'air-boarding-pass',checkedBaggageCount:'2997'}).checkedBaggageCount,'2997');
});

test('baggage tags align the number to its barcode and print the route to the final airport', () => {
  const base = createRecord({ type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'HND',
    baggageTagNumbers: '0123456789', checkedBaggageCount: '01', checkedBaggageWeight: '9' });
  assert.equal(base.checkedBaggageCount, '1');
  const direct = ticketSVG(base);
  assert.match(direct, /TO: HND</);
  assert.match(direct, /VIA:</);
  assert.match(direct, /BAG: 01\/9</);
  assert.match(direct, /<text x="133\.5"[^>]*text-anchor="middle"[^>]*>0123456789<\/text>/);
  assert.match(ticketSVG({ ...base, destinationCode: '', destination: '自填机场' }), /TO: 自填机场</);
  assert.throws(() => createRecord({ ...base, checkedBaggageWeight: '-9' }), /总重/);
});
