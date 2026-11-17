import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {demoRecords} from '../src/demo.js';
import {railJourneyMatches,railJourneyRange} from '../src/rail-journey.js';
import {railRouteMatches} from '../src/rail-route-snapshot.js';
import {loadRailwayNetwork} from '../src/railway-network.js';
import {railJourneyMarkup} from '../src/rail-journey-ui.js';
import {readBoardingCode} from '../src/bcbp.js';
import {validateTicketForm} from '../src/ticket-form.js';
import {journeyStatistics} from '../src/statistics-model.js';

test('four sample journeys stay recent across month and year boundaries while historical ticket styles keep their dates',()=>{
  for(const today of ['2026-11-17','2027-01-02']){
    const rows=demoRecords(today),recent=rows.filter(record=>Date.parse(today)-Date.parse(calendarDate(record.departureDate))>0 && Date.parse(today)-Date.parse(calendarDate(record.departureDate))<=3*86400000);
    assert.equal(rows.length,7);assert.equal(recent.length,4);assert.equal(recent.filter(record=>record.type==='rail').length,2);assert.equal(recent.filter(record=>record.type==='flight').length,2);
    assert.equal(calendarDate(rows.find(record=>record.template==='rail-blue').departureDate),'2018-10-01');assert.equal(calendarDate(rows.find(record=>record.template==='rail-red-classic').departureDate),'2014-07-12');assert.equal(calendarDate(rows.find(record=>record.template==='rail-red').departureDate),'2017-09-10');
    for(const record of rows){assert.doesNotThrow(()=>validateTicketForm(record));assert.ok(calendarDate(record.departureDate)<=calendarDate(record.arrivalDate));for(const key of ['passenger','identity','origin','destination','departureTime','arrivalTime','price','gate','ticketNumber','orderNumber','departureZone','arrivalZone'])assert.ok(record[key],record.id+' '+key);}
    assert.equal(journeyStatistics(rows,{dateTo:today}).flight,2);assert.equal(journeyStatistics(rows,{dateTo:today}).rail,5);
  }
});

test('every sample train has an offline route with line names, a complete timetable and applicable rolling-stock fields',async()=>{
  const rows=demoRecords('2026-11-17').filter(record=>record.type==='rail');
  assert.deepEqual(rows.map(record=>record.service),['G21','G7602','Z83','G6203','C2021']);
  for(const record of rows){
    assert.equal(railRouteMatches(record),true,record.service);assert.equal(railJourneyMatches(record),true,record.service);
    assert.ok(record.railRoute.lineLabels?.length || record.railRoute.fullRoute?.lineLabels?.length);
    for(const key of ['carriage','seat','seatClass','issuer','saleCode','railBureau','railModel','railPowerSupply','railMileage','railRunner','railCarOwner','railPlatform','ticketCode'])assert.ok(record[key],record.service+' '+key);
    const range=railJourneyRange(record.railJourney);assert.equal(calendarDate(record.railJourney.stops[range.from].departureDate),calendarDate(record.departureDate));assert.equal(calendarDate(record.railJourney.stops[range.to].arrivalDate),calendarDate(record.arrivalDate));
    assert.match(railJourneyMarkup(record,rows),/列车全程/);
    const access=record.railJourney.access[0];assert.equal(access.station,record.origin);assert.equal(access.platform,record.railPlatform);assert.equal(calendarDate(access.date),calendarDate(record.departureDate));assert.ok(access.gates.length);
    if(record.service!=='Z83'){
      assert.ok(record.railTrainsets);
      for(const stock of record.railJourney.trainsets)for(const key of ['customType','modelRemark','carRemark'])assert.ok(stock[key],record.service+' '+key);
    }
  }
  const before=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Demo must not call an API');};
  try{const network=await loadRailwayNetwork(rows);assert.equal(network.routes.length,5);assert.deepEqual(network.unmatched,[]);assert.deepEqual(network.failed,[]);}
  finally{globalThis.fetch=before;}
  const beijing=rows.find(record=>record.service==='G21');assert.ok(beijing.railRoute.fullRoute.stops.length>beijing.railRoute.stops.length);assert.ok(beijing.railRoute.lineLabels.some(label=>/京沪/.test(label.name)));
  const overnight=rows.find(record=>record.service==='Z83');assert.equal(calendarDate(overnight.arrivalDate),'2014-07-13');
  rows[0].railRoute.stops[0].name='Changed';assert.equal(demoRecords('2026-11-17')[0].railRoute.stops[0].name,'北京南');
});

test('real flight-number examples use the matching airports and complete, independently generated boarding-pass codes',()=>{
  const rows=demoRecords('2026-11-17').filter(record=>record.type==='flight');
  for(const record of rows){
    const code=readBoardingCode(record.boardingCode);assert.equal(record.boardingCodeSource,'generated');assert.equal(code.service,record.service);assert.equal(code.originCode,record.originCode);assert.equal(code.destinationCode,record.destinationCode);assert.equal(code.seat,record.seat);assert.equal(code.cabin,record.seatClass);assert.equal(code.pnr,record.pnr);assert.equal(code.electronic,'');
    for(const key of ['airline','aircraft','aircraftRegistration','terminal','boardingTime','pnr','flightStatus','flightDistance','actualDepartureDate','actualDepartureTime','actualArrivalDate','actualArrivalTime','actualBoardingTime','baggageTagNumbers','checkedBaggageCount','freeBaggageAllowance','frequentFlyerCarrier','frequentFlyerNumber','marketingCarrier'])assert.ok(record[key],record.service+' '+key);
  }
  assert.equal(rows.find(record=>record.service==='MU5403').destinationCode,'CTU');assert.equal(rows.find(record=>record.service==='CA181').destinationCode,'HND');assert.equal(rows.find(record=>record.service==='CA181').passenger,'EXAMPLE/TRAVELER');
  assert.notEqual(rows[0].boardingCode.rawBytes,rows[1].boardingCode.rawBytes);
});
