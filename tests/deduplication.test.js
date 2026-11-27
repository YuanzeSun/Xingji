import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord, mergeBackupRecords } from '../src/model.js';
import { synchronize } from '../src/github.js';
import { createBoardingCode } from '../src/bcbp.js';
import { applyReviewedTicket, reviewTicketImport, TicketImportReview } from '../src/ticket-import-review.js';
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
  assert.equal(mergeBackupRecords([], [flight('pek'), flight('pkx', { origin: '北京大兴' })]).length, 2);
  assert.deepEqual(searchTickets([flight('pek'), flight('pkx', { origin: '北京大兴' })], { query: '首都国际机场' }).records.map(r => r.id), ['pek']);
});

test('a confirmed supplement keeps one ID and automatic synchronization honours deletion of that ID', async () => {
  const a = flight('a', { seat: '08F', sources: [{ kind: 'scan', label: '原票' }] });
  const b = flight('b', { origin: '首都国际机场', price: '500', sources: [{ kind: 'flight-lookup', label: '飞常准历史行程' }] });
  let stored = [a], writes = 0;
  const store = { read: async () => ({ records: structuredClone(stored) }), write: async records => { stored = structuredClone(records); writes++; } };
  const { records } = applyReviewedTicket([a], b, { id: a.id, matches: reviewTicketImport([a], b) });
  const first = await synchronize(store, [a], records);
  assert.equal(first.conflicts.length, 0); assert.equal(stored.length, 1); assert.equal(writes, 1);
  assert.equal(stored[0].seat, '08F'); assert.equal(stored[0].price, '500');
  assert.equal(stored[0].sources.length, 2);
  assert.deepEqual(stored.map(row => row.id), ['a']);
  assert.equal(Object.hasOwn(stored[0], 'mergedIds'), false);
  const live = structuredClone(stored[0]);
  const next = await synchronize(store, [live], [{ ...live, issuer: '后续补录' }]);
  assert.equal(next.conflicts.length, 0); assert.equal(stored.length, 1); assert.equal(stored[0].issuer, '后续补录');
  const old = structuredClone(stored[0]);
  await synchronize(store, [old], [{ ...old, deleted: true }]);
  await synchronize(store, [old], [old]);
  assert.deepEqual(stored, [{ id: 'a', deleted: true, updatedAt: old.updatedAt }]);
});

test('import review catches discrepancies and requires fresh confirmation before writing a supplement', () => {
  const existing = flight('saved', { departureTime: '08:00', seat: '09A', ticketNumber: '9991234567890' });
  const conflicting = flight('separate', { departureTime: '08:15', seat: '09A', ticketNumber: '9991234567891' });
  const matches = reviewTicketImport([existing], conflicting);
  assert.deepEqual(matches[0].conflicts, ['ticketNumber', 'departureTime']);
  assert.throws(() => applyReviewedTicket([existing], conflicting), TicketImportReview);
  assert.throws(() => applyReviewedTicket([existing], conflicting, { id: existing.id, matches }), TicketImportReview);
  assert.equal(applyReviewedTicket([existing], conflicting, { id: '', matches }).records.length, 2);
  const [otherLeg] = reviewTicketImport([existing], flight('other-leg', { ticketNumber: existing.ticketNumber, destination: '广州白云' }));
  assert.equal(otherLeg.reason, '同日同航班');
  assert.deepEqual(otherLeg.conflicts, ['destination']);
  assert.equal(otherLeg.result, null);
  assert.equal(reviewTicketImport([existing], flight('other-flight', { service: 'CA1502', ticketNumber: existing.ticketNumber, destination: '广州白云' })).length, 0);
  assert.deepEqual(reviewTicketImport([existing], flight('other-passenger', { passenger: '李四' }))[0].conflicts, ['passenger']);
  const [byTicket] = reviewTicketImport([existing], flight('number-match', { service: '', ticketNumber: '999-1234567890' }));
  assert.equal(byTicket.reason, '客票号及航段相同');
  assert.equal(byTicket.strong, true);
  const boardingCode = createBoardingCode({ passenger: 'ZHANG/SAN', pnr: 'ABC123', origin: 'PEK', destination: 'SHA',
    carrier: 'CA', flightNumber: '1501', date: '2026-11-15', cabin: 'Y', seat: '09A', sequence: '1', status: '1' });
  const [codeshare] = reviewTicketImport([createRecord({ ...existing, passenger: 'ZHANG/SAN' })], flight('codeshare', {
    service: 'MU1234', passenger: 'ZHANG/SAN', pnr: 'ABC123', seat: '09A', seatClass: 'Y', boardingCode,
    boardingCodeSource: 'generated', boardingLegIndex: '0', boardingCodeOperatingFlight: 'CA1501',
  }));
  assert.equal(codeshare.reason, '同日同一承运航班');

  const existingRail = rail('record', { price: '300', railInvoice: { electronicTicketNumber: '1'.repeat(25) } });
  const incoming = rail('import', { seat: '08F', railInvoice: existingRail.railInvoice });
  const review = reviewTicketImport([existingRail], incoming);
  assert.equal(review[0].strong, true);
  assert.deepEqual(review[0].fields, ['seat']);
  assert.throws(() => applyReviewedTicket([existingRail], incoming, { id: '', matches: review }), TicketImportReview);
  assert.throws(() => applyReviewedTicket([{ ...existingRail, seat: '06A' }], incoming, { id: existingRail.id, matches: review }), TicketImportReview);
  const updated = applyReviewedTicket([existingRail], incoming, { id: existingRail.id, matches: review });
  assert.equal(updated.records[0].seat, '08F');
  assert.equal(updated.records[0].price, '300');
});

test('each railway identifier or service date can trigger review without checking passenger information', () => {
  const otherJourney = { service: 'G104', origin: '北京南', departureDate: '2026-11-16', passenger: '李四' };
  for (const [value, reason] of [
    [{ ticketNumber: 'A123456' }, '票号相同'],
    [{ saleCode: '12345678901234A123456' }, '底部售票码相同'],
    [{ railInvoice: { electronicTicketNumber: '1'.repeat(25) } }, '电子客票号相同'],
  ]) {
    const [match] = reviewTicketImport([rail('saved', value)], rail('incoming', { ...otherJourney, ...value }));
    assert.equal(match.reason, reason);
    assert.ok(match.conflicts.includes('departureDate'));
    assert.equal(match.result, null);
  }

  const saved = rail('saved', { passenger: '张三', identity: 'P000001' });
  const incoming = rail('incoming', { passenger: '旅客拼写不同', identity: 'P000002', seat: '08F' });
  const [match] = reviewTicketImport([saved], incoming);
  assert.equal(match.reason, '同日同车次');
  assert.deepEqual(match.conflicts, []);
  assert.deepEqual(match.fields, ['seat']);
  assert.equal(match.result.passenger, saved.passenger);
  assert.equal(match.result.identity, saved.identity);

  const [otherSegment] = reviewTicketImport([saved], rail('other-station', { origin: '北京南', passenger: '' }));
  assert.deepEqual(otherSegment.conflicts, ['origin']);
  assert.equal(reviewTicketImport([saved], rail('another-day', { departureDate: '2026-11-16' })).length, 0);
  assert.equal(reviewTicketImport([saved], rail('refund', { template: 'rail-refund-receipt' })).length, 0);
});
