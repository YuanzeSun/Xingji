import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { searchTickets, searchOptions, clearSearchField, activeSearch, dateInterval } from '../src/search.js';
import { DEMO_TICKET_CODE } from '../src/demo-code.js';

const record = (id, extra = {}) => createRecord({ id, origin: '北京南', destination: '上海虹桥', originCode: 'Beijingnan', destinationCode: 'Shanghaihongqiao', service: 'G103', departureDate: '2025-08-16', passenger: '张三', carriage: '05', seat: '08F', seatClass: '二等座', price: '553.0', ...extra });
const rows = [
  record('outbound', { ticketNumber: 'E123456', ticketMarks: '网 学', ticketCode: DEMO_TICKET_CODE, sources: [{ kind: 'scan', label: '旧票扫描夹' }] }),
  record('return', { origin: '上海虹桥', destination: '北京南', originCode: 'Shanghaihongqiao', destinationCode: 'Beijingnan', service: 'G104', departureDate: '2025-08-18', price: '600' }),
  record('flight', { type: 'flight', template: 'air-boarding-pass', origin: '上海虹桥', destination: '北京首都', originCode: 'SHA', destinationCode: 'PEK', service: 'CA1502', departureDate: '2025-08-17', passenger: '李四', price: '100', seat: '32A', seatClass: '经济舱', airline: '中国国际航空', aircraft: 'A330', pnr: 'PNR123', terminal: 'T2', gate: 'B09' }),
  record('month', { departureDate: '2025-08-01', passenger: '王五', price: '' }),
  record('year', { departureDate: '2025', passenger: '王五', price: '' }),
  record('undated', { departureDate: '', price: '', template: 'rail-red-classic' }),
  record('previous', { departureDate: '2024-08-16', provenance: 'reconstruction' }),
  record('deleted', { deleted: true })
];
const ids = (filters, data = rows) => searchTickets(data, filters).records.map(r => r.id).sort();

test('search combines words, normalizes case and full-width text, excludes words and respects phrases', () => {
  assert.deepEqual(ids({ query: '北京 ｇ１０３ 张三 -2024 -红票' }), ['outbound']);
  assert.deepEqual(ids({ query: 'ＰＮＲ１２３ ca1502' }), ['flight']);
  assert.deepEqual(ids({ query: 'SHA "中国国际航空" -G104' }), ['flight']);
  assert.deepEqual(ids({ query: '"中国 国际航空"' }), []);
  assert.deepEqual(ids({ query: '"中国国际航空" -"中国国际航空"' }), []);
  assert.deepEqual(ids({ query: '旧票扫描夹' }), [], 'source descriptions are outside the requested search scope');
  assert.deepEqual(ids({ query: '08F' }), [], 'seat numbers are outside the requested search scope');
  assert.deepEqual(ids({ query: 'E123456 学' }), ['outbound']);
  assert.deepEqual(ids({ query: 'A330 B09 T2' }), ['flight']);
  assert.deepEqual(ids({ query: 'iVBORw0KGgo' }), [], 'image payloads are not searched');
  assert.deepEqual(ids({ query: '红票' }), ['undated']);
  assert.equal(ids({}).includes('deleted'), false);
});

test('route filters compare the correct endpoint and support reverse trips and station or airport codes', () => {
  assert.deepEqual(ids({ origin: 'beijingnan', destination: 'shanghai', passenger: '张三', dateFrom: '2025', dateTo: '2025' }), ['outbound']);
  assert.deepEqual(ids({ origin: '北京南', destination: '上海虹桥', bothDirections: true, passenger: '张三', dateFrom: '2025', dateTo: '2025' }), ['outbound', 'return']);
  assert.deepEqual(ids({ origin: 'pek', destination: 'sha', bothDirections: true }), ['flight']);
  assert.deepEqual(ids({ origin: '北京南', destination: '北京南' }), [], 'route fields cannot both match one endpoint');
  assert.deepEqual(ids({ origin: '上海', bothDirections: true, type: 'flight' }), ['flight']);
});

test('fields can be combined and QR completeness applies only to railway tickets', () => {
  assert.deepEqual(ids({ service: 'g 103', passenger: '张三', seatClass: '二等', mark: '学', code: 'with' }), ['outbound']);
  assert.deepEqual(ids({ airline: '国际航空', seatClass: '经济' }), ['flight']);
  assert.deepEqual(ids({ template: 'rail-red-classic', code: 'without' }), ['undated']);
  assert.deepEqual(ids({ type: 'flight', code: 'without' }), []);
  assert.deepEqual(ids({ provenance: 'reconstruction' }), ['previous']);
});

test('date ranges include overlapping partial dates, exclude unknown dates and validate both endpoints', () => {
  assert.deepEqual(dateInterval('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.deepEqual(dateInterval('2025'), { start: '2025-01-01', end: '2025-12-31' });
  assert.deepEqual(ids({ dateFrom: '2025-08-17', dateTo: '2025-08-17' }), ['flight', 'year']);
  assert.deepEqual(ids({ year: 'unknown' }), ['undated']);
  assert.deepEqual(ids({ year: '2024', dateFrom: '2025' }), []);
  assert.deepEqual(ids({ dateFrom: '2025-08', dateTo: '2025-08' }), ['flight', 'month', 'outbound', 'return', 'year']);
  for (const filters of [{ dateFrom: '2025-02-29' }, { dateTo: '2025-13' }, { dateFrom: '2026', dateTo: '2025' }]) assert.ok(searchTickets(rows, filters).error);
});

test('RMB price comparisons include rail and flight tickets, support zero and put missing prices last', () => {
  assert.deepEqual(ids({ minPrice: '90', maxPrice: '110' }), ['flight']);
  assert.deepEqual(ids({ minPrice: '550', maxPrice: '560', dateFrom: '2025' }), ['outbound']);
  const sorted = searchTickets(rows, { sort: 'price-asc' }).records;
  assert.equal(sorted[0].id, 'flight');
  assert.ok(sorted.findIndex(r => !r.price) > sorted.findIndex(r => r.id === 'return'));
  assert.deepEqual(ids({ minPrice: '0', maxPrice: '0' }, [record('free', { price: '0' }), record('missing', { price: '' })]), ['free']);
  for (const filters of [{ minPrice: '-1' }, { maxPrice: 'NaN' }, { minPrice: '10', maxPrice: '9' }, { minPrice: '1.234' }]) assert.ok(searchTickets(rows, filters).error);
});

test('sorting is stable, chronological in either direction and does not mutate the source', () => {
  const copy = structuredClone(rows);
  assert.equal(searchTickets(rows, { sort: 'newest' }).records.at(-1).id, 'undated');
  assert.equal(searchTickets(rows, { sort: 'oldest' }).records.at(-1).id, 'undated');
  assert.equal(searchTickets(rows, { sort: 'oldest' }).records[0].id, 'previous');
  assert.deepEqual(searchTickets([record('g103'), record('g9', { service: 'G9' })], { sort: 'service' }).records.map(r => r.id), ['g9', 'g103']);
  assert.deepEqual(rows, copy);
});

test('clear chips remove complete condition groups and search options contain only supported fields', () => {
  const f = searchOptions({ query: '北京', origin: '北京', destination: '上海', bothDirections: true, dateFrom: '2025', dateTo: '2026', minPrice: '100', sort: 'price-asc', hiddenPayload: 'discard' });
  assert.equal(Object.hasOwn(f, 'hiddenPayload'), false);
  assert.deepEqual(Object.fromEntries(['origin', 'destination', 'bothDirections'].map(k => [k, clearSearchField(f, 'route')[k]])), { origin: '', destination: '', bothDirections: false });
  assert.equal(clearSearchField(f, 'dates').dateTo, '');
  assert.equal(clearSearchField(f, 'price').sort, 'newest');
  assert.equal(clearSearchField(f, 'query').query, '');
  assert.ok(activeSearch(f).some(c => c.key === 'price' && c.label.includes('¥')));
  assert.equal(f.query, '北京');
});
