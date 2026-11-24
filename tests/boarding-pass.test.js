import test from 'node:test';
import assert from 'node:assert/strict';
import { parseScanText } from '../src/scan-engine.js';
import { encodeBCBP } from '../src/bcbp.js';
import { readBCBP } from '../src/bcbp-reader.js';
import { prepareOCRImage } from '../src/scan-image.js';

const fields={passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',origin:'JFK',destination:'LHR',carrier:'BA',flightNumber:'321',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1'};

test('a boarding pass photo cannot populate the rail OCR form',()=>{
  assert.deepEqual(parseScanText('BOARDING PASS\nFLIGHT: BA321\nFROM: JFK\nTO: LHR\nBOARDING TIME 09:55'), []);
});

test('validated single-leg BCBP fields supply the carrier and cabin code',()=>{
  const payload=encodeBCBP(fields),decoded=readBCBP(payload);
  assert.equal(decoded.service,'BA321');assert.equal(decoded.seat,'12A');assert.equal(decoded.dayOfYear,138);
  assert.equal(decoded.passenger,fields.passenger);assert.equal(decoded.pnr,fields.pnr);assert.equal(decoded.originCode,'JFK');assert.equal(decoded.destinationCode,'LHR');
  assert.equal(decoded.cabin,'Y');assert.equal(decoded.carrier,'BA');
});

test('malformed boarding codes are rejected',()=>{
  const payload=encodeBCBP(fields);
  for(const value of ['https://example.com',payload.slice(0,59),'M2'+payload.slice(2),payload.slice(0,58)+'FF',payload.slice(0,44)+'999'+payload.slice(47),payload.slice(0,2)+'张'+payload.slice(3)])assert.equal(readBCBP(value),null);
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
