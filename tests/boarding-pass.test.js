import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText, scanCandidate } from '../src/scan-engine.js';
import { boardingTime } from '../src/boarding-pass.js';
import { encodeBCBP } from '../src/bcbp.js';
import { readBCBP } from '../src/bcbp-reader.js';
import { prepareOCRImage } from '../src/scan-image.js';

const layout=words=>words.map(([text,left,top,width=70,height=20],i)=>['5',1,1,1,1,i+1,left,top,width,height,95,text].join('\t')).join('\n');
const fields={passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',origin:'JFK',destination:'LHR',carrier:'BA',flightNumber:'321',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1'};

test('a main boarding pass and its repeated coupon provide only a labelled boarding time',()=>{
  const words=[['BRITISH AIRWAYS',10,10,200],['BOARDING PASS',350,10,180],['NAME',10,60],['FLIGHT',300,60],['DATE',480,60],['EXAMPLE/TRAVELER',10,95,240,25],['BA321',300,95,100,25],['18MAY2026',480,95,140,25],['FROM',10,150],['TO',300,150],['JFK',10,185],['LHR',300,185],['GATE',10,240],['BOARDING',180,240,120],['DEPARTURE',360,240,140],['SEAT',570,240],['B12',10,275,65,28],['09:55',180,275,100,28],['10:35',360,275,100,28],['12A',570,275,70,28],['BA321',780,50,100,25],['SEAT',780,100],['12A',780,135,70,28]];
  const [record,...rest]=parseScanText(words.map(row=>row[0]).join('\n'),'synthetic',{layout:layout(words)});
  assert.equal(rest.length,0);assert.equal(record.type,'flight');assert.equal(record.boardingTime,'09:55');
  assert.equal(calendarDate(record.departureDate),'');
  for (const field of ['service','originCode','destinationCode','departureTime','seat','gate']) assert.equal(record[field],'',field);
});

test('Chinese labels can precede values above their English translations, and spaced digits stay in their own column',()=>{
  const words=[['BOARDING PASS',20,10,200],['航 班',30,60,60],['MU1234',150,60,120,32],['座位号',430,60],['12A',550,60,80,32],['FLIGHT',30,100],['SEAT',430,100],['登 机 时 间',30,160,100],['1',170,160,14,35],['905',200,160,65,35],['登机口',310,160,70],['2',430,160,16,35],['1',454,160,16,35],['1',478,160,16,35],['BD TIME',30,202,90],['GATE',310,202]];
  const [record]=parseScanText(words.map(row=>row[0]).join('\n'),'synthetic',{layout:layout(words)});
  assert.equal(record.boardingTime,'19:05');assert.equal(record.departureTime,'');assert.equal(record.gate,'');assert.equal(record.seat,'');
});

test('boarding time formats preserve AM and PM',()=>{
  for(const [value,want] of [['515P','17:15'],['12:05AM','00:05'],['1215P','12:15'],['1315','13:15'],['06.30','06:30'],['24:30',''],['69:55','']])assert.equal(boardingTime(value),want,value);
});

test('ticket numbers, aircraft models and gate-close instructions cannot supply missing flight or departure fields',()=>{
  const [record]=parseScanText('BOARDING PASS\nETKT 9551234567890\nFLIGHT: SKY790\nDATE: 06DEC\nAIRCRAFT: DHC-8\nSEAT: 31H\nGATE: 18\nBOARDING TIME: 09:05\nGATE CLOSES 20 MINUTES BEFORE DEPARTURE');
  assert.equal(record.service,'');assert.equal(calendarDate(record.departureDate),'');assert.equal(record.departureTime,'');assert.equal(record.boardingTime,'09:05');
  assert.deepEqual(parseScanText('BOARDING PASS\nFLIGHT: BA1\nSEAT: 12A'),[]);
  assert.equal(scanCandidate('BOARDING PASS\nSEAT: 12A\nGATE: B2',95,'flight'),null);
});

test('validated single-leg BCBP fields supply the carrier and cabin code without guessing a year or departure time',()=>{
  const payload=encodeBCBP(fields),decoded=readBCBP(payload);
  assert.equal(decoded.service,'BA321');assert.equal(decoded.seat,'12A');assert.equal(decoded.dayOfYear,138);
  const [record]=parseScanText('BOARDING PASS\nDATE: 18MAY\nBOARDING TIME: 09:55','synthetic',{boardingPayloads:[payload,payload]});
  assert.equal(record.service,'BA321');assert.equal(record.passenger,fields.passenger);assert.equal(record.pnr,fields.pnr);assert.equal(record.originCode,'JFK');assert.equal(record.destinationCode,'LHR');assert.equal(record.seat,'12A');
  assert.equal(calendarDate(record.departureDate),'');assert.equal(record.departureTime,'');assert.equal(record.seatClass,'Y');assert.equal(record.airline,'英国航空');
  const dated=parseScanText('BOARDING PASS\nDATE: 18/05/2026','synthetic',{boardingPayloads:[payload]})[0];assert.equal(calendarDate(dated.departureDate),'');
  const issued=parseScanText('BOARDING PASS\nISSUE DATE: 18/05/2025','synthetic',{boardingPayloads:[payload]})[0];assert.equal(calendarDate(issued.departureDate),'');
  const printed=parseScanText('BOARDING PASS\nCLASS: M','synthetic',{boardingPayloads:[payload]})[0];assert.equal(printed.seatClass,'Y','barcode values take priority over conflicting OCR');
});

test('malformed and conflicting boarding codes are rejected and leap days need a real year',()=>{
  const payload=encodeBCBP(fields);
  for(const value of ['https://example.com',payload.slice(0,59),'M2'+payload.slice(2),payload.slice(0,58)+'FF',payload.slice(0,44)+'999'+payload.slice(47),payload.slice(0,2)+'张'+payload.slice(3)])assert.equal(readBCBP(value),null);
  const another=encodeBCBP({...fields,flightNumber:'999',destination:'CDG'});
  assert.deepEqual(parseScanText('BOARDING PASS','synthetic',{boardingPayloads:[payload,another]}),[]);
  const otherPassenger=encodeBCBP({...fields,passenger:'EXAMPLE/SECOND',seat:'14B'});
  assert.deepEqual(parseScanText('BOARDING PASS','synthetic',{boardingPayloads:[payload,otherPassenger]}),[]);
});

test('large photos are bounded before OCR and camera frames retain their proportions',async()=>{
  const previous=globalThis.document,draws=[];
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>({fillRect(){},drawImage(...args){draws.push(args);}})})};
  try{
    for(const [width,height,wantWidth,wantHeight] of [[9732,4067,1800,752],[1000,8000,375,3000],[1800,900,1800,900]]){
      const canvas=await prepareOCRImage({width,height});assert.equal(canvas.width,wantWidth);assert.equal(canvas.height,wantHeight);
    }
    assert.equal(draws.length,3);
  }finally{globalThis.document=previous;}
});
