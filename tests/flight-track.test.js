import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { createRecord, validateRecord } from '../src/model.js';
import { flightTrackDistanceKm, flightTrackRequest, readFlightTrack } from '../src/flight-track.js';
import { journeyNetwork, networkGeometry } from '../src/journey-map-model.js';
import { journeyStatistics } from '../src/statistics-model.js';
import { prepareCloud } from './helpers/cloud.js';

const flight = createRecord({
  id: 'test-flight', type: 'flight', template: 'air-boarding-pass', service: 'JL62',
  origin: 'NRT', destination: 'LAX', departureDate: '2026-11-23', passenger: 'TEST/PASSENGER', identity: 'P000001', seat: '12A', seatClass: 'Y',
  flightStop: { fnum: 'JL62', date: '2026-11-23', dep: 'NRT', arr: 'LAX', airport: 'ANC' }
});
const flightStr = 'JL62_NRT_LAX_2026-11-23_0';
const coordinates = [
  [[140.39, 35.77], [154.5, 43.3], [177.4, 46.9], [-177.2, 47.1]],
  [[-151.3, 45.5], [-136.2, 40.1], [-118.41, 33.94]],
];
const payload = { kind: 'collection', items: [{ flightStr, trackLine: { type: 'MultiLineString', coordinates } }] };
const domesticFlightStr = 'MF8179_PKX_XNN_2026-08-11_0';
const domesticRow = { fnum: 'MF8179', dep: 'PKX', arr: 'XNN', date: '2026-08-11_0',
  coordinates: '39.499752,116.406731;38.549,110.092;36.527,102.044' };
const domesticTrack = { kind: 'collection', items: [domesticRow] };
const domesticCoordinates = [[[116.40673, 39.49975], [110.092, 38.549], [102.044, 36.527]]];

test('flight tracks are keyed to the dated airport pair and never change the journey map', () => {
  assert.equal(flightTrackRequest(flight), flightStr);
  assert.throws(() => flightTrackRequest({ ...flight, destination: '', destinationCode: '' }), /到达机场/);
  assert.throws(() => flightTrackRequest({ ...flight, flightStatus: 'open' }), /无法查询/);
  const track = readFlightTrack({ content: [{ type: 'text', text: JSON.stringify(payload) }] }, flightStr, '2026-11-24T00:00:00.000Z');
  assert.deepEqual(track.segments, coordinates);
  assert.equal(readFlightTrack({ structuredContent: { items: [] } }, flightStr), undefined);
  assert.throws(() => readFlightTrack({ structuredContent: { ...payload, items: [{ ...payload.items[0], flightStr: 'other-flight' }] } }, flightStr), /无法识别/);
  assert.throws(() => readFlightTrack({ structuredContent: { type: 'LineString', coordinates: [[180.01, 35], [181, 20]] } }, flightStr), /没有可绘制/);
  const saved = validateRecord({ ...flight, flightTrack: track });
  assert.deepEqual(saved.flightTrack, track);
  assert.equal(validateRecord({ ...saved, service: 'JL63' }).flightTrack, undefined);
  assert.equal(validateRecord({ ...saved, deleted: true }).flightTrack, undefined);
  const geometry = record => networkGeometry(journeyNetwork([record]));
  assert.equal(geometry(saved).routes[0].path, geometry(flight).routes[0].path);
  const routeWithStops = geometry(saved), direct = geometry({ ...saved, flightStop: undefined });
  assert.equal(routeWithStops.routes[0].path, direct.routes[0].path);
  assert.deepEqual(routeWithStops.nodes.map(node => node.code), ['NRT', 'LAX']);
  assert.deepEqual(readFlightTrack({ structuredContent: domesticTrack }, domesticFlightStr).segments, domesticCoordinates);
  assert.throws(() => readFlightTrack({ structuredContent: { items: [{ ...domesticRow, date: '2026-08-12_0' }] } }, domesticFlightStr), /无法识别/);
});

test('flight track queries run in the editor and saved tracks replay in details', async () => {
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>', {
    url: 'http://localhost/#archive', pretendToBeVisual: true,
  });
  const { window } = dom;
  Object.defineProperty(window.navigator, 'userAgent', { value: 'Mozilla/5.0 (Windows NT 10.0) Chrome/142.0', configurable: true });
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let sequence = 0;
  const frames = new Map();
  window.requestAnimationFrame = callback => { frames.set(++sequence, callback); return sequence; };
  window.cancelAnimationFrame = id => frames.delete(id);
  const step = time => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(time));
  };
  const server = await prepareCloud([flight], { flightMcpKey: 'fixture-key' });
  const requests = [];
  let connections = 0, finishTrack;
  globalThis.fetch = async (url, options = {}) => {
    if (!String(url).startsWith('https://c-gw.variflight.com/')) return server.fetch(url, options);
    const message = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    if (message.method === 'initialize') connections++;
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'tools/call') requests.push(message.params);
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-03-26' };
    else if (message.params.name === 'getFlightStatus') result = { structuredContent: { kind: 'collection', items: [{
      FlightNo: 'MF8179', FlightDepcode: 'PKX', FlightArrcode: 'XNN', FlightDeptimePlanDate: '2026-08-11 18:05:00',
      FlightArrtimePlanDate: '2026-08-11 20:30:00', FlightCompany: '厦门航空', aircraftNumber: 'B5846',
    }] }};
    else if (message.params.arguments.flightStr === domesticFlightStr) {
      await new Promise(resolve => { finishTrack = resolve; });
      result = { structuredContent: domesticTrack };
    } else result = { structuredContent: payload };
    return Response.json({ id: message.id, result }, { headers: { 'Mcp-Session-Id': 'fixture-session' } });
  };
  function element(selector) { return window.document.querySelector(selector); }
  async function waitFor(predicate) {
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = predicate();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('Flight track UI did not settle: ' + (element('#editor-error')?.textContent || element('[data-flight-status]')?.textContent || ''));
  }

  try {
    await import('../src/app.js');
    await waitFor(() => element('[data-action=new]:not(:disabled)'));
    element('[data-action=view]').click();
    await waitFor(() => element('.ticket-detail-modal'));
    assert.equal(element('[data-flight-track]'), null);
    assert.equal(element('[data-flight-track-query]'), null);
    element('[data-action=edit]').click();
    const query = await waitFor(() => element('[data-flight-track-query]:not(:disabled)'));
    assert.equal(requests.length, 0);
    query.click();
    query.click();
    await waitFor(() => element('[data-flight-status]')?.textContent.includes('已带入飞行航迹'));
    assert.equal(server.records()[0].flightTrack, undefined);
    element('#editor-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(() => !element('dialog'));
    element('[data-action=view]').click();
    const play = await waitFor(() => element('[data-flight-track-play]:not([hidden])'));
    assert.equal(element('[data-flight-track-query]'), null);
    assert.deepEqual(requests, [{ name: 'getFlightTrackLine', arguments: { flightStr } }]);
    assert.deepEqual(server.records()[0].flightTrack.segments, coordinates);
    assert.equal(server.records()[0].passenger, 'TEST/PASSENGER');
    assert.match(element('[data-flight-track-source]').textContent, /航迹约 [\d,.]+ km/);
    const svg = element('.flight-track-frame svg'), [first, second] = svg.querySelectorAll('.flight-track-highlight path');
    assert.ok(Number(svg.getAttribute('viewBox').split(' ')[2]) < 400, 'fits across the date line');
    const cityLabels = [...svg.querySelectorAll('.route-city text')].map(label => label.textContent);
    assert.ok(cityLabels.includes('东京') && cityLabels.includes('洛杉矶'));
    const marker = svg.querySelector('[data-flight-stopover="ANC"]');
    assert.match(marker?.querySelector('title').textContent ?? '', /经停.*ANC/);
    assert.match(marker?.querySelector('text').textContent ?? '', /经停/);
    assert.equal(svg.hasAttribute('data-flight-track-played'), false);
    play.click();
    step(0);
    step(1950);
    assert.ok(Number(first.style.strokeDashoffset) < 1);
    assert.equal(second.style.strokeDashoffset, '1');
    assert.ok(svg.querySelector('[data-flight-track-aircraft]').hasAttribute('transform'));
    step(5999);
    assert.ok(svg.hasAttribute('data-flight-track-playing'));
    step(6000);
    assert.equal(second.style.strokeDashoffset, '0');
    assert.equal(svg.hasAttribute('data-flight-track-playing'), false);
    const initialView = svg.getAttribute('viewBox');
    element('.flight-track-frame [data-route-zoom="in"]').click();
    step(6020);
    assert.notEqual(svg.getAttribute('viewBox'), initialView);
    const zoomedView = svg.getAttribute('viewBox');
    svg.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    step(6040);
    assert.notEqual(svg.getAttribute('viewBox'), zoomedView);
    element('.flight-track-frame [data-route-zoom="fit"]').click();
    step(6060);
    assert.equal(svg.getAttribute('viewBox'), initialView);
    assert.ok(svg.querySelector('[data-flight-stopover="ANC"]'));
    play.click();
    assert.equal(first.style.strokeDashoffset, '1');
    element('[data-action=close-modal]').click();
    await waitFor(() => !element('dialog'));
    assert.equal(frames.size, 0);

    Object.defineProperty(window.navigator, 'userAgent', { value: 'iPhone', configurable: true });
    window.matchMedia = () => ({ matches: true });
    element('[data-action=view]').click();
    const savedPlay = await waitFor(() => element('[data-flight-track-play]:not([hidden])'));
    savedPlay.click();
    assert.equal(frames.size, 1);
    step(0);
    step(700);
    assert.ok(Number(element('.flight-track-highlight path').style.strokeDashoffset) > 0);
    step(6000);
    assert.equal(element('.flight-track-highlight path').style.strokeDashoffset, '0');
    assert.equal(requests.length, 1);

    element('[data-action=close-modal]').click();
    await waitFor(() => !element('dialog'));
    Object.defineProperty(window.navigator, 'userAgent', { value: 'Chrome/158' });
    element('[data-action=new]').click();
    await waitFor(() => element('#editor-form'));
    const fill = (name, value) => {
      const field = element('#editor-form').elements[name];
      field.value = value;
      field.dispatchEvent(new window.Event('input', { bubbles: true }));
    };
    fill('type', 'flight');
    await waitFor(() => element('[data-flight-lookup]'));
    fill('service', 'MF8179');
    fill('departureDate', '2026-08-11');
    fill('passenger', 'TEST/PASSENGER');
    fill('identity', 'P000001');
    fill('seat', '12A');
    fill('seatClass', 'Y');
    element('[data-flight-lookup]').click();
    await waitFor(() => finishTrack);
    const editor = element('#editor-form');
    assert.equal(editor.elements.originCode.value, 'PKX');
    assert.equal(editor.elements.destinationCode.value, 'XNN');
    assert.equal(element('[data-flight-track-play]'), null);
    editor.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(server.records().length, 1);
    finishTrack();
    const savedFlight = await waitFor(() => server.records().find(record => record.service === 'MF8179'));
    assert.deepEqual(savedFlight.flightTrack.segments, domesticCoordinates);
    const mileage = journeyStatistics(server.records(), { dateTo: '2026-11-24' }, '2026-11-24');
    assert.equal(mileage.actualFlightDistanceTrips, 2);
    const expected = flightTrackDistanceKm({ segments: coordinates }) + flightTrackDistanceKm({ segments: domesticCoordinates });
    assert.equal(mileage.actualFlightDistance, expected);
    assert.deepEqual(requests.slice(1), [
      { name: 'getFlightStatus', arguments: { fnum: 'MF8179', date: '2026-08-11' } },
      { name: 'getFlightTrackLine', arguments: { flightStr: domesticFlightStr } },
    ]);
    assert.equal(connections, 2);
    await waitFor(() => !element('dialog'));
    element(`[data-action="view"][data-id="${savedFlight.id}"]`).click();
    const labels = await waitFor(() => element('[data-flight-track-labels]'));
    assert.deepEqual([...labels.querySelectorAll('.route-city.along-route text')].map(label => label.textContent), ['北京', '西宁']);
    assert.ok([...labels.querySelectorAll('.route-province text')].some(label => label.textContent === '山西'));
  } finally {
    window.dispatchEvent(new window.Event('offline'));
    window.close();
  }
});
