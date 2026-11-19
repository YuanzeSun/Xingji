import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText } from '../src/scan-engine.js';
import { boardingScanRecords } from '../src/boarding-pass.js';
import { encodeBCBP } from '../src/bcbp.js';
import { readBCBP } from '../src/bcbp-reader.js';
import { prepareOCRImage } from '../src/scan-image.js';

const fields={passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',origin:'JFK',destination:'LHR',carrier:'BA',flightNumber:'321',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1'};

test('a boarding pass photo cannot populate the rail OCR form',()=>{
  assert.deepEqual(parseScanText('BOARDING PASS\nFLIGHT: BA321\nFROM: JFK\nTO: LHR\nBOARDING TIME 09:55'), []);
});

test('validated single-leg BCBP fields supply the carrier and cabin code without guessing a year or departure time',()=>{
  const payload=encodeBCBP(fields),decoded=readBCBP(payload);
  assert.equal(decoded.service,'BA321');assert.equal(decoded.seat,'12A');assert.equal(decoded.dayOfYear,138);
  const [record]=boardingScanRecords('synthetic',{boardingPayloads:[payload,payload]});
  assert.equal(record.service,'BA321');assert.equal(record.passenger,fields.passenger);assert.equal(record.pnr,fields.pnr);assert.equal(record.originCode,'JFK');assert.equal(record.destinationCode,'LHR');assert.equal(record.seat,'12A');
  assert.equal(calendarDate(record.departureDate),'');assert.equal(record.departureTime,'');assert.equal(record.seatClass,'Y');assert.equal(record.airline,'英国航空');

});

test('malformed and conflicting boarding codes are rejected and leap days need a real year',()=>{
  const payload=encodeBCBP(fields);
  for(const value of ['https://example.com',payload.slice(0,59),'M2'+payload.slice(2),payload.slice(0,58)+'FF',payload.slice(0,44)+'999'+payload.slice(47),payload.slice(0,2)+'张'+payload.slice(3)])assert.equal(readBCBP(value),null);
  const another=encodeBCBP({...fields,flightNumber:'999',destination:'CDG'});
  assert.deepEqual(boardingScanRecords('synthetic',{boardingPayloads:[payload,another]}),[]);
  const otherPassenger=encodeBCBP({...fields,passenger:'EXAMPLE/SECOND',seat:'14B'});
  assert.deepEqual(boardingScanRecords('synthetic',{boardingPayloads:[payload,otherPassenger]}),[]);
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
