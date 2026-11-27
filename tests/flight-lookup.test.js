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
const row = extra => ({ FlightNo: 'CA181', FlightDepcode: 'PEK', FlightArrcode: 'HND', FlightDeptimePlanDate: '2026-07-18 08:00:00', FlightArrtimePlanDate: '2026-07-18 12:20:00', FlightDeptimeDate: '2026-07-18 09:00:00', FlightArrtimeDate: '2026-07-18 13:20:00', distance: 2100, scheduledBoardingTime: '07:25', aircraftNumber: 'B306R', FlightCompany: '中国国际航空', FlightDepTerminal: 'T3', FlightTerminal: 'T2', BoardGate: 'E18', aircraftType: 'Airbus A330-300', StopFlag: '0', ...extra });
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
  assert.equal(candidates[0].aircraft, 'A330-300'); assert.equal(candidates[0].gate, 'E18'); assert.equal(candidates[0].departureTerminal, 'T3');
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
  assert.equal(candidate.departureTerminal, 'T3');
  assert.equal(candidate.arrivalTerminal, 'T1');
  const booking = createRecord({ ...input, type:'flight', template:'air-boarding-pass' });
  assert.equal(flightCompletion(booking, candidate).marketingCarrier, undefined);
  assert.equal(flightCompletion(booking, candidate).airline, '深圳航空');
  const scanned = { ...booking, boardingCode: { format: 'PDF417' }, boardingCodeSource: 'original' };
  assert.equal(flightCompletion(scanned, candidate).marketingCarrier, 'CA');
  assert.equal(flightCompletion({ ...scanned, marketingCarrier: 'ZH', lockedFields: ['marketingCarrier'] }, candidate).marketingCarrier, undefined);
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
  assert.equal(fallback.departureTerminal, 'T2');
  assert.equal(fallback.airline, '中国国际航空');
  assert.equal(fallback.aircraftRegistration, 'B-5846');
  assert.equal(fallback.marketingCarrier, '');
  assert.deepEqual(flightLookupNeeds(fallback), { schedule: false, terminals: false, registration: false, stopover: true });
  const [arrivalOnly] = flightCandidates(payload([row({ FlightDepTerminal: '', FlightArrTerminal: 'T1', FlightTerminal: 'T1' })]), input);
  assert.equal(arrivalOnly.departureTerminal, '');
  assert.equal(arrivalOnly.arrivalTerminal, 'T1');
  assert.deepEqual(flightLookupNeeds(arrivalOnly), { schedule: false, terminals: true, registration: false, stopover: true });
  const [official] = flightCandidates(payload([row()]), input);
  assert.equal(official.arrivalTerminal, 'T2');
});

test('completion protects nonempty and manually corrected fields, private ticket data and unmatched handwritten endpoints', () => {
  const target = record({ passenger: '示例旅客', identity: 'P000001', seat: '24K', seatClass: 'Y', price: '580', pnr: 'ABC123', aircraftRegistration: 'B-0001', departureTime: '07:55', origin: '我的机场记录', lockedFields: ['gate'] });
  const candidate = flightCandidates(payload([row({ passenger: 'DO NOT COPY', price: '9999', FlightAircraftReg: 'DO NOT COPY' })]), input)[0];
  const changes = flightCompletion(target, candidate), before = JSON.stringify(target);
  assert.equal(changes.departureTime, undefined); assert.equal(changes.gate, undefined); assert.equal(changes.originCode, undefined);
  assert.equal(changes.departureTerminal, undefined); assert.equal(changes.arrivalTerminal, 'T2');
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

test('only explicit scheduled boarding times fill the boarding time when the pass has no time', () => {
  const [planned] = flightCandidates(payload([row({ aircraftNumber: 'b5846', scheduledBoardingTime: '2026-07-17T23:05:00Z' })]), input);
  assert.equal(planned.aircraftRegistration, 'B-5846');
  assert.equal(planned.boardingTime, '07:05');
  const [other] = flightCandidates(payload([row({ scheduledBoardingTime: '', EstimateBoardingStartTime: '07:05', actualBoardingTime: '07:10' })]), input);
  assert.equal(other.boardingTime, '');
  const [fallback] = flightCandidates(payload([row({ scheduledBoardingTime: '--', FlightBoardingTimePlanDate: '2026-07-18 07:25:00' })]), input);
  assert.equal(fallback.boardingTime, '07:25');
  const scanned = { ...record(), boardingTime: '07:15', lockedFields: ['boardingTime'],
    fieldSources: { boardingTime: 'barcode' } };
  assert.equal(flightCompletion(scanned, planned).boardingTime, undefined);
});

test('completion queries missing aircraft registration and tracks, reusing each value once filled', async () => {
  const [complete] = flightCandidates(payload([row({ StopFlag: '1', StopAirportCode: 'KIX', LegFlag: '0' })]), input);
  const flightStr = 'CA181_PEK_HND_2026-07-18_0';
  const segments = [[[116.59, 40.08], [139.78, 35.55]]];
  const instance = component({ rows: [complete], applyTrack: track => { instance.current.flightTrack = track; } });
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
    const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26' } :
      message.params.name === 'getFlightTrackLine' ? payload([{ flightStr, segments }]) : response();
    return Response.json({ id: message.id, result }, { headers: { 'Mcp-Session-Id': 'flight-session' } });
  };
  try {
    const apis = () => instance.form.querySelector('[data-flight-apis]').textContent;
    Object.assign(instance.current, complete, { aircraftRegistration: '', flightTrack: { flightStr, segments },
      fieldSources: { boardingTime: 'barcode', departureTime: 'variflight' }, lockedFields: ['boardingTime'] });
    instance.form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.deepEqual(calls, [{ name: 'getAircraftRotation', arguments: { fnum: 'CA181', date: '2026-07-18', dep: 'PEK', arr: 'HND' } }]);
    assert.equal(instance.calls, 0);
    assert.equal(instance.current.aircraftRegistration, 'B-5846');
    assert.match(apis(), /getAircraftRotation/);
    instance.form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.equal(calls.length, 1);
    assert.equal(apis(), '');
    delete instance.current.flightTrack;
    instance.current.aircraftRegistration = '';
    instance.form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.deepEqual(calls.slice(1), [{ name: 'getFlightTrackLine', arguments: { flightStr } }]);
    assert.deepEqual(instance.current.flightTrack.segments, segments);
    assert.equal(instance.current.aircraftRegistration, 'B-5846');
    assert.equal(instance.calls, 0);
    assert.match(apis(), /getFlightTrackLine/);
    assert.doesNotMatch(apis(), /getAircraftRotation/);
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
    assert.equal(instance.calls, 1);
    instance.form.querySelector('[data-flight-schedule-choice=query]').click(); await settle();
    assert.equal(instance.calls, 1); assert.equal(instance.applied, 1);
    assert.match(instance.form.querySelector('[data-flight-status]').textContent, /没有可补全/);
  } finally { instance.dispose(); instance.dom.window.close(); }
});

test('a lookup fills the stopover after confirmation when every other provider field is already known', async () => {
  const [current] = flightCandidates(payload([row()]), input);
  const [candidate] = flightCandidates(payload([row({ StopFlag: '1', StopAirportCode: 'KIX', LegFlag: '0' })]), input);
  const instance = component({ rows: [candidate] });
  try {
    Object.assign(instance.current, current, { gate: 'E99' });
    const button = instance.form.querySelector('[data-flight-lookup]');
    button.click(); await settle();
    assert.equal(instance.calls, 0);
    assert.match(instance.form.querySelector('[data-flight-status]').textContent, /只缺经停机场/);
    instance.form.querySelector('[data-flight-schedule-choice=query]').click(); await settle();
    assert.equal(instance.calls, 1);
    assert.deepEqual(instance.current.flightStop, candidate.flightStop);
    assert.equal(instance.current.gate, 'E99');
    assert.match(instance.form.querySelector('[data-flight-status]').textContent, /已补全 经停机场/);
    button.click(); await settle();
    assert.equal(instance.calls, 1);
  } finally { instance.dispose(); instance.dom.window.close(); }
});

test('skipping optional flight information queries only a missing track', async () => {
  const [current] = flightCandidates(payload([row()]), input);
  const flightStr = 'CA181_PEK_HND_2026-07-18_0';
  const segments = [[[116.59, 40.08], [139.78, 35.55]]];
  const instance = component({ applyTrack: track => { instance.current.flightTrack = track; } });
  const originalFetch = globalThis.fetch, tools = [];
  globalThis.fetch = async (_url, options) => {
    const { id, method, params } = JSON.parse(options.body);
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/call') tools.push(params.name);
    const result = method === 'initialize' ? { protocolVersion: '2025-03-26' } : payload([{ flightStr, segments }]);
    return Response.json({ id, result }, { headers: { 'Mcp-Session-Id': 'flight-session' } });
  };
  try {
    Object.assign(instance.current, current, { departureTerminal: '', flightTrack: { flightStr, segments } });
    const button = instance.form.querySelector('[data-flight-lookup]');
    const status = () => instance.form.querySelector('[data-flight-status]').textContent;
    const skip = () => instance.form.querySelector('[data-flight-schedule-choice=skip]').click();
    button.click(); await settle();
    assert.match(status(), /只缺航站楼编号、经停机场/);
    skip(); await settle();
    assert.equal(status(), '已跳过航班信息查询。');
    assert.deepEqual(tools, []);
    delete instance.current.flightTrack;
    button.click(); await settle();
    assert.match(status(), /仍会查询缺失的航迹/);
    assert.deepEqual(tools, []);
    skip(); await settle();
    assert.equal(instance.calls, 0);
    assert.deepEqual(tools, ['getFlightTrackLine']);
    assert.deepEqual(instance.current.flightTrack.segments, segments);
    assert.match(status(), /已跳过航班信息查询。已带入飞行航迹/);
    assert.match(instance.form.querySelector('[data-flight-apis]').textContent, /getFlightTrackLine/);
  } finally { globalThis.fetch = originalFetch; instance.dispose(); instance.dom.window.close(); }
});

test('a failed schedule lookup can still add a track when both airports are known', async () => {
  const [current] = flightCandidates(payload([row()]), input);
  const flightStr = 'CA181_PEK_HND_2026-07-18_0';
  const segments = [[[116.59, 40.08], [139.78, 35.55]]];
  const dom = new JSDOM(`<form>${flightLookupMarkup()}</form>`), form = dom.window.document.querySelector('form');
  const draft = { ...current, gate: '' };
  const dispose = bindFlightLookup(form, { getRecord: () => draft, getKey: () => 'local-test-only', canQuery: () => true,
    desktop: () => true, apply: changes => Object.assign(draft, changes), applyTrack: track => { draft.flightTrack = track; } });
  const previousFetch = globalThis.fetch, calls = [];
  globalThis.fetch = async (_url, options) => {
    const { id, method, params } = JSON.parse(options.body);
    if (method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (method === 'tools/call') calls.push(params);
    if (params.name === 'getFlightStatus') return Response.json({ id, error: { message: '时刻暂不可用' } });
    const result = method === 'initialize' ? { protocolVersion: '2025-03-26' } : payload([{ flightStr, segments }]);
    return Response.json({ id, result }, { headers: { 'Mcp-Session-Id': 'flight-session' } });
  };
  try {
    form.querySelector('[data-flight-lookup]').click(); await settle();
    assert.deepEqual(calls.map(call => call.name), ['getFlightStatus', 'getFlightTrackLine']);
    assert.deepEqual(draft.flightTrack.segments, segments);
    assert.equal(draft.gate, '');
    assert.match(form.querySelector('[data-flight-status]').textContent, /时刻暂不可用。已带入飞行航迹/);
    assert.match(form.querySelector('[data-flight-apis]').textContent, /getFlightStatus.*getFlightTrackLine/);
  } finally { globalThis.fetch = previousFetch; dispose(); dom.window.close(); }
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
