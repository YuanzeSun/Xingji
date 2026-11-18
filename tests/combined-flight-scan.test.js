import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecognizer} from '../src/ocr.js';
import {createBoardingCode,readBoardingCode} from '../src/bcbp.js';
import {parseScanText,scanCandidate,createScanConsensus} from '../src/scan-engine.js';
import {barcodeFieldLocked} from '../src/barcode-fields.js';
import {archive,readArchive} from '../src/model.js';
import { csv } from './helpers/ticket-csv.js';
import {parseCSV} from '../src/importers.js';
import {taggedBoardingPayload} from './helpers/tagged-boarding-code.js';

const values={passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',origin:'JFK',destination:'LHR',carrier:'BA',flightNumber:'321',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1',electronic:''};
const code=()=>createBoardingCode(values);
const text='BOARDING PASS\nFLIGHT: BA999\nNAME: WRONG/NAME\nDATE: 19MAY2026\nFROM: CDG\nTO: HND\nSEAT: 46K\nCLASS: M\nGATE: B2\nBOARDING TIME: 09:55\nDEPARTURE TIME: 10:35\nID NO: P000001\nTICKET NO: 1230000000002\nTERMINAL: T1\nCNY: 640\nAIRCRAFT: A320';

async function withImage(run){
  const previous={document:globalThis.document,location:globalThis.location};
  globalThis.location=new URL('https://example.com/');
  globalThis.document={createElement:()=>{const canvas={width:0,height:0};canvas.getContext=()=>({fillRect(){},drawImage(){},getImageData:()=>({width:canvas.width,height:canvas.height,data:new Uint8ClampedArray(canvas.width*canvas.height*4)})});return canvas;}};
  try{return await run({width:20,height:10});}finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}

test('OCR and barcode recognition start together and produce one locked barcode record with editable OCR supplements',async()=>withImage(async image=>{
  let finishOCR,finishCode,reads=0,terminated=false,settled=false;const started=[];
  const engine=await createRecognizer(()=>{},{workerFactory:async()=>({setParameters:async()=>{},recognize:async()=>{started.push('ocr');if(++reads===1)return new Promise(resolve=>{finishOCR=resolve;});return {data:{text,confidence:95,tsv:''}};},terminate:async()=>{terminated=true;}}),readCodes:async source=>{assert.equal(source,image);started.push('barcode');return new Promise(resolve=>{finishCode=resolve;});}});
  try{
    const pending=engine.recognize(image,{type:'flight'}).then(value=>{settled=true;return value;});
    await new Promise(resolve=>setImmediate(resolve));assert.ok(started.includes('ocr'));assert.ok(started.includes('barcode'));
    finishOCR({data:{text,confidence:95,tsv:''}});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'OCR cannot finish the combined scan before the barcode is checked');
    finishCode([code()]);const recognized=await pending,record=scanCandidate(recognized.text,recognized.confidence,'flight',recognized);
    assert.equal(record.service,'BA321');assert.equal(record.passenger,'EXAMPLE/TRAVELER');assert.equal(record.originCode,'JFK');assert.equal(record.destinationCode,'LHR');assert.equal(record.seat,'12A');assert.equal(record.seatClass,'Y');assert.equal(record.airline,'英国航空');
    assert.equal(calendarDate(record.departureDate),'2026-05-18');assert.equal(record.fieldSources.departureDate,'barcode');
    assert.equal(record.departureTime,'10:35');assert.equal(record.boardingTime,'09:55');assert.equal(record.gate,'B2');assert.equal(record.identity,'P000001');assert.equal(record.ticketNumber,'1230000000002');assert.equal(record.terminal,'T1');assert.equal(record.price,'640');assert.equal(record.aircraft,'A320');
    for(const key of ['passenger','service','origin','destination','originCode','destinationCode','seat','seatClass','pnr','airline'])assert.equal(barcodeFieldLocked(record,key),true,key);
    for(const key of ['departureTime','boardingTime','gate','identity','ticketNumber','terminal','price','aircraft']){assert.equal(barcodeFieldLocked(record,key),false,key);assert.equal(record.fieldSources[key],'ocr',key);}
    assert.equal(record.boardingCodeSource,'original');assert.equal(record.boardingCode.format,'PDF417');assert.equal(readBoardingCode(record.boardingCode).service,'BA321');
    for(const saved of [readArchive(archive([record]))[0],parseCSV(csv([record]))[0]]){assert.equal(saved.boardingCodeSource,'original');assert.equal(barcodeFieldLocked(saved,'service'),true);assert.equal(saved.boardingTime,'09:55');}
  }finally{await engine.terminate();assert.equal(terminated,true);}
}));

test('either recognition path can fail independently; unreadable OCR never prevents adopting a verified barcode',async()=>withImage(async image=>{
  for(const failure of ['barcode','ocr']){
    const engine=await createRecognizer(()=>{},{workerFactory:async()=>({setParameters:async()=>{},recognize:async()=>{if(failure==='ocr')throw new Error('OCR unavailable');return {data:{text:'BOARDING PASS\nFLIGHT: BA321\nFROM: JFK\nTO: LHR\nSEAT: 12A',confidence:95,tsv:''}};},terminate:async()=>{}}),readCodes:async()=>{if(failure==='barcode')throw new Error('Barcode unavailable');return [code()];}});
    try{
      const recognized=await engine.recognize(image,{type:'flight'}),record=scanCandidate(recognized.text,recognized.confidence,'flight',recognized);
      assert.equal(record.service,'BA321');assert.equal(calendarDate(record.departureDate),'');
      assert.equal(!!record.boardingCode,failure==='ocr');assert.equal(barcodeFieldLocked(record,'service'),failure==='ocr');
    }finally{await engine.terminate();}
  }
}));

test('a confirmed flight code is considered even when high-confidence OCR resembles a history screenshot',async()=>withImage(async image=>{
  let codeReads=0;
  const engine=await createRecognizer(()=>{},{workerFactory:async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:'航旅纵横 历史行程\nFLIGHT: BA999\nFROM: CDG\nTO: HND\nSEAT: 46K',confidence:99,tsv:''}}),terminate:async()=>{}}),readCodes:async()=>{codeReads++;return [code()];}});
  try{const result=await engine.recognize(image);assert.equal(codeReads,1);assert.equal(parseScanText(result.text,'synthetic',result)[0].service,'BA321');}
  finally{await engine.terminate();}
}));

test('barcode Chinese fields take precedence while printed Chinese names supplement English-only domestic BCBP',()=>{
  const bytes=new TextEncoder().encode(taggedBoardingPayload());bytes[22]=32;
  const tagged={...code(),rawBytes:btoa(String.fromCharCode(...bytes))};
  const [record]=parseScanText('BOARDING PASS\n姓名: 李四\nGATE: B2\nBOARDING TIME: 17:30','synthetic',{boardingCodes:[tagged]});
  assert.equal(record.passenger,'张三');assert.equal(record.gate,'A101');assert.equal(record.boardingTime,'17:30');assert.equal(barcodeFieldLocked(record,'passenger'),true);assert.equal(barcodeFieldLocked(record,'gate'),true);assert.equal(barcodeFieldLocked(record,'boardingTime'),false);
  const domestic=createBoardingCode({...values,passenger:'ZHANG/SAN',origin:'PEK',destination:'SHA',carrier:'CA',flightNumber:'1234'});
  const [printed]=parseScanText('BOARDING PASS\n姓名: 张三','synthetic',{boardingCodes:[domestic]});assert.equal(printed.passenger,'张三');assert.equal(printed.fieldSources.passenger,'ocr');assert.equal(barcodeFieldLocked(printed,'passenger'),false);
});

test('different codes for the same flight are not combined or accepted as matching camera frames',()=>{
  const first=code(),second=createBoardingCode({...values,seat:'14B'});
  assert.deepEqual(parseScanText('BOARDING PASS','synthetic',{boardingCodes:[first,second]}),[]);
  const a=parseScanText('BOARDING PASS','synthetic',{boardingCodes:[first]})[0],b=parseScanText('BOARDING PASS','synthetic',{boardingCodes:[second]})[0],consensus=createScanConsensus();
  assert.equal(consensus.observe(a,90),null);assert.equal(consensus.observe(b,90),null);assert.equal(consensus.observe(b,90).seat,'14B');
});

test('the primary printed year is kept when secondary OCR disagrees, and an absent year remains unknown',()=>{
  const [record]=parseScanText('BOARDING PASS\nDATE: 19MAY2026','synthetic',{boardingCodes:[code()],boardingReadings:[{text:'BOARDING PASS\nDATE: 18MAY2025'}]});
  assert.equal(calendarDate(record.departureDate),'2026-05-18');assert.equal(record.fieldSources.departureDate,'barcode');assert.equal(barcodeFieldLocked(record,'departureDate'),false);
  const [undated]=parseScanText('BOARDING PASS\nDATE: 18MAY','synthetic',{boardingCodes:[code()]});assert.equal(calendarDate(undated.departureDate),'');assert.equal(barcodeFieldLocked(undated,'departureDate'),false);
});
