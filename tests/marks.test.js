import { parseScanText } from '../src/scan-engine.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord, archive, readArchive, mergeBackupRecords, mergeThreeWay } from '../src/model.js';
import { ticketSVG } from '../src/tickets.js';
import { normalizeMarks, describeMarks, marksFromText } from '../src/ticket-marks.js';

const sample = (values = {}) => createRecord({ id: 'marked-ticket', origin: '北京南', destination: '天津', service: 'C2021', departureDate: '2017-09-10', ...values });
const marks = [{ text: '网', shape: 'circle', offsetX: -3, offsetY: 4 }, { text: '学', shape: 'plain', offsetX: 5, offsetY: 0 }, { text: '孩', shape: 'plain', offsetX: 0, offsetY: 0 }];

test('marks are opt-in, validated and only inferred from explicit printed notation', () => {
  assert.deepEqual(sample().ticketMarks, []);
  assert.deepEqual(marksFromText('网上购票；学生优惠；儿童票'), []);
  assert.deepEqual(marksFromText('（网]'), []);
  assert.deepEqual(marksFromText('[学]'), []);
  assert.throws(() => normalizeMarks([{ text: '网', shape: 'box' }]), /仅支持圆圈或仅文字/);
  assert.deepEqual(marksFromText('票面标识：网 学'), normalizeMarks([{ text: '网' }, { text: '学' }]));
  assert.deepEqual(marksFromText('（网） （学） （网）'), normalizeMarks([{ text: '网', shape: 'circle' }, { text: '学', shape: 'circle' }]));
  assert.deepEqual(parseScanText('C2021 北京南→天津 （网）')[0].ticketMarks, normalizeMarks([{ text: '网' }]));
  assert.deepEqual(parseScanText('登机牌 CA181 北京首都→东京羽田 （网）'), []);
  for (const bad of [[{ text: '<script>' }], [{ text: '网', shape: 'unknown' }], [{ text: '网', offsetX: 101 }], [{ text: '网', offsetY: Infinity }], Array(5).fill({ text: '网' })]) {
    assert.throws(() => sample({ ticketMarks: bad }), /标识/);
  }
});

test('each rail template renders independent borders and offsets; flight templates omit them', () => {
  for (const template of ['rail-red-classic', 'rail-red', 'rail-blue', 'rail-receipt']) {
    const doc = new JSDOM(ticketSVG(sample({ template, ticketMarks: marks })), { contentType: 'image/svg+xml' }).window.document;
    const net = doc.querySelector('[data-ticket-mark="网"]');
    assert.ok(net.querySelector('circle'), template);
    const baseX = template.includes('red') ? 433 : 399;
    assert.equal(Number(net.querySelector('circle').getAttribute('cx')), baseX - 3);
    assert.equal(doc.querySelector('[data-ticket-mark="学"]').children.length, 1);
    assert.equal(doc.querySelector('[data-ticket-mark="孩"]').children.length, 1);
    assert.equal(doc.querySelector('[data-ticket-mark="孩"]').firstElementChild.tagName, 'text');
    assert.ok(Number(doc.querySelector('[data-ticket-mark="孩"] text').getAttribute('font-size')) > Number(net.querySelector('text').getAttribute('font-size')));
    assert.doesNotMatch(ticketSVG(sample({ template })), /data-ticket-mark=/);
  }
  assert.doesNotMatch(ticketSVG(sample({ type: 'flight', template: 'air-boarding-pass', ticketMarks: marks })), /data-ticket-mark=/);
  assert.match(describeMarks(marks), /偏移 -3 \/ 4/);
});

test('JSON roundtrips preserve mark shape and position', () => {
  const record = sample({ ticketMarks: marks, lockedFields: ['ticketMarks'] });
  const backup = JSON.parse(JSON.stringify(archive([record])));
  assert.equal(backup.schemaVersion, 2);
  assert.deepEqual(readArchive(backup), [record]);
  for (const ticketMarks of ['网 学', JSON.stringify(marks)]) {
    assert.throws(() => readArchive({ ...backup, records: [{ ...record, ticketMarks }] }), /须为数组/);
  }
});

test('imports respect corrected marks including intentional removal and sync detects mark conflicts', () => {
  const base = sample();
  const marked = sample({ ticketMarks: marks });
  assert.deepEqual(mergeBackupRecords([base], [marked])[0].ticketMarks, marks);
  assert.deepEqual(mergeBackupRecords([{ ...base, lockedFields: ['ticketMarks'] }], [marked])[0].ticketMarks, []);
  const otherMark = sample({ ticketMarks: [{ text: '学' }] });
  assert.deepEqual(mergeBackupRecords([marked], [otherMark])[0].ticketMarks, marks);
  const result = mergeThreeWay([base], [marked], [{ ...base, issuer: '另一台设备的售票站' }]);
  assert.equal(result.conflicts.length, 0); assert.deepEqual(result.records[0].ticketMarks, marks);
  assert.equal(result.records[0].issuer, '另一台设备的售票站');
  const conflict = mergeThreeWay([base], [marked], [otherMark]);
  assert.deepEqual(conflict.conflicts.map(c => c.field), ['ticketMarks']);
  assert.equal(mergeThreeWay([marked], [structuredClone(marked)], [structuredClone(marked)]).conflicts.length, 0);
});
