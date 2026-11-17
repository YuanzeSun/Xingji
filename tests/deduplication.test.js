import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, applyImport, deduplicateRecords, archive, readArchive, csv } from '../src/model.js';
import { parseCSV } from '../src/importers.js';
import { synchronize } from '../src/github.js';
import { resolvePlace } from '../src/places.js';
import { resolveCity } from '../src/locations.js';
import { searchTickets } from '../src/search.js';

const rail = (id, extra = {}) => createRecord({ id, origin: '清河', destination: '上海虹桥', service: 'G103', departureDate: '2026-11-15', passenger: '张三', ...extra });
const flight = (id, extra = {}) => createRecord({ id, type: 'flight', template: 'air-boarding-pass', origin: '北京首都', destination: '上海虹桥', service: 'CA1501', departureDate: '2026-11-15', passenger: '张三', ...extra });

test('airport variants share canonical names and IATA identities without equating airports in one city', () => {
  for (const origin of ['首都国际', '北京首都国际', '首都国际机场', '北京首都国际机场', 'PEK', 'pek', 'Beijing Capital International Airport']) {
    const r = flight('airport', { origin });
    assert.equal(r.origin, '北京首都', origin); assert.equal(r.originCode, 'PEK', origin);
    assert.equal(resolveCity(r, 'origin').city, '北京', origin);
  }
  assert.equal(flight('city', { origin: '北京' }).originCode, '', 'a city alone is not a specific airport');
  assert.equal(resolvePlace(flight('conflict', { originCode: 'PKX' }), 'origin').status, 'conflict');
  assert.equal(resolveCity(flight('conflict', { originCode: 'PKX' }), 'origin').city, '');
  assert.equal(applyImport([], [flight('pek'), flight('pkx', { origin: '北京大兴' })]).records.length, 2);
  assert.deepEqual(searchTickets([flight('pek'), flight('pkx', { origin: '北京大兴' })], { query: '首都国际机场' }).records.map(r => r.id), ['pek']);
});

test('multi-source rail records merge in storage data, enriching fields and retaining manual corrections and source history', () => {
  const manual = rail('a', { seat: '08F', lockedFields: ['seat'], sources: [{ kind: 'manual', label: '手动录入' }] });
  const email = rail('b', { origin: 'QIP', destination: 'Shanghaihongqiao', service: 'ｇ１０３', seat: '08A', price: '553.00', sources: [{ kind: 'email', label: '邮件' }] });
  const scan = rail('c', { origin: '清河站', destination: '上海虹桥站', passenger: '', carriage: '05', sources: [{ kind: 'scan', label: '扫描' }] });
  const result = applyImport([manual], [email, scan]);
  assert.equal(result.added, 0); assert.equal(result.records.length, 1);
  const r = result.records[0];
  assert.equal(r.seat, '08F'); assert.equal(r.carriage, '05'); assert.equal(r.price, '553.00');
  assert.equal(r.sources.length, 3); assert.deepEqual(r.mergedIds, ['b', 'c']);
  assert.deepEqual(readArchive(archive(result.records)), result.records);
  assert.deepEqual(parseCSV(csv(result.records))[0].mergedIds, ['b', 'c']);
  assert.equal(applyImport(result.records, [email]).records.length, 1);
  assert.equal(deduplicateRecords([manual, email]).length, 1, 'existing underlying duplicates are also consolidated');
});

test('different passengers, journeys and ambiguous unnamed tickets remain separate', () => {
  const a = rail('a'), b = rail('b', { passenger: '李四' }), unnamed = rail('u', { passenger: '' });
  assert.equal(deduplicateRecords([unnamed, a, b]).length, 3, 'an unnamed scan must not bridge two passengers');
  for (const extra of [{ destination: '上海' }, { origin: '清河城' }, { service: 'G104' }, { departureDate: '2026-11-16' }, { passenger: '李四' }]) {
    assert.equal(deduplicateRecords([a, rail('other', extra)]).length, 2);
  }
  assert.equal(deduplicateRecords([rail('x', { departureTime: '08:00' }), rail('y', { departureTime: '10:00' })]).length, 2);
  assert.equal(deduplicateRecords([rail('x', { departureDate: '2026' }), rail('y', { departureDate: '2026' })]).length, 2);
  assert.equal(deduplicateRecords([rail('x', { passenger: '', seat: '01A' }), rail('y', { passenger: '', seat: '02A' })]).length, 2);
  assert.equal(deduplicateRecords([flight('x', { ticketNumber: '999123' }), flight('y', { origin: '上海虹桥', destination: '广州白云', ticketNumber: '999123' })]).length, 2);
});

test('synchronization writes one merged record and absorbed IDs cannot re-create it on a later device sync', async () => {
  const a = flight('a', { seat: '08F', sources: [{ kind: 'scan', label: '原票' }] });
  const b = flight('b', { origin: '首都国际机场', price: '500', sources: [{ kind: 'email', label: '邮件' }] });
  let stored = [a], writes = 0;
  const store = { read: async () => ({ records: structuredClone(stored) }), write: async records => { stored = structuredClone(records); writes++; } };
  const first = await synchronize(store, [], [b]);
  assert.equal(first.conflicts.length, 0); assert.equal(stored.length, 1); assert.equal(writes, 1);
  assert.equal(stored[0].seat, '08F'); assert.equal(stored[0].price, '500');
  assert.equal(stored[0].sources.length, 2);
  const next = await synchronize(store, [b], [{ ...b, issuer: '后续补录' }]);
  assert.equal(next.conflicts.length, 0); assert.equal(stored.length, 1); assert.equal(stored[0].issuer, '后续补录');
  const old = { ...structuredClone(stored[0]), id: 'b', mergedIds: [] };
  await synchronize(store, [old], [{ ...old, deleted: true }]);
  assert.equal(stored.length, 1); assert.equal(stored[0].deleted, true, 'deleting from a previously absorbed ID must affect the actual merged record');
  assert.equal(stored[0].origin, ''); assert.equal(stored[0].price, ''); assert.equal(stored[0].seat, '');
  assert.deepEqual(stored[0].sources, []);
});
