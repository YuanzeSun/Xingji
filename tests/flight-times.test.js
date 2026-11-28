import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTUAL_FLIGHT_FIELDS,flightTimeWarnings,validateFlightTimes} from '../src/flight-times.js';
import {flightCandidates,flightCompletion} from '../src/flight-lookup-model.js';
import {createRecord,archive,readArchive} from '../src/model.js';
import {mapFlightResult} from '../src/importers.js';
import {applyLookupValues,clearLookupValues,markManualFields} from '../src/lookup-values.js';
import {ticketSVG} from '../src/tickets.js';
import {boardingCodeDefaults,createBoardingCode} from '../src/bcbp.js';

const base={type:'flight',template:'air-boarding-pass',service:'CA181',origin:'PEK',destination:'HND',departureDate:'2026-11-16',departureTime:'23:30',arrivalDate:'2026-11-17',arrivalTime:'03:30'};
const provider=extra=>flightCandidates({structuredContent:{kind:'collection',items:[{FlightNo:'CA181',FlightDepcode:'PEK',FlightArrcode:'HND',FlightDeptimePlanDate:'2026-11-16 23:30:00',FlightArrtimePlanDate:'2026-11-17 03:30:00',FlightDeptimeDate:'2026-11-17 00:20:00',FlightArrtimeDate:'2026-11-17 04:10:00',distance:2100,...extra}]}},base)[0];

test('flight saves compare complete time pairs in both directions with an inclusive 24-hour limit', () => {
  const checked = extra => validateFlightTimes(createRecord({ ...base, ...extra }));
  assert.doesNotThrow(() => checked({ actualDepartureDate:'2026-11-17', actualDepartureTime:'23:30' }));
  assert.doesNotThrow(() => checked({ actualArrivalDate:'2026-11-16', actualArrivalTime:'03:30' }));
  assert.doesNotThrow(() => checked({ departureTime:'', actualDepartureDate:'2026-11-18', actualDepartureTime:'23:31' }));
  assert.throws(() => checked({ actualDepartureDate:'2026-11-17', actualDepartureTime:'23:31' }), /起飞.*超过 24 小时/);
  assert.throws(() => checked({ actualArrivalDate:'2026-11-16', actualArrivalTime:'03:29' }), /到达.*超过 24 小时/);
  assert.throws(() => checked({ destination:'测试机场', actualArrivalDate:'2026-11-19', actualArrivalTime:'03:30' }), /到达.*超过 24 小时/);
  const clockChange = { destination:'JFK', departureDate:'2026-10-31', departureTime:'10:00',
    arrivalDate:'2026-10-31', arrivalTime:'12:00', actualArrivalDate:'2026-11-01' };
  assert.doesNotThrow(() => checked({ ...clockChange, actualArrivalTime:'11:00' }));
  assert.throws(() => checked({ ...clockChange, actualArrivalTime:'11:01' }), /到达.*超过 24 小时/);
});

test('flight saves reject reversed planned and actual trips using airport time zones', () => {
  const check = extra => validateFlightTimes(createRecord({ ...base, ...extra }));
  assert.throws(() => check({ arrivalDate:'2026-11-16', arrivalTime:'23:50' }), {
    message: '计划到达时间不能早于计划起飞时间。', fields: ['arrivalDate','arrivalTime']
  });
  assert.throws(() => check({ actualDepartureDate:'2026-11-17', actualDepartureTime:'00:20',
    actualArrivalDate:'2026-11-17', actualArrivalTime:'01:19' }), {
    message: '实际到达时间不能早于实际起飞时间。', fields: ['actualArrivalDate','actualArrivalTime']
  });
  assert.doesNotThrow(() => check({ destination:'LHR', departureTime:'18:00', arrivalDate:'2026-11-16', arrivalTime:'16:00' }));
  assert.doesNotThrow(() => check({ arrivalDate:'2026-11-17', arrivalTime:'00:30' }));
});

test('flight time warnings compare clocks across dates and use inclusive duration thresholds', () => {
  const warnings = extra => flightTimeWarnings(createRecord({ ...base, ...extra }));
  assert.deepEqual(warnings({}), []);
  assert.deepEqual(warnings({ actualDepartureDate:'2026-11-17', actualDepartureTime:'23:30' }), [
    '计划和实际起飞时间相同（23:30）。'
  ]);
  const actual = { actualDepartureDate:'2026-11-16', actualDepartureTime:'23:40', actualArrivalDate:'2026-11-17' };
  // PEK to HND adds one clock hour. The planned duration is 180 minutes.
  assert.match(warnings({ ...actual, actualArrivalTime:'06:40' })[0], /2 倍.*360 分钟.*180 分钟/);
  assert.match(warnings({ ...actual, actualArrivalTime:'02:10' })[0], /一半.*90 分钟.*180 分钟/);
  assert.deepEqual(warnings({ ...actual, actualArrivalTime:'06:39' }), []);
  assert.deepEqual(warnings({ ...actual, actualArrivalTime:'02:11' }), []);
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
