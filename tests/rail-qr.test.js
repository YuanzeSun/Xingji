import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { prepareZXingModule, writeBarcode } from 'zxing-wasm';
import { prepareCodeReader } from '../src/code-reader.js';
import { symbolImage } from '../src/barcode-symbols.js';
import { calendarDate } from '../src/journey-date.js';
import { DEMO_RAIL_TICKET_CODE } from '../src/demo-code.js';
import { readRailTicketCode } from '../src/rail-ticket-qr.js';
import { prepareCloud } from './helpers/cloud.js';

// Fictional tickets with known station codes, a dummy document number and no live travel credentials.
const seated = atob(DEMO_RAIL_TICKET_CODE.rawBytes);
const standing = '030012341064623109317508991203631625372805544524257810305361407165728357739203412400109157259042921432129118396822614114445042278628926037766000';
const qr = payload => ({ format: 'QRCode', rawBytes: btoa(payload) });

test('rail QR decoding recovers both 144-digit variants and rejects unrelated payloads', () => {
  const seat = readRailTicketCode(qr(seated), 2026);
  assert.deepEqual([seat.origin, seat.destination, seat.service], ['北京南', '上海虹桥', 'G103']);
  assert.equal(calendarDate(seat.departureDate), '2025-11-24');
  assert.deepEqual([seat.departureTime, seat.passenger, seat.identity], ['08:15', '李', '100000000000000001']);
  assert.deepEqual([seat.carriage, seat.seatClass, seat.seat, seat.railStanding, seat.price], ['03', '二等座', '10F', false, '553.5']);
  assert.equal(seat.saleCode, '12345670001121A001234');
  const noSeat = readRailTicketCode(qr(standing), 2026);
  assert.deepEqual([noSeat.ticketNumber, noSeat.passenger, noSeat.departureTime, noSeat.railStanding, noSeat.seat], ['D001234', '李', '08:15', true, '']);
  assert.equal(readRailTicketCode(qr('A1234567890B123456'), 2026), null);
  assert.equal(readRailTicketCode(qr('0'.repeat(144)), 2026), null);
  assert.equal(readRailTicketCode(qr('https://example.test/rail'), 2026), null);
});

test('rail QR entry queries RailGo once and locks the separate photo scan until the code is removed', async () => {
  await prepareCodeReader({ wasmBinary: await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') });
  await prepareZXingModule({ overrides: { wasmBinary: await readFile('node_modules/zxing-wasm/dist/full/zxing_full.wasm') }, fireImmediately: true });
  const fixture = await writeBarcode(seated, { format: 'QRCode', addQuietZones: true });
  const pixels = symbolImage(fixture.symbol);
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',
    { url: 'http://localhost:4173/#import' });
  const { window } = dom;
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
  }
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
  class FixtureImage {
    naturalWidth = pixels.width;
    naturalHeight = pixels.height;
    async decode() {}
  }
  Object.defineProperty(globalThis, 'Image', { value: FixtureImage, configurable: true });

  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  globalThis.confirm = () => true;
  let stopped = 0;
  Object.defineProperty(window.navigator, 'mediaDevices', {
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) },
  });
  window.HTMLVideoElement.prototype.play = async () => {};
  window.HTMLVideoElement.prototype.pause = () => {};
  Object.defineProperties(window.HTMLVideoElement.prototype, {
    readyState: { get: () => 2 }, videoWidth: { get: () => pixels.width }, videoHeight: { get: () => pixels.height },
  });
  window.HTMLCanvasElement.prototype.getContext = () => ({
    drawImage() {}, fillRect() {}, getImageData: () => pixels,
  });
  const imageBlob = new Blob([await fixture.image.arrayBuffer()], { type: 'image/png' });
  window.HTMLCanvasElement.prototype.toBlob = callback => callback(imageBlob);

  const server = await prepareCloud();
  const archiveFetch = globalThis.fetch, railQueries = [];
  globalThis.fetch = async (url, options) => {
    const request = new URL(url);
    if (request.hostname === 'api.github.com') return archiveFetch(url, options);
    if (request.pathname !== '/api/v2/getTrainMain') return Response.json({ success: false });
    railQueries.push([...request.searchParams]);
    return Response.json({ success: true, data: {
      numberFull: ['G103'], rundays: ['20251124'], car: 'CR400BF-S',
      timetable: [
        { station: '北京南', day: 0, arrive: '', depart: '08:15' },
        { station: '上海虹桥', day: 0, arrive: '12:45', depart: '' },
      ],
    } });
  };
  const waitFor = async predicate => {
    for (let i = 0; i < 250; i++) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('Rail scanner did not settle: ' + (document.querySelector('#code-error')?.textContent || ''));
  };
  const form = () => document.querySelector('#editor-form');
  const field = name => form().elements[name];
  const fill = (name, value) => {
    field(name).value = value;
    field(name).dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const submit = () => form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  try {
    await import('../src/app.js');
    await waitFor(() => document.querySelector('.manual-panel [data-action="new"]:not(:disabled)'));
    document.querySelector('.manual-panel [data-action="new"]').click();
    await waitFor(form);
    const scanEntry = form().querySelector('[data-rail-qr-entry]');
    const photoEntry = () => form().querySelector('[data-rail-photo-entry]');
    assert.equal(scanEntry.nextElementSibling, photoEntry());
    assert.equal(photoEntry().open, false);
    assert.equal(scanEntry.querySelector('[data-code-start]').textContent, '相机扫描');
    assert.equal(scanEntry.querySelector('[data-code-upload]').textContent, '上传图片');
    assert.ok(scanEntry.querySelector('[data-code-examples]:not([hidden]) svg'));
    assert.equal(photoEntry().querySelector('[data-rail-photo]').textContent, '相机扫描');
    assert.equal(photoEntry().querySelector('[data-rail-photo-upload]').textContent, '上传图片');
    assert.equal(photoEntry().querySelector('[data-rail-photo-controls]').disabled, false);
    fill('service', 'G999');
    fill('departureDate', '2026-01-01');
    form().querySelector('[data-rail-standing]').click();

    form().querySelector('[data-code-start]').click();
    await waitFor(() => form()?.querySelector('#code-status')?.textContent.includes('二维码字段已锁定'));
    assert.equal(stopped, 1);
    assert.equal(photoEntry().open, false);
    assert.equal(photoEntry().querySelector('[data-rail-photo-lock]').hidden, false);
    assert.equal(photoEntry().querySelector('[data-rail-photo-controls]').disabled, true);
    assert.ok(form().querySelector('[data-code-examples][hidden]'));
    await waitFor(() => field('railModel').value === 'CR400BF-S');
    assert.deepEqual(railQueries, [[['trainNum', 'G103'], ['date', '20251124']]]);
    assert.equal(field('arrivalTime').value, '12:45');
    for (const [name, value] of Object.entries({ service: 'G103', origin: '北京南', destination: '上海虹桥', departureTime: '08:15', passenger: '李', carriage: '03', price: '553.5', ticketNumber: 'A001234' })) {
      assert.equal(field(name).value, value, name);
      assert.equal(field(name).readOnly, true, name);
    }
    assert.equal(form().querySelector('[data-rail-standing]').checked, false);
    assert.equal(form().querySelector('[data-rail-standing]').disabled, true);
    assert.equal(form().querySelector('[data-seat-number]').value, '10F');
    assert.equal(form().querySelector('[data-seat-number]').readOnly, true);
    assert.equal(form().querySelector('[data-seat-preset]').disabled, true);
    assert.equal(field('departureDateMonth').disabled, true);
    assert.equal(field('departureDateDay').disabled, true);
    assert.equal(field('departureDateYear').readOnly, false);
    fill('departureDateYear', '2018');
    fill('departureDateDay', '01');
    fill('service', 'G998');
    fill('gate', 'A9');
    assert.equal(field('service').value, 'G103');
    assert.equal(field('departureDateDay').value, '24');
    submit();
    await waitFor(() => !form() && server.records().length === 1);
    const [record] = server.records();
    assert.equal(record.gate, 'A9');
    assert.equal(calendarDate(record.departureDate), '2018-11-24');
    assert.equal(record.fieldSources.departureDate, 'barcode');
    assert.equal(record.fieldSources.departureDateYear, 'manual');
    assert.equal(record.ticketCode.rawBytes, btoa(seated));
    assert.ok(record.lockedFields.includes('seat'));

    document.querySelector('[data-action="navigate"][data-page="archive"]').click();
    await waitFor(() => document.querySelector('[data-action="view"]'));
    document.querySelector('[data-action="view"]').click();
    await waitFor(() => document.querySelector('[data-action="edit"]:not(:disabled)'));
    document.querySelector('[data-action="edit"]').click();
    await waitFor(form);
    assert.equal(field('service').readOnly, true);
    assert.equal(photoEntry().querySelector('[data-rail-photo-controls]').disabled, true);
    assert.equal(railQueries.length, 1);
    form().querySelector('#code-remove').click();
    assert.equal(field('service').readOnly, false);
    assert.equal(field('departureDateDay').disabled, false);
    assert.equal(form().querySelector('[data-seat-number]').readOnly, false);
    assert.equal(form().querySelector('[data-seat-number]').value, '10F');
    assert.equal(photoEntry().querySelector('[data-rail-photo-controls]').disabled, false);
    assert.equal(photoEntry().querySelector('[data-rail-photo-lock]').hidden, true);
    fill('service', 'G105');
    submit();
    await waitFor(() => !form() && server.records()[0].service === 'G105');
    assert.equal(server.records()[0].ticketCode, '');
    assert.equal(server.records()[0].lockedFields.includes('seat'), false);
  } finally {
    window.dispatchEvent(new window.Event('offline'));
    dom.window.close();
  }
});
