import { parseScanText } from '../src/scan-engine.js';
import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecord,archive,readArchive,mergeThreeWay,resolveRecordConflict,deduplicateRecords} from '../src/model.js';
import {fieldSourceLabel,fieldSourceBadge,markFieldSources} from '../src/field-sources.js';
import {markManualFields,applyLookupValues,clearLookupValues} from '../src/lookup-values.js';
import {applyProfileDefaults} from '../src/personal-profile.js';

const flight=extra=>createRecord({type:'flight',template:'air-boarding-pass',service:'CA1234',origin:'PEK',destination:'SHA',departureDate:'2026-05-18',passenger:'张三',...extra});

test('defaults, profile values and OCR record their actual origins without relabelling existing data',()=>{
  const blank=createRecord();assert.equal(blank.fieldSources.type,'default');assert.equal(blank.fieldSources.template,'default');assert.equal(fieldSourceLabel(blank,'passenger'),'未填写');
  const profile={chineseName:'张三',lastName:'ZHANG',firstName:'SAN',documents:[{id:'id',type:'national-id',number:'000000200001011234'}]};
  const filled=applyProfileDefaults({type:'rail',passenger:'',identity:''},profile);assert.equal(filled.fieldSources.passenger,'profile');assert.equal(filled.fieldSources.identity,'profile');
  const supplied={...filled,fieldSources:{passenger:'barcode',identity:'profile'}};assert.equal(applyProfileDefaults(supplied,profile).fieldSources.passenger,'barcode');
  const [scan]=parseScanText('车次：G21\n出发站：北京南\n到达站：南京南\n日期：2026-11-16');assert.equal(scan.fieldSources.service,'ocr');
  assert.equal(fieldSourceLabel(scan,'service'),'图片识别');assert.match(fieldSourceBadge('service',scan),/data-source-kind="ocr"/);
});

test('barcode field origins survive query fills, manual changes and context clearing',()=>{
  const record = flight({ gate: 'A101', fieldSources: { passenger: 'barcode', gate: 'barcode' } });
  applyLookupValues(record,{departureTime:'10:35',aircraft:'A320'},true,{kind:'flight-lookup'});
  assert.equal(record.fieldSources.departureTime,'variflight');assert.equal(record.fieldSources.aircraft,'variflight');assert.equal(record.fieldSources.passenger,'barcode');
  record.gate='A109';markManualFields(record,['gate']);assert.equal(record.fieldSources.gate,'manual');assert.equal(fieldSourceLabel(record,'gate'),'手动输入');
  clearLookupValues(record);assert.equal(record.departureTime,'');assert.equal(record.fieldSources.departureTime,undefined);assert.equal(record.gate,'A109');assert.equal(record.fieldSources.gate,'manual');
  assert.equal(record.fieldSources.passenger,'barcode');
});

test('field origins round-trip in archive and merge with the values chosen for each field',()=>{
  const base=flight({seat:'12A',gate:'A101',fieldSources:{seat:'barcode',gate:'barcode',passenger:'barcode'}});
  assert.deepEqual(readArchive(archive([base]))[0].fieldSources,base.fieldSources);
  const local=structuredClone(base),remote=structuredClone(base);local.seat='20C';markManualFields(local,['seat']);applyLookupValues(remote,{gate:'B2'},true,{kind:'flight-lookup'});
  const merged=mergeThreeWay([base],[local],[remote]);assert.equal(merged.conflicts.length,0);
  assert.equal(merged.records[0].seat,'20C');assert.equal(merged.records[0].fieldSources.seat,'manual');assert.equal(merged.records[0].gate,'B2');assert.equal(merged.records[0].fieldSources.gate,'variflight');
  const competing=structuredClone(base);competing.seat='30A';markFieldSources(competing,['seat'],'barcode');
  const conflict=mergeThreeWay([base],[local],[competing]);assert.equal(conflict.conflicts.length,1);resolveRecordConflict(conflict.records[0],conflict.conflicts[0],'remote');assert.equal(conflict.records[0].seat,'30A');assert.equal(conflict.records[0].fieldSources.seat,'barcode');
  const incoming=flight({id:'incoming',seat:'20C',fieldSources:{seat:'manual'},lockedFields:['seat']});
  const joined=deduplicateRecords([base,incoming]);assert.equal(joined.length,1);assert.equal(joined[0].fieldSources.seat,'manual');
});

test('RailGo sources survive normalization and disappear with deleted ticket data',()=>{
  const record=createRecord({service:'G21'});applyLookupValues(record,{railModel:'CR400BF-B',railBureau:'京局',railMileage:'1023'},true,{kind:'rail-lookup'});
  const normalized=createRecord(record);assert.equal(normalized.fieldSources.railModel,'railgo');assert.equal(fieldSourceLabel(normalized,'railBureau'),'RailGo');
  const deleted=createRecord({...normalized,deleted:true});assert.deepEqual(deleted.fieldSources,{});
  for(const source of [{passenger:'invented'},{fieldSources:'manual'},{nonexistent:'manual'},{passenger:['manual']},[]])assert.throws(()=>flight({fieldSources:source}),/来源/);
});
