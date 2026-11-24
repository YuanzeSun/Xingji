import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { prepareCloud } from './helpers/cloud.js';

test('the editor fills a flight through the provider, preserves private input and saves the selected schedule and attribution', async () => {
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>', { url: 'http://localhost/#archive' }), { window } = dom;
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0) Chrome/142.0' });
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData', 'Image']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
  window.scrollTo = () => {}; window.HTMLDialogElement.prototype.showModal = function() { this.open = true; }; window.HTMLDialogElement.prototype.close = function() { this.open = false; }; globalThis.confirm = () => true;
  const server = await prepareCloud([], { flightMcpKey: 'fixture-key-only' }), providerCalls = [];
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://c-gw.variflight.com/')) return server.fetch(url, options);
    const message = JSON.parse(options.body); providerCalls.push(message);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26' } :
      message.params.name === 'getFlightTrackLine' ? { structuredContent: { kind: 'collection', items: [{
        fnum: 'CA181', dep: 'PEK', arr: 'HND', date: '2026-07-18_0', coordinates: '40.08,116.59;35.55,139.78',
      }] }} : { structuredContent: { kind: 'collection', items: [{ FlightNo: 'CA181', FlightDepcode: 'PEK', FlightArrcode: 'HND', FlightDeptimePlanDate: '2026-07-18 08:45:00', FlightArrtimePlanDate: '2026-07-18 12:50:00', FlightDeptimeDate: '2026-07-18 09:15:00', FlightArrtimeDate: '2026-07-18 13:15:00', distance: 2100, FlightCompany: '中国国际航空', FlightDepTerminal: 'T3', BoardGate: 'E12', aircraftType: '空客', miniAirplaneModels: 'A330-343', generic: 'A333' }] } };
    return Response.json({ id: message.id, result }, { headers: { 'Mcp-Session-Id': 'fixture-session' } });
  };
  const wait = async fn => { for (let i = 0; i < 250; i++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Flight lookup did not settle'); };
  const fill = (name, value) => { const input = document.querySelector(`#editor-form [name="${name}"]`); input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); };
  try {
    const db = await import('../src/db.js'); await import('../src/app.js'); await wait(() => document.querySelector('[data-action=new]:not(:disabled)'));
    document.querySelector('[data-action=new]').click(); await wait(() => document.querySelector('#editor-form'));
    fill('type', 'flight'); assert.ok(document.querySelector('.flight-lookup'));
    fill('service', 'CA181'); fill('departureDate', '2026-07-18'); fill('passenger', 'LI/MING'); fill('identity', 'P000001'); fill('seat', '24K'); fill('seatClass', 'Y'); fill('price', '580'); fill('pnr', 'ABC123'); fill('aircraftRegistration', 'B-0001');
    assert.equal(providerCalls.length, 0);
    document.querySelector('[data-flight-lookup]').click(); await wait(() => document.querySelector('[data-flight-status]').textContent.includes('已带入飞行航迹'));
    assert.equal(document.querySelector('[name=originCode]').value, 'PEK'); assert.equal(document.querySelector('[name=destinationCode]').value, 'HND');
    assert.equal(document.querySelector('[name=departureTime]').value, '08:45'); assert.equal(document.querySelector('[name=arrivalDate]').value, '2026-07-18'); assert.equal(document.querySelector('[name=arrivalTime]').value, '12:50');
    assert.equal(document.querySelector('[name=actualDepartureTime]').value,'09:15');assert.equal(document.querySelector('[name=actualArrivalTime]').value,'13:15');assert.equal(document.querySelector('[name=flightDistance]').value,'2100');
    assert.match(document.querySelector('[name=departureTime]').closest('.field').textContent,/计划起飞时间/);assert.equal(document.querySelector('[name=actualDepartureTime]').required,false);assert.equal(document.querySelector('[name=actualDepartureDateYear]').type,'number');
    assert.equal(document.querySelector('[name=aircraft]').value, 'A330-343'); assert.equal(document.querySelector('[name=gate]').value, 'E12');
    assert.equal(document.querySelector('[data-field-source="aircraft"]').textContent,'飞常准');assert.equal(document.querySelector('[data-field-source="passenger"]').textContent,'手动输入');
    assert.equal(document.querySelector('[name=passenger]').value, 'LI/MING'); assert.equal(document.querySelector('[name=price]').value, '580'); assert.equal(document.querySelector('[name=aircraftRegistration]').value, 'B-0001');
    assert.equal(document.querySelector('#city-reference'),null);
    assert.match(document.querySelector('#editor-preview').textContent, /A330-343/);
    document.querySelector('[data-flight-lookup]').click(); await wait(() => document.querySelector('[data-flight-status]').textContent.includes('均已填写'));
    assert.deepEqual(providerCalls.filter(call => call.method === 'tools/call').map(call => call.params), [
      { name: 'getFlightStatus', arguments: { fnum: 'CA181', date: '2026-07-18' } },
      { name: 'getFlightTrackLine', arguments: { flightStr: 'CA181_PEK_HND_2026-07-18_0' } },
    ]);
    document.querySelector('#editor-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await wait(() => !document.querySelector('dialog'));
    const saved = (await db.get('records', []))[0];
    assert.equal(saved.departureZone,'Asia/Shanghai');assert.equal(saved.arrivalZone,'Asia/Tokyo');
    assert.equal(saved.departureTime, '08:45'); assert.equal(saved.arrivalTime, '12:50'); assert.equal(saved.seat, '24K'); assert.equal(saved.pnr, 'ABC123');
    assert.equal(saved.actualDepartureTime,'09:15');assert.equal(saved.actualArrivalTime,'13:15');assert.equal(saved.flightDistance,'2100');assert.equal(saved.fieldSources.actualDepartureTime,'variflight');
    assert.equal(saved.fieldSources.departureTime,'variflight');assert.equal(saved.fieldSources.passenger,'manual');
    assert.ok(saved.sources.some(source => source.kind === 'flight-lookup')); assert.ok(saved.sources.some(source => source.kind === 'manual'));
    assert.equal(JSON.stringify(saved).includes('fixture-key-only'), false);
    document.querySelector('[data-action=\"navigate\"][data-page=\"archive\"]').click();await wait(()=>document.querySelector('[data-action=\"view\"]'));document.querySelector('[data-action=\"view\"]').click();await wait(()=>document.querySelector('.detail-grid'));
    assert.match(document.querySelector('.detail-grid').textContent,/计划起飞时间08:45/);assert.match(document.querySelector('.detail-grid').textContent,/实际起飞时间09:15/);assert.doesNotMatch(document.querySelector('.detail-preview').textContent,/09:15|13:15/);
  } finally { window.dispatchEvent(new window.Event('offline')); dom.window.close(); }
});
