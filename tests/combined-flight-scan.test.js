import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecognizer} from '../src/ocr.js';
import {createBoardingCode,readBoardingCode} from '../src/bcbp.js';
import {parseScanText,scanCandidate,createScanConsensus} from '../src/scan-engine.js';
import {barcodeFieldLocked} from '../src/barcode-fields.js';
import {archive,readArchive} from '../src/model.js';
import {taggedBoardingPayload} from './helpers/tagged-boarding-code.js';
import {multilegCode} from './helpers/multileg-boarding-code.js';
import {plannedBoardingTime} from '../src/boarding-pass.js';

const values={passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',origin:'JFK',destination:'LHR',carrier:'BA',flightNumber:'321',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1',electronic:''};
const code=()=>createBoardingCode(values);
const text='BOARDING PASS\nFLIGHT: BA999\nNAME: WRONG/NAME\nDATE: 19MAY2026\nFROM: CDG\nTO: HND\nSEAT: 46K\nCLASS: M\nGATE: B2\nBOARDING TIME: 09:55\nDEPARTURE TIME: 10:35\nID NO: P000001\nTICKET NO: 1230000000002\nTERMINAL: T1\nCNY: 640\nAIRCRAFT: A320';

async function withImage(run){
  const previous={document:globalThis.document,location:globalThis.location};
  globalThis.location=new URL('https://example.com/');
  globalThis.document={createElement:()=>{const canvas={width:0,height:0};canvas.getContext=()=>({fillRect(){},drawImage(){},getImageData:()=>({width:canvas.width,height:canvas.height,data:new Uint8ClampedArray(canvas.width*canvas.height*4)})});return canvas;}};
  try{return await run({width:20,height:10});}finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
}

test('a reported OCR language-load error rejects initialization instead of hanging', async () => withImage(async () => {
  const failure = new Error('language model download failed');
  await assert.rejects(createRecognizer(() => {}, {
    workerFactory: (_languages, _mode, { errorHandler }) => {
      errorHandler(failure);
      return new Promise(() => {});
    }
  }), error => /文字识别模型未能加载/.test(error.message) && error.cause === failure);
}));

test('image scans use decoded boarding data and only supplement the scheduled boarding time with OCR',async()=>withImage(async image=>{
  let finishOCR,finishCode,reads=0,terminated=false,settled=false;const started=[];
  const engine=await createRecognizer(()=>{},{workerFactory:async()=>({setParameters:async()=>{},recognize:async()=>{started.push('ocr');if(++reads===1)return new Promise(resolve=>{finishOCR=resolve;});return {data:{text,confidence:95,tsv:''}};},terminate:async()=>{terminated=true;}}),readCodes:async source=>{assert.equal(source,image);started.push('barcode');return new Promise(resolve=>{finishCode=resolve;});}});
  try{
    const pending=engine.recognize(image,{type:'flight'}).then(value=>{settled=true;return value;});
    await new Promise(resolve=>setImmediate(resolve));assert.ok(started.includes('ocr'));assert.ok(started.includes('barcode'));
    finishOCR({data:{text,confidence:95,tsv:''}});await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false,'OCR cannot finish the combined scan before the barcode is checked');
    finishCode([code()]);const recognized=await pending,record=scanCandidate(recognized.text,recognized.confidence,'flight',recognized);
    assert.equal(record.service,'BA321');assert.equal(record.passenger,'EXAMPLE/TRAVELER');assert.equal(record.originCode,'JFK');assert.equal(record.destinationCode,'LHR');assert.equal(record.seat,'12A');assert.equal(record.seatClass,'Y');assert.equal(record.airline,'英国航空');
    assert.equal(calendarDate(record.departureDate),'');assert.equal(record.departureDate.dayOfYear,138);assert.equal(record.fieldSources.departureDate,'barcode');
    assert.equal(record.boardingTime,'09:55');
    for(const key of ['passenger','service','origin','destination','originCode','destinationCode','seat','seatClass','pnr','airline'])assert.equal(barcodeFieldLocked(record,key),true,key);
    assert.equal(barcodeFieldLocked(record,'boardingTime'),false);assert.equal(record.fieldSources.boardingTime,'ocr');
    for(const key of ['departureTime','gate','identity','ticketNumber','terminal','price','aircraft']){
      assert.equal(record[key],'',key);assert.equal(record.fieldSources[key],undefined,key);
    }
    assert.equal(record.boardingCodeSource,'original');assert.equal(record.boardingCode.format,'PDF417');assert.equal(readBoardingCode(record.boardingCode).service,'BA321');
    const saved = readArchive(archive([record]))[0];
    assert.equal(saved.boardingCodeSource,'original');
    assert.equal(barcodeFieldLocked(saved,'service'),true);
    assert.equal(saved.boardingTime,'09:55');
  }finally{await engine.terminate();assert.equal(terminated,true);}
}));

test('an unreadable barcode does not fall back to OCR for other fields and a valid barcode survives OCR failure',async()=>withImage(async image=>{
  for(const failure of ['barcode','ocr']){
    const engine=await createRecognizer(()=>{},{workerFactory:async()=>({setParameters:async()=>{},recognize:async()=>{if(failure==='ocr')throw new Error('OCR unavailable');return {data:{text:'BOARDING PASS\nFLIGHT: BA321\nFROM: JFK\nTO: LHR\nSEAT: 12A',confidence:95,tsv:''}};},terminate:async()=>{}}),readCodes:async()=>{if(failure==='barcode')throw new Error('Barcode unavailable');return [code()];}});
    try{
      const recognized=await engine.recognize(image,{type:'flight'}),record=scanCandidate(recognized.text,recognized.confidence,'flight',recognized);
      if(failure==='barcode') assert.equal(record,null);
      else {
        assert.equal(record.service,'BA321');assert.equal(calendarDate(record.departureDate),'');
        assert.ok(record.boardingCode);assert.equal(barcodeFieldLocked(record,'service'),true);
      }
    }finally{await engine.terminate();}
  }
}));

test('planned boarding time is kept separate from departure, gate closure and actual boarding',()=>{
  assert.equal(plannedBoardingTime('BOARDING TIME   DEPARTURE TIME\n09:55 10:35'),'09:55');
  assert.equal(plannedBoardingTime('计划登机时间 09:55\n实际登机时间 10:07'),'09:55');
  assert.equal(plannedBoardingTime('ACTUAL BOARDING TIME 10:07\nGATE CLOSES 10:20\nDEPARTURE TIME 10:35'),'');
  const records=parseScanText(text,'photo',{
    flightImage:true,boardingCodes:[multilegCode()],scheduledBoardingTime:'09:55'
  });
  assert.equal(records.length,2);
  assert.ok(records.every(record=>!record.boardingTime));
});

test('a confirmed flight code is considered even when high-confidence OCR resembles a history screenshot',async()=>withImage(async image=>{
  let codeReads=0;
  const engine=await createRecognizer(()=>{},{workerFactory:async()=>({setParameters:async()=>{},recognize:async()=>({data:{text:'航旅纵横 历史行程\nFLIGHT: BA999\nFROM: CDG\nTO: HND\nSEAT: 46K',confidence:99,tsv:''}}),terminate:async()=>{}}),readCodes:async()=>{codeReads++;return [code()];}});
  try{const result=await engine.recognize(image);assert.equal(codeReads,1);assert.equal(parseScanText(result.text,'synthetic',result)[0].service,'BA321');}
  finally{await engine.terminate();}
}));

test('both Chinese and English passenger names come from the barcode only',()=>{
  const bytes=new TextEncoder().encode(taggedBoardingPayload());bytes[22]=32;
  const tagged={...code(),rawBytes:btoa(String.fromCharCode(...bytes))};
  const [record]=parseScanText('BOARDING PASS\n姓名: 李四\nGATE: B2\nBOARDING TIME: 17:30','synthetic',{boardingCodes:[tagged]});
  assert.equal(record.passenger,'张三');assert.equal(record.gate,'A101');assert.equal(record.boardingTime,'17:30');assert.equal(barcodeFieldLocked(record,'passenger'),true);assert.equal(barcodeFieldLocked(record,'gate'),true);assert.equal(barcodeFieldLocked(record,'boardingTime'),false);
  const domestic=createBoardingCode({...values,passenger:'ZHANG/SAN',origin:'PEK',destination:'SHA',carrier:'CA',flightNumber:'1234'});
  const [printed]=parseScanText('BOARDING PASS\n姓名: 张三','synthetic',{boardingCodes:[domestic]});assert.equal(printed.passenger,'ZHANG/SAN');assert.equal(printed.fieldSources.passenger,'barcode');assert.equal(barcodeFieldLocked(printed,'passenger'),true);
});

test('different codes for the same flight are not combined or accepted as matching camera frames',()=>{
  const first=code(),second=createBoardingCode({...values,seat:'14B'});
  assert.deepEqual(parseScanText('BOARDING PASS','synthetic',{boardingCodes:[first,second]}),[]);
  const a=parseScanText('BOARDING PASS','synthetic',{boardingCodes:[first]})[0],b=parseScanText('BOARDING PASS','synthetic',{boardingCodes:[second]})[0],consensus=createScanConsensus();
  assert.equal(consensus.observe(a,90),null);assert.equal(consensus.observe(b,90),null);assert.equal(consensus.observe(b,90).seat,'14B');
});

test('the year remains unknown even if the photo contains a full date',()=>{
  const [record]=parseScanText('BOARDING PASS\nDATE: 19MAY2026','synthetic',{boardingCodes:[code()]});
  assert.equal(calendarDate(record.departureDate),'');assert.equal(record.fieldSources.departureDate,'barcode');assert.equal(barcodeFieldLocked(record,'departureDate'),false);
  const [undated]=parseScanText('BOARDING PASS\nDATE: 18MAY','synthetic',{boardingCodes:[code()]});assert.equal(calendarDate(undated.departureDate),'');assert.equal(barcodeFieldLocked(undated,'departureDate'),false);
});
