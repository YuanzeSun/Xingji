import { parseScanText } from '../src/scan-engine.js';
import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, archive, readArchive, mergeThreeWay, mergeBackupRecords, validDate, partition } from '../src/model.js';
import { mapFlightResult } from '../src/importers.js';
import { ticketSVG } from '../src/tickets.js';
const sample = (values = {}) => createRecord({ id: 'test-1', origin: '北京南', destination: '上海虹桥', service: 'G103', departureDate: '2026-11-15', departureTime: '08:00', passenger: '张三', ...values });

test('dates preserve partial history, leap days and local calendar dates', () => {
  for (const date of ['', '2014', '2014-02', '2024-02-29', '2026-11-15']) assert.equal(validDate(date), true);
  for (const date of ['2025-02-29', '2026-13-01', '2026-04-31', '11/15/2026', '2026-00']) assert.equal(validDate(date), false);
  const flight = sample({ type: 'flight', template: 'air-boarding-pass', departureDate: '2026-11-15', arrivalDate: '2026-11-14', departureZone: 'Asia/Tokyo', arrivalZone: 'America/Los_Angeles' });
  assert.equal(calendarDate(readArchive(archive([flight]))[0].arrivalDate), '2026-11-14');
});
test('backup roundtrip preserves template, manual locks and unicode', () => {
  const r = sample({ template: 'rail-red', issuer: '北京南站\n第二行', lockedFields: ['seat'], seat: '017号下铺' });
  assert.deepEqual(readArchive(JSON.parse(JSON.stringify(archive([r])))), [r]);
  assert.throws(() => readArchive({ schemaVersion: 99, records: [] }), /格式/);
  assert.throws(() => readArchive({ ...archive([r]), records: [r, r] }), /重复/);
  assert.throws(() => sample({ departureZone: 'badzone' }), /时区/);
});
test('backup restore combines copies by ID and retains independently saved tickets', () => {
  const before = sample({ seat: '08F', price: '', lockedFields: ['seat'], sources: [{ kind: 'manual', label: '校对', at: '2026-01-01' }] });
  const incoming = sample({ id: 'other-id', mergedIds: [before.id], seat: '08F', price: '553.00', sources: [{ kind: 'pdf', label: '电子报销凭证', at: '2026-01-02' }] });
  const merged = mergeBackupRecords([before], [incoming]);
  assert.equal(merged.length, 1); assert.equal(merged[0].seat, '08F'); assert.equal(merged[0].price, '553.00'); assert.equal(merged[0].sources.length, 2);
  assert.equal(mergeBackupRecords([before], [sample({ id: 'independent-copy' })]).length, 2);
});
test('connecting flights sharing a ticket number remain separate legs', () => {
  const first = sample({ type: 'flight', template: 'air-boarding-pass', service: 'CA181', ticketNumber: '9991234567890' });
  const second = sample({ id: 'leg2', type: 'flight', template: 'air-boarding-pass', service: 'CA182', origin: '东京羽田', destination: '大阪关西', ticketNumber: '9991234567890' });
  assert.equal(mergeBackupRecords([first], [second]).length, 2);
});
test('merge combines independent device edits and retains both additions', () => {
  const base = sample(); const local = { ...base, seat: '08F' }, remote = { ...base, issuer: '售票站' };
  const result = mergeThreeWay([base], [local, sample({ id: 'local-added' })], [remote, sample({ id: 'remote-added' })]);
  assert.equal(result.conflicts.length, 0); assert.equal(result.records.length, 3); assert.equal(result.records[0].seat, '08F'); assert.equal(result.records[0].issuer, '售票站');
});
test('merge never chooses a winner for concurrent same-field changes', () => {
  const base = sample({ seat: '01A' });
  const result = mergeThreeWay([base], [{ ...base, seat: '02A' }], [{ ...base, seat: '03A' }]);
  assert.deepEqual(result.conflicts.map(c => [c.field, c.local, c.remote]), [['seat', '02A', '03A']]);
});
test('deletion conflicting with an edit needs explicit selection; unchanged records accept deletion', () => {
  const base = sample();
  const result = mergeThreeWay([base], [{ ...base, deleted: true }], [{ ...base, issuer: '北京南站' }]);
  assert.equal(result.conflicts.some(c => c.field === 'deleted'), true);
  const normal = mergeThreeWay([base], [base], [{ ...base, deleted: true }]);
  assert.equal(normal.conflicts.length, 0); assert.equal(normal.records[0].deleted, true);
});
test('order numbers survive backups independently of ticket numbers and do not merge different passengers', () => {
  const r = sample({ orderNumber: 'E123456789', ticketNumber: 'A01234567' });
  for (const restored of [readArchive(JSON.parse(JSON.stringify(archive([r]))))[0]]) {
    assert.equal(restored.orderNumber, 'E123456789'); assert.equal(restored.ticketNumber, 'A01234567');
  }
  const other = sample({ id: 'another-passenger', orderNumber: r.orderNumber, passenger: '李四' });
  assert.equal(mergeBackupRecords([r], [other]).length, 2);
  const parsed = parseScanText('日期：2026-11-15 车次：G103\n出发：北京南 到达：上海虹桥\n订单号：E123456789 票号：A01234567')[0];
  assert.equal(parsed.orderNumber, r.orderNumber); assert.equal(parsed.ticketNumber, r.ticketNumber);
});
test('unsupported flight responses are never silently guessed', () => {
  assert.throws(() => mapFlightResult({ data: [{ route: 'unknown' }] }), /结构/);
  const mapped = mapFlightResult({ flights: [{ flightNumber: 'CA181', origin: '北京首都', destination: '东京羽田', departureDate: '2026-11-15' }] });
  assert.equal(mapped[0].service, 'CA181'); assert.equal(mapped[0].type, 'flight');
});
test('rendered tickets escape imported text and preserve pinned template', () => {
  const r = sample({ origin: '<script>alert(1)</script>', template: 'rail-red' });
  const svg = ticketSVG(r); assert.doesNotMatch(svg, /<script>/); assert.match(svg, /&lt;script&gt;/); assert.match(svg, /#efd3ce/);
});
test('year partition keeps ID-only deletion markers with undated records', () => {
  const groups = partition([sample(), sample({ id: 'undated', departureDate: '' }), sample({ id: 'old', departureDate: '2014', deleted: true })]);
  assert.deepEqual(Object.keys(groups).sort(), ['2026', 'unknown']); assert.equal(groups.unknown.some(r => r.id === 'old' && r.deleted), true);
});
