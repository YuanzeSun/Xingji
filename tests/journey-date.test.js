import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {journeyDate,calendarDate,dateFromMonthDay,dateLabel} from '../src/journey-date.js';
import {createRecord,archive,readArchive} from '../src/model.js';
import {createBoardingCode,readBoardingCode} from '../src/bcbp.js';
import {ticketDateField,bindTicketDates,readTicketDate,refreshTicketDateLocks} from '../src/date-field.js';
import {railQuery,railDetails,railCompletion} from '../src/rail-lookup-model.js';
import {demoRecords} from '../src/demo.js';
import {flightQuery} from '../src/flight-lookup-model.js';

test('travel dates store the exact calendar year and ordinal day, including leap-century boundaries',()=>{
  for(const [iso,expected] of [['2024-01-01',{year:2024,dayOfYear:1}],['2024-02-29',{year:2024,dayOfYear:60}],['2025-03-01',{year:2025,dayOfYear:60}],['2024-12-31',{year:2024,dayOfYear:366}],['2025-01-01',{year:2025,dayOfYear:1}],['2000-03-01',{year:2000,dayOfYear:61}],['2100-03-01',{year:2100,dayOfYear:60}]]){
    assert.deepEqual(journeyDate(iso),expected);assert.equal(calendarDate(expected),iso);
  }
  for(const value of [{year:2025,dayOfYear:366},{year:2024,dayOfYear:0},{year:2024,dayOfYear:1.5},{year:'2024',dayOfYear:60},'2025-02-29','2024-02'])assert.throws(()=>journeyDate(value));
});

test('the barcode day survives without a guessed year and is decoded only after the year is supplied',()=>{
  const date=journeyDate({year:null,dayOfYear:60});assert.equal(calendarDate(date),'');assert.match(dateLabel(date),/年份未知/);
  assert.equal(calendarDate({...date,year:2024}),'2024-02-29');assert.equal(calendarDate({...date,year:2025}),'2025-03-01');
  assert.deepEqual(date,{year:null,dayOfYear:60});
  const flight=createRecord({type:'flight',template:'air-boarding-pass',service:'CA1234',departureDate:date});assert.throws(()=>flightQuery(flight));
});

test('all planned and actual dates and cached railway stop dates remain ordinal in archive round trips',()=>{
  const record=createRecord({type:'flight',template:'air-boarding-pass',departureDate:'2024-12-31',arrivalDate:'2025-01-01',actualDepartureDate:'2025-01-01',actualArrivalDate:'2025-01-02'});
  const saved=JSON.parse(JSON.stringify(archive([record]))).records[0];
  assert.deepEqual(saved.departureDate,{year:2024,dayOfYear:366});assert.deepEqual(saved.arrivalDate,{year:2025,dayOfYear:1});
  assert.deepEqual(saved.actualDepartureDate,{year:2025,dayOfYear:1});assert.deepEqual(saved.actualArrivalDate,{year:2025,dayOfYear:2});
  const restored = readArchive(archive([record]))[0];
  for(const key of ['departureDate','arrivalDate','actualDepartureDate','actualArrivalDate'])assert.deepEqual(restored[key],record[key]);
  const rail=readArchive(archive([demoRecords('2026-11-18')[0]]))[0];assert.equal(typeof rail.railJourney.query.startDate,'object');
  assert.ok(rail.railJourney.stops.every(stop=>[stop.arrivalDate,stop.departureDate].every(date=>!date||Number.isInteger(date.year)&&Number.isInteger(date.dayOfYear))));
  assert.equal(archive([record]).schemaVersion,2);
});

test('barcode month and day are locked, while changing only the year preserves its recorded ordinal',()=>{
  const code=createBoardingCode({passenger:'DOE/JANE',pnr:'ABC123',origin:'PEK',destination:'SHA',carrier:'CA',flightNumber:'1234',date:{year:null,dayOfYear:60},cabin:'Y',seat:'12A',sequence:'25',status:'1'});
  const record=createRecord({type:'flight',template:'air-boarding-pass',boardingCode:code,boardingCodeSource:'original',boardingLegIndex:'0'});
  assert.deepEqual(record.departureDate,{year:null,dayOfYear:60});assert.equal(readBoardingCode(code).dayOfYear,60);
  const dom=new JSDOM('<form>'+ticketDateField('departureDate',record,{label:'计划起飞日期',required:true})+'</form>'),form=dom.window.document.querySelector('form');
  bindTicketDates(form,()=>record);form.addEventListener('input',()=>{record.departureDate=readTicketDate(form,'departureDate',record);refreshTicketDateLocks(form,record);});
  refreshTicketDateLocks(form,record);
  assert.equal(form.elements.departureDateYear.readOnly,false);assert.equal(form.elements.departureDateMonth.disabled,true);assert.equal(form.elements.departureDateDay.disabled,true);
  assert.equal(form.elements.departureDateMonth.value,'');
  const year=value=>{form.elements.departureDateYear.value=value;form.elements.departureDateYear.dispatchEvent(new dom.window.Event('input',{bubbles:true}));};
  year('2024');assert.equal(form.elements.departureDateMonth.value,'02');assert.equal(form.elements.departureDateDay.value,'29');
  year('2025');assert.equal(form.elements.departureDateMonth.value,'03');assert.equal(form.elements.departureDateDay.value,'01');assert.deepEqual(record.departureDate,{year:2025,dayOfYear:60});
  year('');assert.deepEqual(record.departureDate,{year:null,dayOfYear:60});dom.window.close();
});

test('manual month-day entry converts using its own year and never rolls an invalid leap day forward',()=>{
  assert.deepEqual(dateFromMonthDay(2024,'02-29'),{year:2024,dayOfYear:60});assert.deepEqual(dateFromMonthDay(2025,'03-01'),{year:2025,dayOfYear:60});
  assert.throws(()=>dateFromMonthDay(2025,'02-29'));assert.throws(()=>dateFromMonthDay('','03-01'));
  assert.equal(calendarDate(journeyDate({year:2026,dayOfYear:322})),'2026-11-18');
});


test('a railway journey crossing New Year retains each stop calendar year and ordinal independently',()=>{
  const record=createRecord({service:'G1',origin:'柳州',destination:'来宾北',departureDate:'2024-12-31'}),query=railQuery(record);
  const result=railDetails({success:true,data:{numberFull:['G1'],rundays:['20241231'],timetable:[{station:'柳州',day:0,depart:'23:50'},{station:'来宾北',day:1,arrive:'00:40'}]}},query);
  const saved=createRecord({...record,...railCompletion(record,result)});
  assert.deepEqual(saved.departureDate,{year:2024,dayOfYear:366});assert.deepEqual(saved.arrivalDate,{year:2025,dayOfYear:1});
  assert.deepEqual(saved.railJourney.stops[1].arrivalDate,{year:2025,dayOfYear:1});
});
