import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { archive, createRecord, readArchive, validateRecord } from '../src/model.js';
import { flightCandidates, flightCompletion, flightLookupNeeds, rotationRegistration } from '../src/flight-lookup-model.js';
import { flightQuery } from '../src/flight-query.js';
import { bindFlightLookup, flightLookupMarkup } from '../src/flight-lookup.js';
import { FlightConnector } from '../src/mcp.js';

const input = { type: 'flight', service: 'CA181', departureDate: '2026-07-18' };
const row = extra => ({ FlightNo: 'CA181', FlightDepcode: 'PEK', FlightArrcode: 'HND', FlightDeptimePlanDate: '2026-07-18 08:00:00', FlightArrtimePlanDate: '2026-07-18 12:20:00', FlightDeptimeDate: '2026-07-18 09:00:00', FlightArrtimeDate: '2026-07-18 13:20:00', distance: 2100, scheduledBoardingTime: '07:25', aircraftNumber: 'B306R', FlightCompany: '中国国际航空', FlightDepTerminal: 'T3', BoardGate: 'E18', aircraftType: 'Airbus A330-300', StopFlag: '0', ...extra });
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

test('stopovers stay tied to the dated airport pair and are recorded only when the airport is confirmed', () => {
  const trip = { ...input, origin: 'PEK', destination: 'HND' };
  const matching = rows => flightCandidates(payload(rows), trip)[0];
  const candidate = matching([row({ StopFlag: '1', StopAirportCode: 'KIX', LegFlag: '0' })]);
  const stop = { fnum: 'CA181', date: '2026-07-18', dep: 'PEK', arr: 'HND', airport: 'KIX' };
  assert.deepEqual(candidate.flightStop, stop);
  assert.deepEqual(flightCompletion(record(trip), candidate).flightStop, stop);
  const saved = readArchive(JSON.parse(JSON.stringify(archive([candidate]))))[0];
  assert.deepEqual(saved.flightStop, stop);
  assert.equal(validateRecord({ ...saved, origin: 'PKX', originCode: 'PKX' }).flightStop, undefined);
  assert.equal(validateRecord({ ...saved, departureDate: { year: 2026, dayOfYear: 200 } }).flightStop, undefined);
  assert.equal(validateRecord({ ...saved, deleted: true }).flightStop, undefined);
  assert.equal(validateRecord({ ...saved, flightStop: { ...stop, airport: 'PVG,KIX' } }).flightStop, undefined);
  assert.equal(flightCompletion(record({ origin: '自己的机场' }), candidate).flightStop, undefined);
  assert.equal(flightCompletion(saved, candidate).flightStop, undefined);
  assert.equal(flightCompletion({ ...record(trip), fieldSources: { flightStop: 'manual' } }, candidate).flightStop, undefined);
  for (const rows of [
    [row()],
    [row({ StopFlag: undefined })],
    [row({ StopFlag: '1', StopAirportCode: 'HND' })],
    [row({ StopFlag: '2', StopAirportCode: 'KIX' })],
    [row({ StopFlag: undefined, StopAirportCode: 'PVG,KIX' })],
    [row({ StopFlag: '2' }), row({ StopFlag: '1', StopAirportCode: 'PVG' })],
    [row({ StopFlag: '1', StopAirportCode: 'KIX', LegFlag: '1' })],
    [row({ StopFlag: '1', StopAirportCode: 'KIX' }), row({ StopFlag: '1', StopAirportCode: 'PVG' })]
  ]) assert.equal(matching(rows).flightStop, undefined);
});

test('same-number scheduled legs can identify a stop only inside the matched itinerary', () => {
  const ticket = { ...input, origin: 'PEK', destination: 'HND' };
  const whole = row({ StopFlag: '1' });
  const intoKix = row({ FlightArrcode: 'KIX', FlightArrtimePlanDate: '2026-07-18 10:00:00' });
  const outOfKix = row({ FlightDepcode: 'KIX', FlightDeptimePlanDate: '2026-07-18 11:00:00' });
  const [candidate] = flightCandidates(payload([outOfKix, whole, intoKix]), ticket);
  assert.equal(candidate.flightStop.airport, 'KIX');
  const [subLeg] = flightCandidates(payload([outOfKix, whole, intoKix]), { ...ticket, origin: 'KIX' });
  assert.equal(subLeg.flightStop, undefined);
  for (const invalid of [{ FlightNo: 'CA182' }, { LegFlag: '1' }, { LegFlag: '2' },
    { FlightDeptimePlanDate: '2026-07-18 09:00:00' }, { FlightArrtimePlanDate: '2026-07-19 12:20:00' }]) {
    const [unverified] = flightCandidates(payload([whole, intoKix, { ...outOfKix, ...invalid }]), ticket);
    assert.equal(unverified.flightStop, undefined);
  }
});

test('a codeshare keeps the booked flight while identifying the marketing and operating airlines', () => {
  const input = { service: 'CA7941', departureDate: '2025-01-06', origin: 'SZX', destination: 'KIX' };
  const codeshare = row({
    FlightNo: 'CA7941', FlightDepcode: 'SZX', FlightArrcode: 'KIX', FlightDeptimePlanDate: '2025-01-06 08:30:00',
    FlightCompany: '中国国际航空', airlinesCode: 'CA', shareFlight: 'ZH661', FlightDepTerminal: 'T3', FlightArrTerminal: 'T1', aircraftNumber: 'B8078'
  });
  const [candidate] = flightCandidates(payload([codeshare]), input);
  assert.equal(candidate.service, 'CA7941');
  assert.equal(candidate.airline, '深圳航空');
  assert.equal(candidate.marketingCarrier, 'CA');
  assert.equal(candidate.terminal, 'T3');
  const booking = createRecord({ ...input, type:'flight', template:'air-boarding-pass' });
  assert.equal(flightCompletion(booking, candidate).marketingCarrier, 'CA');
  assert.equal(flightCompletion({ ...booking, marketingCarrier: 'ZH', lockedFields: ['marketingCarrier'] }, candidate).marketingCarrier, undefined);
  const [aliased] = flightCandidates(payload([{ ...codeshare, shareFlight: '', ShareFlightNo: 'ZH0661' }]), input);
  assert.equal(aliased.airline, '深圳航空');
  const [conflict] = flightCandidates(payload([{ ...codeshare, ShareFlightNo: 'NH97' }]), input);
  assert.equal(conflict.airline, '');
  assert.equal(conflict.marketingCarrier, 'CA');
});

test('departure-terminal and airline aliases are reused without introducing another lookup', () => {
  const [fallback] = flightCandidates(payload([row({
    FlightDepTerminal: '', FlightHTerminal: 'T2', FlightArrTerminal: 'T1', FlightTerminal: 'T1',
    FlightCompany: '', aircraftNumber: '', AircraftNumber: 'B5846'
  })]), input);
  assert.equal(fallback.terminal, 'T2');
  assert.equal(fallback.airline, '中国国际航空');
  assert.equal(fallback.aircraftRegistration, 'B-5846');
  assert.equal(fallback.marketingCarrier, '');
  assert.deepEqual(flightLookupNeeds(fallback), { schedule: false, registration: false });
  const [arrivalOnly] = flightCandidates(payload([row({ FlightDepTerminal: '', FlightArrTerminal: 'T1', FlightTerminal: 'T1' })]), input);
  assert.equal(arrivalOnly.terminal, '');
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

function component({ rows, lookup, applyTrack, desktop = () => true } = {}) {
  const dom = new JSDOM(`<form><input name="service" value="CA181">${flightLookupMarkup()}</form>`), form = dom.window.document.querySelector('form');
  let current = record(), calls = 0, applied = 0;
  const dispose = bindFlightLookup(form, { getRecord: () => current, getKey: () => 'local-test-only', canQuery: () => true, desktop,
    apply: changes => { Object.assign(current, changes); applied++; }, applyTrack, lookup: async (...args) => { calls++; return lookup ? lookup(...args) : rows; } });
  return { dom, form, dispose, get current() { return current; }, get calls() { return calls; }, get applied() { return applied; } };
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 5)); };

test('only explicit scheduled boarding times fill the planned boarding field', () => {
  const [planned] = flightCandidates(payload([row({ aircraftNumber: 'b5846', scheduledBoardingTime: '2026-07-17T23:05:00Z' })]), input);
  assert.equal(planned.aircraftRegistration, 'B-5846');
  assert.equal(planned.boardingTime, '07:05');
  const [other] = flightCandidates(payload([row({ scheduledBoardingTime: '', EstimateBoardingStartTime: '07:05', actualBoardingTime: '07:10' })]), input);
  assert.equal(other.boardingTime, '');
  assert.equal(other.actualBoardingTime, '');
  const scanned = { ...record(), boardingTime: '07:15', actualBoardingTime: '07:40', lockedFields: ['boardingTime'],
    fieldSources: { boardingTime: 'barcode', actualBoardingTime: 'barcode' } };
  assert.equal(flightCompletion(scanned, planned).boardingTime, undefined);
  assert.equal(flightCompletion(scanned, planned).actualBoardingTime, undefined);
});

test('a missing registration queries only the aircraft rotation, despite a missing track', async () => {
  const [complete] = flightCandidates(payload([row()]), input);
  const instance = component({ rows: [complete], applyTrack: () => assert.fail('unexpected track query') });
  const calls = [], previousFetch = globalThis.fetch;
  const response = (arr = 'HND') => ({ structuredContent: { kind: 'item', item: {
    fnum: 'CA181', date: '2026-07-18', aircraftNumber: 'B5846',
    currentFlight: { fnum: 'CA181', departureCode: 'PEK', arrivalCode: arr, aircraftNumber: 'B-5846' }
  } } });
  assert.equal(rotationRegistration(response('NRT'), { fnum: 'CA181', date: '2026-07-18', dep: 'PEK', arr: 'HND' }), '');
  globalThis.fetch = async (_url, options) => {
    const message = JSON.parse(options.body);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'tools/call') calls.push(message.params);
    const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26' } : response();
    return Response.json({ id: message.id, result }, { headers: { 'Mcp-Session-Id': 'flight-session' } });
  };
  try {
    Object.assign(instance.current, complete, { aircraftRegistration: '',
      fieldSources: { boardingTime: 'barcode', departureTime: 'variflight' }, lockedFields: ['boardingTime'] });
    instance.form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.deepEqual(calls, [{ name: 'getAircraftRotation', arguments: { fnum: 'CA181', date: '2026-07-18', dep: 'PEK', arr: 'HND' } }]);
    assert.equal(instance.calls, 0);
    assert.equal(instance.current.aircraftRegistration, 'B-5846');
    instance.form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.equal(calls.length, 1);
  } finally { globalThis.fetch = previousFetch; instance.dispose(); instance.dom.window.close(); }
});

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
  const duplicate = code => flightCandidates(payload([
    row({ miniAirplaneModels: '737-8Q8', aircraftType: '波音' }),
    row({ generic: code, aircraftType: '波音' })
  ]), input);
  assert.equal(duplicate('B738').length, 1);
  assert.equal(duplicate('B738')[0].aircraft, '737-8Q8');
  assert.deepEqual(duplicate('B38M')[0].aircraftConflicts, conflicting.aircraftConflicts);
  const variants = [
    row({ miniAirplaneModels: '737-86J', aircraftType: 'Boeing 737' }),
    row({ miniAirplaneModels: '737-832', generic: 'B738', aircraftType: 'Boeing 737' }),
  ];
  for (const order of [variants, [...variants].reverse()]) {
    const [candidate] = flightCandidates(payload(order), input);
    assert.equal(candidate.aircraft, '737-800');
    assert.equal(candidate.aircraftConflicts, undefined);
  }
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
