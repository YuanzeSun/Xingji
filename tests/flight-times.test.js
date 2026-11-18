import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {labelledFlightTimes,ACTUAL_FLIGHT_FIELDS} from '../src/flight-times.js';
import {flightCandidates,flightCompletion} from '../src/flight-lookup-model.js';
import {createRecord,archive,readArchive} from '../src/model.js';
import {parseText,mapFlightResult} from '../src/importers.js';
import {parseScanText} from '../src/scan-engine.js';
import {applyLookupValues,clearLookupValues,markManualFields} from '../src/lookup-values.js';
import {ticketSVG} from '../src/tickets.js';
import {boardingCodeDefaults,createBoardingCode} from '../src/bcbp.js';

const base={type:'flight',template:'air-boarding-pass',service:'CA181',origin:'PEK',destination:'HND',departureDate:'2026-11-16',departureTime:'23:30',arrivalDate:'2026-11-17',arrivalTime:'03:30'};
const provider=extra=>flightCandidates({structuredContent:{kind:'collection',items:[{FlightNo:'CA181',FlightDepcode:'PEK',FlightArrcode:'HND',FlightDeptimePlanDate:'2026-11-16 23:30:00',FlightArrtimePlanDate:'2026-11-17 03:30:00',FlightDeptimeDate:'2026-11-17 00:20:00',FlightArrtimeDate:'2026-11-17 04:10:00',distance:2100,...extra}]}},base)[0];

test('flight imports separate labelled planned and actual events without substituting estimates or guessing dates',()=>{
  const text='航班 CA181\n出发机场：PEK\n到达机场：HND\n实际起飞时间：2026-11-17 00:20\n实际到达时间：2026-11-17 04:10\n预计起飞时间：23:50\n计划起飞时间：2026-11-16 23:30\n计划到达时间：2026-11-17 03:30';
  const fields=labelledFlightTimes(text);assert.equal(calendarDate(fields.actualDepartureDate),'2026-11-17');assert.equal(fields.departureTime,'23:30');
  for(const record of [parseText(text)[0],parseScanText('行程详情\n'+text)[0]]){
    assert.equal(calendarDate(record.departureDate),'2026-11-16');assert.equal(record.departureTime,'23:30');assert.equal(record.arrivalTime,'03:30');assert.equal(calendarDate(record.actualDepartureDate),'2026-11-17');assert.equal(record.actualDepartureTime,'00:20');assert.equal(record.actualArrivalTime,'04:10');
  }
  const [actualOnly]=parseText('航班 CA181\n实际起飞时间：00:20\n实际到达时间：04:10\n预计起飞时间：23:50');
  assert.equal(calendarDate(actualOnly.departureDate),'');assert.equal(actualOnly.departureTime,'');assert.equal(calendarDate(actualOnly.actualDepartureDate),'');assert.equal(actualOnly.actualDepartureTime,'00:20');
  assert.deepEqual(labelledFlightTimes('IATA 12:00\n预计到达 13:00\nActual arrival 2026-02-30 04:10'),{actualArrivalTime:'04:10'});
  const [printed]=parseScanText('BOARDING PASS\nCA181\nFROM PEK TO HND\nDEPARTURE TIME 23:30\nDATE 2026-11-16\nACTUAL DEPARTURE 2026-11-17 00:20\nSEAT 12A');
  assert.equal(calendarDate(printed.departureDate),'2026-11-16');assert.equal(printed.departureTime,'23:30');assert.equal(printed.actualDepartureTime,'00:20');
  const [delayed]=parseScanText('行程详情\nCA181\nPEK -> HND\n计划2026-11-16 19:00-23:00\n实际到达00:30 +1天');
  assert.equal(calendarDate(delayed.arrivalDate),'');assert.equal(delayed.arrivalTime,'23:00');assert.equal(delayed.actualArrivalTime,'00:30');
});

test('provider timestamps map to distinct airport-local events, and distance accepts only the documented kilometre value',()=>{
  const row=provider();assert.equal(row.departureTime,'23:30');assert.equal(row.actualDepartureTime,'00:20');assert.equal(calendarDate(row.actualDepartureDate),'2026-11-17');assert.equal(row.flightDistance,'2100');
  const utc=provider({FlightDeptimeDate:'2026-11-16T16:20:00Z',FlightArrtimeDate:'2026-11-16T19:10:00Z'});
  assert.equal(calendarDate(utc.actualDepartureDate),'2026-11-17');assert.equal(utc.actualDepartureTime,'00:20');assert.equal(utc.actualArrivalTime,'04:10');
  const absent=provider({FlightDeptimeDate:'',FlightArrtimeDate:null,FlightDeptimeEstDate:'2026-11-17 01:00:00',FlightArrtimeReadyDate:'2026-11-17 05:00:00'});
  for(const key of ACTUAL_FLIGHT_FIELDS)assert.equal(absent[key],'');
  for(const distance of [null,'',0,-1,'2100 miles','N/A',true,100001])assert.equal(provider({distance}).flightDistance,'');
});

test('flight completion preserves manual events as a date-time pair and clears only provider data on context changes',()=>{
  const candidate=provider(),record=createRecord({...base,actualDepartureTime:'00:30',lockedFields:['actualDepartureTime']});
  const changes=flightCompletion(record,candidate);
  assert.equal(changes.actualDepartureDate,undefined);assert.equal(changes.actualDepartureTime,undefined);assert.equal(changes.actualArrivalTime,'04:10');
  applyLookupValues(record,changes,true,{kind:'flight-lookup'});assert.equal(record.fieldSources.actualArrivalTime,'variflight');assert.equal(record.fieldSources.flightDistance,'variflight');
  markManualFields(record,['actualDepartureTime']);clearLookupValues(record);
  assert.equal(record.departureTime,'23:30');assert.equal(record.actualArrivalTime,'');assert.equal(record.flightDistance,'');assert.equal(record.actualDepartureTime,'00:30');assert.equal(record.fieldSources.actualDepartureTime,'manual');
});

test('actual times and flight distance round-trip in archives and imports with validation',()=>{
  const record=provider();
  for(const saved of [readArchive(archive([record]))[0],mapFlightResult([{flightNumber:record.service,...record}])[0]]){
    for(const key of [...ACTUAL_FLIGHT_FIELDS,'flightDistance'])assert.deepEqual(saved[key],record[key],key);
  }
  for(const extra of [{actualDepartureTime:'25:00'},{actualArrivalDate:'2026-02-30'},{flightDistance:'-2'}])assert.throws(()=>createRecord({...base,...extra}));
});

test('boarding-pass rendering and generated barcode remain based on planned time regardless of actual flight data',()=>{
  const planned=createRecord({...base,passenger:'张三',seat:'12A',seatClass:'Y'}),actual=createRecord({...planned,actualDepartureDate:'2026-11-17',actualDepartureTime:'00:20',actualArrivalDate:'2026-11-17',actualArrivalTime:'04:10',flightDistance:'2100'});
  assert.equal(ticketSVG(planned),ticketSVG(actual));assert.match(ticketSVG(actual),/23:30/);assert.doesNotMatch(ticketSVG(actual),/00:20|04:10/);
  const code=record=>createBoardingCode({...boardingCodeDefaults({...record,passenger:'ZHANG/SAN',pnr:'ABC123'}),sequence:'25',status:'1'});
  assert.deepEqual(code(planned),code(actual));
});
