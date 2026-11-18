import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calendarDate,dateLabel} from '../src/journey-date.js';
import {deduplicateRecords,mergeThreeWay,FIELDS,SCHEMA_VERSION} from '../src/model.js';
import {readBCBP} from '../src/bcbp-reader.js';
import {railLineFixtures} from './helpers/rail-line-fixtures.js';

const fixture=JSON.parse(await readFile(new URL('../specs/fixtures/conformance.json',import.meta.url),'utf8'));
const fields=JSON.parse(await readFile(new URL('../specs/archive-format/fields.json',import.meta.url),'utf8'));
test('shared rail line fixtures track the verified browser geometry matcher',async()=>{
  assert.deepEqual(JSON.parse(await readFile(new URL('../specs/fixtures/rail-line-names.json',import.meta.url),'utf8')),railLineFixtures);
});
test('shared Flutter archive fields track the browser protocol',()=>{
  assert.deepEqual(fields.fields,FIELDS);assert.equal(fields.schemaVersion,SCHEMA_VERSION);
});
for(const row of fixture.dates)test(`shared date fixture ${row.input}`,()=>{
  assert.equal(calendarDate(row.stored),row.calendar);assert.equal(dateLabel(row.stored),row.label);
});
for(const row of fixture.barcodes)test(`shared BCBP fixture ${row.expected.legCount} legs`,()=>{
  assert.deepEqual(readBCBP(Buffer.from(row.payload,'base64').toString('latin1')),row.expected);
});
for(const row of fixture.dedup)test(`shared dedup fixture ${row.name}`,()=>assert.deepEqual(deduplicateRecords(row.input),row.expected));
for(const row of fixture.merges)test(`shared merge fixture ${row.name}`,()=>{
  const result=mergeThreeWay(row.base,row.local,row.remote);
  assert.deepEqual(result.records,row.expectedRecords);
  assert.deepEqual(result.conflicts.map(({id,field})=>({id,field})),row.conflictFields);
});
