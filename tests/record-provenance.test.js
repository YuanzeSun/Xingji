import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecord,archive,readArchive,csv,mergeThreeWay,deduplicateRecords,resolveRecordConflict} from '../src/model.js';
import {parseCSV} from '../src/importers.js';
import {createBoardingCode,readBoardingCode} from '../src/bcbp.js';
import {refreshGeneratedCode,boardingCodeDifferences} from '../src/boarding-code-state.js';
import {applyLookupValues,markManualFields,clearLookupValues,isLookupValue} from '../src/lookup-values.js';
import {railQuery,railDetails,railCompletion} from '../src/rail-lookup-model.js';
import {searchTickets} from '../src/search.js';
import {MemoryGitHub} from './helpers/cloud.js';
import {GitHubStore,synchronize} from '../src/github.js';

const options={passenger:'DOE/JANE',pnr:'ABC123',origin:'PEK',destination:'SHA',carrier:'CA',flightNumber:'1234',date:'2026-11-17',cabin:'Y',seat:'12A',sequence:'25',status:'3',electronic:'E'};
const flight=extra=>createRecord({id:'flight',type:'flight',template:'air-boarding-pass',passenger:'DOE/JANE',pnr:'ABC123',origin:'PEK',destination:'SHA',service:'CA1234',departureDate:'2026-11-17',seat:'12A',boardingCode:createBoardingCode(options),boardingCodeSource:'generated',...extra});
const rail=extra=>createRecord({id:'rail',service:'G1',origin:'北京南',destination:'上海虹桥',departureDate:'2026-11-17',...extra});
const result=record=>railDetails({success:true,data:{bureau:'H',bureauShortName:'上局',car:'CR400BF-S',runner:'上海客运段',carOwner:'上海动车段',numberFull:['G1'],rundays:['20261117'],timetable:[{station:'北京南',day:0,arrive:'06:30',depart:'06:30'},{station:'上海虹桥',day:0,arrive:'11:24',depart:'11:24'}]}},railQuery(record));

test('generated codes follow ticket changes while preserving adopted status, format and actual operating flight',()=>{
  const updated=flight({seat:'20C',service:'CA5678',pnr:'XYZ789',departureDate:'2024-12-31',passenger:'DOE/JOHN',seatClass:'S'}),read=readBoardingCode(updated.boardingCode);
  assert.equal(read.seat,'20C');assert.equal(read.service,'CA5678');assert.equal(read.pnr,'XYZ789');assert.equal(read.dayOfYear,366);assert.equal(read.passenger,'DOE/JOHN');
  assert.equal(read.status,'3');assert.equal(read.sequence,'00025');assert.equal(read.cabin,updated.seatClass);assert.equal(refreshGeneratedCode(updated),false);
  const shared=flight({service:'BA123',boardingCodeOperatingFlight:'AA45A'});
  assert.equal(readBoardingCode(shared.boardingCode).service,'AA45A');
  assert.equal(readBoardingCode(createRecord({...shared,service:'BA456',seat:'08C'}).boardingCode).service,'AA45A');
  for(const format of ['PDF417','Aztec','QRCode','DataMatrix']){
    const record=flight({boardingCode:createBoardingCode({...options,electronic:''},format),seat:'5A'});
    assert.equal(record.boardingCode.format,format);assert.equal(readBoardingCode(record.boardingCode).electronic,'');
  }
});

test('original codes retain all bytes, compare only known flight-day data, and normalize seat padding and codeshares',()=>{
  const original=flight({boardingCodeSource:'original'}),changed=createRecord({...original,seat:'20C',service:'BA123',pnr:'OTHER',departureDate:'2026-11-18'});
  assert.deepEqual(changed.boardingCode,original.boardingCode);assert.ok(boardingCodeDifferences(changed).includes('座位'));assert.equal(boardingCodeDifferences(changed).includes('出发日期'),false,'the original barcode preserves its ordinal date');
  assert.deepEqual(boardingCodeDifferences({...original,seat:'0012A'}),[]);
  assert.equal(boardingCodeDifferences({...original,departureDate:''}).includes('出发日期'),false);
  assert.equal(boardingCodeDifferences({...original,departureDate:'2025-11-17'}).includes('出发日期'),false,'BCBP does not encode the year');
  const digitalCarrier=flight({service:'A0123',boardingCode:createBoardingCode({...options,carrier:'A0',flightNumber:'123'}),boardingCodeSource:'original'});
  assert.deepEqual(boardingCodeDifferences(digitalCarrier),[]);
});

test('provenance round-trips through backups and CSV, validates metadata and disappears on deletion',()=>{
  const record=flight({boardingCodeOperatingFlight:'AA45A',railModel:'CR400BF-S',lookupValues:{aircraft:'A320-200'},aircraft:'A320-200'});
  for(const restored of [readArchive(archive([record]))[0],parseCSV(csv([record]))[0]]){
    assert.equal(restored.boardingCodeSource,'generated');assert.equal(restored.boardingCodeOperatingFlight,'AA45A');assert.deepEqual(restored.lookupValues,record.lookupValues);assert.deepEqual(restored.boardingCode,record.boardingCode);
  }
  const deleted=createRecord({...record,deleted:true});assert.equal(deleted.boardingCodeSource,'');assert.equal(deleted.boardingCodeOperatingFlight,'');assert.deepEqual(deleted.lookupValues,{});
  assert.throws(()=>flight({lookupValues:{password:'secret'}}),/自动补全/);
  assert.throws(()=>flight({boardingCodeSource:'unexpected'}),/来源/);
});

test('independent device edits regenerate one combined code instead of conflicting on derived bytes',()=>{
  const base=flight(),local=flight({seat:'20C'}),remote=flight({pnr:'XYZ789'}),merged=mergeThreeWay([base],[local],[remote]);
  assert.deepEqual(merged.conflicts,[]);const read=readBoardingCode(merged.records[0].boardingCode);assert.equal(read.seat,'20C');assert.equal(read.pnr,'XYZ789');
  const removed=createRecord({...base,boardingCode:'',boardingCodeSource:'',lockedFields:['boardingCode']});
  const deletion=mergeThreeWay([base],[removed],[remote]);assert.deepEqual(deletion.conflicts,[]);assert.equal(deletion.records[0].boardingCode,'');
  const joined=deduplicateRecords([base,createRecord({...base,id:'other',seat:'20C',lockedFields:['seat']})]);assert.equal(joined.length,1);assert.equal(readBoardingCode(joined[0].boardingCode).seat,'20C');
});

test('real barcode conflicts preserve each source and operating-flight metadata through explicit cloud resolution',async()=>{
  const base=flight(),local=flight({boardingCodeSource:'original',boardingCode:createBoardingCode({...options,sequence:'26'})}),remote=flight({boardingCodeOperatingFlight:'AA45A'});
  const server=new MemoryGitHub([remote]),store=new GitHubStore({owner:'user',repo:'data',branch:'main',id:77},'test-key',server.fetch);
  const pending=await synchronize(store,[base],[local]);assert.equal(pending.conflicts.length,1);const conflict=pending.conflicts[0];assert.equal(conflict.field,'boardingCode');
  const accepted=await synchronize(store,[base],[local],{'flight:boardingCode':{choice:'remote',local:conflict.local,remote:conflict.remote,context:conflict.context}});
  assert.deepEqual(accepted.conflicts,[]);assert.equal(accepted.records[0].boardingCodeSource,'generated');assert.equal(accepted.records[0].boardingCodeOperatingFlight,'AA45A');assert.equal(readBoardingCode(server.records()[0].boardingCode).service,'AA45A');
  const chooseOriginal=mergeThreeWay([base],[local],[remote]);resolveRecordConflict(chooseOriginal.records[0],chooseOriginal.conflicts[0],'local');
  assert.equal(chooseOriginal.records[0].boardingCodeSource,'original');assert.deepEqual(createRecord(chooseOriginal.records[0]).boardingCode,local.boardingCode);
});

test('cloud synchronization combines independent ticket edits and writes a matching generated code',async()=>{
  const base=flight(),local=flight({seat:'20C',lockedFields:['seat']}),remote=flight({pnr:'XYZ789',lockedFields:['pnr']});
  const server=new MemoryGitHub([remote]),store=new GitHubStore({owner:'user',repo:'data',branch:'main',id:77},'test-key',server.fetch);
  const merged=await synchronize(store,[base],[local]);assert.deepEqual(merged.conflicts,[]);
  const saved=server.records()[0],decoded=readBoardingCode(saved.boardingCode);
  assert.equal(saved.seat,'20C');assert.equal(saved.pnr,'XYZ789');assert.equal(decoded.seat,saved.seat);assert.equal(decoded.pnr,saved.pnr);assert.equal(saved.boardingCodeSource,'generated');
  assert.equal(server.calls.filter(call=>call.method==='PATCH').length,1);
});

test('RailGo refresh replaces previous automatic values but preserves original and manually corrected values',()=>{
  let record=rail({departureTime:'07:00'}),first=result(record);applyLookupValues(record,railCompletion(record,first));record=createRecord(record);
  assert.equal(record.departureTime,'07:00');assert.equal(record.lockedFields.includes('railModel'),false);assert.equal(isLookupValue(record,'railModel'),true);
  record.railBureau='北京局';markManualFields(record,['railBureau']);
  const fresh={...first,railModel:'CR400AF',railBureau:'哈尔滨局',arrivalTime:'12:00'};applyLookupValues(record,railCompletion(record,fresh));
  assert.equal(record.railModel,'CR400AF');assert.equal(record.railBureau,'北京局');assert.equal(record.arrivalTime,'12:00');assert.equal(record.departureTime,'07:00');
  const noData=railCompletion(record,{...fresh,railModel:''});assert.equal(noData.railModel,undefined);
  for(const restored of [readArchive(archive([createRecord(record)]))[0],parseCSV(csv([record]))[0]])assert.ok(isLookupValue(restored,'railModel'));
  record.service='G2';const cleared=clearLookupValues(record);assert.equal(cleared.railModel,'');assert.equal(record.railBureau,'北京局');assert.equal(record.departureTime,'07:00');assert.equal(record.railJourney,'');
});

test('lookup origins follow the selected field during deduplication, independent edits and conflict resolution',()=>{
  const base=rail({railModel:'CR400BF',railBureau:'上海局',lookupValues:{railModel:'CR400BF',railBureau:'上海局'}});
  const local=createRecord({...base,railModel:'CR400AF',lookupValues:{...base.lookupValues,railModel:'CR400AF'}});
  const remote=createRecord({...base,railBureau:'北京局',lockedFields:['railBureau']});
  const combined=mergeThreeWay([base],[local],[remote]);assert.deepEqual(combined.conflicts,[]);assert.equal(isLookupValue(combined.records[0],'railModel'),true);assert.equal(isLookupValue(combined.records[0],'railBureau'),false);
  const manual=createRecord({...base,railModel:'CR400AF',lockedFields:['railModel']});
  const conflicting=mergeThreeWay([base],[manual],[createRecord({...base,railModel:'CRH380A',lookupValues:{...base.lookupValues,railModel:'CRH380A'}})]);
  assert.equal(conflicting.conflicts.length,1);resolveRecordConflict(conflicting.records[0],conflicting.conflicts[0],'remote');assert.equal(isLookupValue(conflicting.records[0],'railModel'),true);
  const identicalTouch=createRecord({...base,lockedFields:['railModel']});assert.equal(mergeThreeWay([base],[identicalTouch],[local]).conflicts.length,1,'a manual confirmation is not silently replaced by an automatic refresh');
  const joined=deduplicateRecords([base,createRecord({...base,id:'scan',railModel:'CRH380A',lookupValues:{},lockedFields:['railModel']})]);assert.equal(joined.length,1);assert.equal(joined[0].railModel,'CRH380A');assert.equal(isLookupValue(joined[0],'railModel'),false);
});

test('railway keywords include models, supply, units and valid trainset IDs without leaking metadata objects into search',()=>{
  const record=rail({railModel:'CR400BF-S',railPowerSupply:'AC380V',railBureau:'上海局',railRunner:'上海客运段',railCarOwner:'上海动车段'}),journey=result(record).railJourney;
  journey.trainsets=[{id:'CR400BF-5033'}];const complete=createRecord({...record,railTrainsets:'CR400BF-5033',railJourney:journey});
  for(const query of ['cr400bfs','上海动车段','上海客运段','上海局','AC380V','cr400bf5033','上海 -广州','"上海动车段"'])assert.equal(searchTickets([complete],{query}).records.length,1,query);
  assert.equal(searchTickets([complete],{query:'lookupValues'}).records.length,0);
  assert.equal(searchTickets([createRecord({...complete,railTrainsets:''})],{query:'CR400BF-5033'}).records.length,0);
});
