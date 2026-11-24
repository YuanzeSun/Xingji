import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRecord } from '../src/model.js';
import { flightCandidates, flightCompletion } from '../src/flight-lookup-model.js';
import { flightQuery } from '../src/flight-query.js';
import { bindFlightLookup, flightLookupMarkup } from '../src/flight-lookup.js';
import { FlightConnector } from '../src/mcp.js';

const input = { type: 'flight', service: 'CA181', departureDate: '2026-07-18' };
const row = extra => ({ FlightNo: 'CA181', FlightDepcode: 'PEK', FlightArrcode: 'HND', FlightDeptimePlanDate: '2026-07-18 08:00:00', FlightArrtimePlanDate: '2026-07-18 12:20:00', FlightDeptimeDate: '2026-07-18 09:00:00', FlightCompany: '中国国际航空', FlightDepTerminal: 'T3', BoardGate: 'E18', aircraftType: 'Airbus A330-300', ...extra });
const payload = items => ({ structuredContent: { kind: 'collection', items } });
const record = extra => createRecord({ ...input, template: 'air-boarding-pass', ...extra });

test('one explicit flight lookup uses the existing negotiated MCP connection and sends only public flight identifiers', async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    const message = JSON.parse(options.body); calls.push(message);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return Response.json({ id: message.id, result: message.method === 'initialize' ? { protocolVersion: '2025-03-26' } : payload([row()]) }, { headers: { 'Mcp-Session-Id': 'flight-session' } });
  };
  try {
    await new FlightConnector('test-key').flightStatus(record({ passenger: 'PRIVATE', identity: 'PRIVATE', origin: 'PEK', destination: 'HND' }));
    assert.deepEqual(calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/call']);
    assert.deepEqual(calls[2].params, { name: 'getFlightStatus', arguments: { fnum: 'CA181', date: input.departureDate, dep: 'PEK', arr: 'HND' } });
    assert.equal(JSON.stringify(calls).includes('PRIVATE'), false);
    calls.length = 0;
    for (const extra of [{ departureDate: '2026-07' }, { departureDate: '2026-02-30' }, { service: 'CA181&key=private' }, { type: 'rail' }]) await assert.rejects(new FlightConnector('test-key').flightStatus({ ...input, ...extra }));
    assert.equal(calls.length, 0);
  } finally { globalThis.fetch = original; }
});

test('provider mapping is verified by number, date and specific airports and uses planned rather than actual times', () => {
  const rows = [row(), row(), row({ FlightNo: 'CA182' }), row({ FlightDeptimePlanDate: '2026-07-19 08:00:00' }), row({ FlightDepcode: 'PKX' }), row({ FlightDeptimePlanDate: '' }), row({ FlightArrcode: '' })];
  const candidates = flightCandidates(payload(rows), { ...input, origin: 'PEK' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].departureTime, '08:00'); assert.equal(candidates[0].arrivalTime, '12:20');
  assert.equal(candidates[0].aircraft, 'A330-300'); assert.equal(candidates[0].gate, 'E18'); assert.equal(candidates[0].terminal, 'T3');
  assert.equal(candidates[0].departureZone, 'Asia/Shanghai'); assert.equal(candidates[0].arrivalZone, 'Asia/Tokyo');
  assert.equal(flightCandidates(payload([row({ aircraftType: '空客', miniAirplaneModels: 'A330-343', generic: 'A333' })]), input)[0].aircraft, 'A330-343');
  assert.equal(flightCandidates(payload([row({ aircraftType: '空客' })]), input)[0].aircraft, '');
  assert.equal(flightQuery({ ...input, service: 'ｃａ １８１' }).fnum, 'CA181');
  assert.deepEqual(flightCandidates(payload([]), input), []);
  assert.throws(() => flightCandidates({ structuredContent: { kind: 'collection', items: [], error: { code: 'NO_ACCESS', message: 'private' } } }, input), /未能完成/);
  assert.throws(() => flightCandidates({ structuredContent: { flights: [] } }, input), /返回结构/);
});

test('offset-bearing timestamps convert to airport-local dates, including international date changes and midnight', () => {
  const candidates = flightCandidates(payload([row({ FlightDepcode: 'SFO', FlightArrcode: 'HND', FlightDeptimePlanDate: '2026-07-19T00:00:00Z', FlightArrtimePlanDate: '2026-07-19T07:00:00Z' })]), input);
  assert.equal(candidates.length, 1); assert.equal(candidates[0].departureTime, '17:00'); assert.equal(calendarDate(candidates[0].departureDate), '2026-07-18');
  assert.equal(candidates[0].arrivalTime, '16:00'); assert.equal(calendarDate(candidates[0].arrivalDate), '2026-07-19');
  assert.equal(flightCandidates(payload([row({ FlightDeptimePlanDate: '2026-07-18 00:00:00' })]), input)[0].departureTime, '00:00');
});

test('completion protects nonempty and manually corrected fields, private ticket data and unmatched handwritten endpoints', () => {
  const target = record({ passenger: '示例旅客', identity: 'P000001', seat: '24K', seatClass: 'Y', price: '580', pnr: 'ABC123', aircraftRegistration: 'B-0001', departureTime: '07:55', origin: '我的机场记录', lockedFields: ['gate'] });
  const candidate = flightCandidates(payload([row({ passenger: 'DO NOT COPY', price: '9999', FlightAircraftReg: 'DO NOT COPY' })]), input)[0];
  const changes = flightCompletion(target, candidate), before = JSON.stringify(target);
  assert.equal(changes.departureTime, undefined); assert.equal(changes.gate, undefined); assert.equal(changes.originCode, undefined);
  assert.equal(changes.destinationCode, 'HND'); assert.equal(changes.aircraft, 'A330-300');
  for (const key of ['passenger', 'identity', 'seat', 'seatClass', 'price', 'pnr', 'aircraftRegistration', 'boardingCode', 'ticketNumber']) assert.equal(changes[key], undefined);
  assert.equal(JSON.stringify(target), before);
  assert.deepEqual(flightCompletion(target, { ...candidate, departureDate: '2026-07-19' }), {});
  assert.deepEqual(flightCompletion(record({ origin: 'PVG' }), candidate), {});
});

function component({ rows, lookup, desktop = () => true } = {}) {
  const dom = new JSDOM(`<form><input name="service" value="CA181">${flightLookupMarkup()}</form>`), form = dom.window.document.querySelector('form');
  let current = record(), calls = 0, applied = 0;
  const dispose = bindFlightLookup(form, { getRecord: () => current, getKey: () => 'local-test-only', canQuery: () => true, desktop,
    apply: changes => { Object.assign(current, changes); applied++; }, lookup: async (...args) => { calls++; return lookup ? lookup(...args) : rows; } });
  return { dom, form, dispose, get current() { return current; }, get calls() { return calls; }, get applied() { return applied; } };
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 5)); };

test('typing never calls a provider; one candidate fills automatically and repeat clicks reuse the local result', async () => {
  const instance = component({ rows: flightCandidates(payload([row()]), input) });
  try {
    instance.form.querySelector('[name=service]').dispatchEvent(new instance.dom.window.Event('input', { bubbles: true }));
    assert.equal(instance.calls, 0);
    instance.form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.equal(instance.calls, 1); assert.equal(instance.applied, 1); assert.equal(instance.current.originCode, 'PEK');
    instance.form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.equal(instance.calls, 1); assert.equal(instance.applied, 1);
    assert.match(instance.form.querySelector('[data-flight-status]').textContent, /均已填写/);
  } finally { instance.dispose(); instance.dom.window.close(); }
});

test('provider aircraft names agree across fields or leave the aircraft field for review', async () => {
  const [compatible] = flightCandidates(payload([row({ miniAirplaneModels: '737-8Q8', generic: 738, aircraftType: 'Boeing 737' })]), input);
  assert.equal(compatible.aircraft, '737-8Q8');
  const [shared] = flightCandidates(payload([row({ miniAirplaneModels: 'B739', generic: '737-924ER', aircraftType: 'Boeing 737' })]), input);
  assert.equal(shared.aircraft, '737-924ER');
  const [conflicting] = flightCandidates(payload([row({ miniAirplaneModels: '737-8Q8', generic: 'B38M', aircraftType: '波音' })]), input);
  assert.equal(conflicting.aircraft, '');
  assert.deepEqual(conflicting.aircraftConflicts, ['737-8Q8', '737 MAX 8']);
  for (const [candidate, current] of [[conflicting, ''], [compatible, '737 MAX 8']]) {
    const instance = component({ rows: [candidate] });
    try {
      instance.current.aircraft = current;
      instance.form.querySelector('[data-flight-lookup]').click();
      await settle();
      assert.equal(instance.current.aircraft, current);
      assert.equal(instance.current.gate, 'E18');
      assert.match(instance.form.querySelector('[data-flight-status]').textContent, /机型有出入.*请核对/);
    } finally { instance.dispose(); instance.dom.window.close(); }
  }
});

test('several legs require a choice, while a changed query or closed editor discards late results', async () => {
  const rows = flightCandidates(payload([row(), row({ FlightDepcode: 'PVG', FlightArrcode: 'HKG', FlightDeptimePlanDate: '2026-07-18 13:00:00' })]), input);
  const instance = component({ rows });
  try {
    instance.form.querySelector('[data-flight-lookup]').click(); await settle(); assert.equal(instance.applied, 0);
    assert.equal(instance.form.querySelectorAll('[data-flight-candidate]').length, 2);
    instance.form.querySelector('[data-flight-candidate="1"]').click(); assert.equal(instance.applied, 1); assert.equal(instance.current.originCode, 'PVG');
    instance.form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.equal(instance.calls, 1); assert.equal(instance.form.querySelectorAll('[data-flight-candidate]').length, 0);
  } finally { instance.dispose(); instance.dom.window.close(); }
  for (const close of [false, true]) {
    let resolve; const stale = component({ lookup: () => new Promise(done => { resolve = done; }) });
    stale.form.querySelector('[data-flight-lookup]').click();
    if (close) stale.dispose(); else stale.current.service = 'CA182';
    resolve(rows); await settle(); assert.equal(stale.applied, 0);
    stale.dispose(); stale.dom.window.close();
  }
  const mobile = component({ desktop: () => false, rows });
  mobile.form.querySelector('[data-flight-lookup]').click(); await settle(); assert.equal(mobile.calls, 0);
  mobile.dispose(); mobile.dom.window.close();
});
