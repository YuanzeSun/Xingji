import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { indexedDB } from 'fake-indexeddb';
import { prepareZXingModule, writeBarcode } from 'zxing-wasm';
import { prepareCodeReader, rebuildCodeSymbols } from '../src/code-reader.js';
import { symbolImage } from '../src/barcode-symbols.js';
import { bindTicketCodeEditor, ticketCodeEditor } from '../src/code-editor.js';
import { calendarDate } from '../src/journey-date.js';
import { DEMO_RAIL_LINEAR_CODE, DEMO_RAIL_TICKET_CODE } from '../src/demo-code.js';
import { createRailTicketQR, readRailTicketCode } from '../src/rail-ticket-qr.js';
import { readRailTicketScan } from '../src/rail-ticket-scan.js';
import { createRecord } from '../src/model.js';
import { renderTicketCode } from '../src/ticket-code.js';
import { ticketSVG } from '../src/tickets.js';
import { prepareCloud } from './helpers/cloud.js';

// Fictional tickets with known station codes, a dummy document number and no live travel credentials.
const seated = atob(DEMO_RAIL_TICKET_CODE.rawBytes);
const standing = '030012341064623109317508991203631625372805544524257810305361407165728357739203412400109157259042921432129118396822614114445042278628926037766000';
const qr = payload => ({ format: 'QRCode', rawBytes: btoa(payload) });
const withOffice = office => {
  const record = readRailTicketCode(qr(seated), 2025);
  return createRailTicketQR(createRecord({ ...record, saleCode: office + record.saleCode.slice(5) }));
};

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

test('a reconstructed railway QR round-trips the original fields through the printed ticket', async () => {
  const printed = readRailTicketCode(qr(seated), 2025);
  const record = createRecord({ ...printed, identity: '11010119900101001X', passenger: '欧阳𠮷' });
  const generated = createRailTicketQR(record);
  assert.match(atob(generated.rawBytes), /^\d{144}$/);
  assert.deepEqual(readRailTicketCode(generated, 2025), { ...printed, identity: record.identity, passenger: record.passenger });
  assert.equal(record.ticketCode, '');
  assert.doesNotMatch(ticketSVG({ ...record, saleCode: '' }), /data-ticket-code/);
  for (const changes of [{ identity: '1101011990****001X' }, { identity: 'E12345678' }, { ticketNumber: 'B000001' },
    { price: '553.25' }, { template: 'rail-red-barcode' }, { template: 'rail-refund-receipt' }]) {
    assert.equal(createRailTicketQR({ ...record, ...changes }), '');
  }
  const standing = { ...record, railStanding: true, seat: '' };
  assert.equal(readRailTicketCode(createRailTicketQR(standing), 2025).railStanding, true);
  const anonymous = { ...record, template: 'rail-red-qr', identity: '', passenger: '' };
  assert.equal(readRailTicketCode(createRailTicketQR(anonymous), 2025).identity, undefined);
  const newYear = { ...record, departureDate: '2026-01-02', saleCode: '12345670001230A001234' };
  assert.equal(calendarDate(readRailTicketCode(createRailTicketQR(newYear), 2026).departureDate), '2026-01-02');

  const renderedCode = renderTicketCode(record, 669, 335, 141);
  assert.match(renderedCode, /data-ticket-code/);
  assert.doesNotMatch(renderedCode, /<rect\b|自动生成/);
  assert.equal(renderedCode, renderTicketCode({ ...record, ticketCode: generated }, 669, 335, 141));
  const svg = ticketSVG(record);
  await prepareCodeReader({ wasmBinary: await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') });
  const image = new Resvg(svg, { fitTo: { mode: 'zoom', value: 2 }, font: { loadSystemFonts: false } }).render();
  const { codes, issues } = await rebuildCodeSymbols({ width: image.width, height: image.height, data: new Uint8ClampedArray(image.pixels) });
  assert.deepEqual(issues, []);
  assert.equal(codes.length, 1);
  assert.equal(codes[0].data.rawBytes, generated.rawBytes);
});

test('the rail scanner resolves a known issuing office without guessing from the departure station', () => {
  const fields = readRailTicketScan(withOffice('23693'), 2025);
  assert.deepEqual([fields.issuer, fields.origin], ['广州', '北京南']);
  assert.equal(readRailTicketScan(withOffice('00000'), 2025).issuer, undefined);
});

test('a scanned rail photo fills the issuer from its QR without replacing the OCR itinerary', { timeout: 3000 }, async t => {
  const record = createRecord({ service: 'C2021', origin: '北京南', destination: '天津', departureDate: '2025-11-24' });
  const dom = new JSDOM(`<form>${ticketCodeEditor(record, { fromScan: true })}<input name="issuer"></form>`);
  t.after(() => dom.window.close());
  const form = dom.window.document.querySelector('form');
  const added = await new Promise(resolve => {
    const dispose = bindTicketCodeEditor(form, record, resolve, {
      referenceURL: 'data:image/png;base64,AA==', autoRead: true,
      loadRebuilder: async () => async () => ({ codes: [{ format: 'QRCode', data: withOffice('23693') }], issues: [] })
    });
    t.after(dispose);
  });
  assert.equal(added.railFields, undefined);
  assert.equal(record.service, 'C2021');
  assert.equal(record.destination, '天津');
  assert.equal(form.elements.issuer.value, '广州');
  assert.equal(record.fieldSources.issuer, 'barcode');
});

test('rail entry locks QR fields and keeps Code128 archival capture separate from field recognition', async () => {
  await prepareCodeReader({ wasmBinary: await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm') });
  await prepareZXingModule({ overrides: { wasmBinary: await readFile('node_modules/zxing-wasm/dist/full/zxing_full.wasm') }, fireImmediately: true });
  const originalCode = withOffice('23693');
  const fixture = await writeBarcode(atob(originalCode.rawBytes), { format: 'QRCode', addQuietZones: true });
  let pixels = symbolImage(fixture.symbol);
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>',
    { url: 'http://localhost:4173/#archive' });
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
  let imageBlob = new Blob([await fixture.image.arrayBuffer()], { type: 'image/png' });
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
  const fieldStars = name => [...field(name).closest('.field').querySelectorAll('.required-mark:not([hidden])')].map(mark => mark.getAttribute('aria-label'));
  const fill = (name, value) => {
    field(name).value = value;
    field(name).dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const submit = () => form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  try {
    await import('../src/app.js');
    await waitFor(() => document.querySelector('[data-action="new"]:not(:disabled)'));
    document.querySelector('[data-action="new"]').click();
    await waitFor(form);
    const scanEntry = form().querySelector('[data-rail-code-entry]');
    const photoEntry = () => form().querySelector('[data-rail-photo-entry]');
    const receipt = () => form().querySelector('[data-rail-receipt]');
    assert.equal(scanEntry.nextElementSibling, receipt().closest('[data-rail-receipt-entry]'));
    assert.equal(receipt().closest('[data-rail-receipt-entry]').nextElementSibling, photoEntry());
    assert.equal(receipt().disabled, false);
    assert.equal(photoEntry().open, false);
    assert.equal(scanEntry.querySelector('[data-code-start]').textContent, '相机扫描');
    assert.equal(scanEntry.querySelector('[data-code-upload]').textContent, '上传图片');
    assert.ok(scanEntry.querySelector('[data-code-examples]:not([hidden]) svg'));
    assert.equal(photoEntry().querySelector('[data-rail-photo]').textContent, '相机扫描');
    assert.equal(photoEntry().querySelector('[data-rail-photo-upload]').textContent, '上传图片');
    assert.equal(photoEntry().querySelector('[data-rail-photo-controls]').disabled, false);
    for (const name of ['origin', 'destination', 'service', 'departureDate', 'departureTime', 'seatClass', 'passenger']) {
      assert.deepEqual(fieldStars(name), ['必填'], name);
      assert.equal(field(name).closest('.field').querySelector('.barcode-required-mark'), null, name);
    }
    for (const name of ['price', 'saleCode', 'identity']) {
      assert.deepEqual(fieldStars(name), ['生成二维码必填'], name);
      assert.equal(field(name).required, false);
    }
    assert.deepEqual(fieldStars('ticketNumber'), []);
    fill('service', 'G999');
    fill('departureDate', '2026-01-01');
    form().querySelector('[data-rail-standing]').click();

    form().querySelector('[data-code-start]').click();
    await waitFor(() => form()?.querySelector('#code-status')?.textContent.includes('二维码字段已锁定'));
    assert.equal(stopped, 1);
    assert.equal(photoEntry().open, false);
    assert.equal(photoEntry().querySelector('[data-rail-photo-lock]').hidden, false);
    assert.equal(photoEntry().querySelector('[data-rail-photo-controls]').disabled, true);
    assert.equal(receipt().disabled, true);
    assert.ok(form().querySelector('[data-code-examples][hidden]'));
    assert.deepEqual(fieldStars('price'), []);
    assert.deepEqual(fieldStars('saleCode'), []);
    assert.deepEqual(fieldStars('origin'), ['必填']);
    await waitFor(() => field('railModel').value === 'CR400BF-S');
    assert.deepEqual(railQueries, [[['trainNum', 'G103'], ['date', '20251124']]]);
    assert.equal(field('arrivalTime').value, '12:45');
    for (const [name, value] of Object.entries({ service: 'G103', origin: '北京南', destination: '上海虹桥', departureTime: '08:15', passenger: '李', identity: '100000000000000001', carriage: '03', price: '553.5', ticketNumber: 'A001234', issuer: '广州' })) {
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
    assert.equal(record.ticketCode.rawBytes, originalCode.rawBytes);
    assert.equal(record.fieldSources.issuer, 'barcode');
    assert.ok(record.lockedFields.includes('seat'));
    assert.equal(record.fieldSources.identity, 'barcode');

    document.querySelector('[data-action="navigate"][data-page="archive"]').click();
    await waitFor(() => document.querySelector('[data-action="view"]'));
    document.querySelector('[data-action="view"]').click();
    await waitFor(() => document.querySelector('[data-action="edit"]:not(:disabled)'));
    document.querySelector('[data-action="edit"]').click();
    await waitFor(form);
    assert.equal(field('service').readOnly, true);
    assert.equal(photoEntry().querySelector('[data-rail-photo-controls]').disabled, true);
    assert.equal(railQueries.length, 1);
    assert.equal(form().querySelector('#code-remove'), null);
    assert.equal(receipt().disabled, true);
    const barcode = await writeBarcode(atob(DEMO_RAIL_LINEAR_CODE.rawBytes), { format: 'Code128', addQuietZones: true });
    pixels = symbolImage(barcode.symbol);
    imageBlob = new Blob([await barcode.image.arrayBuffer()], { type: 'image/png' });
    form().querySelector('[data-code-start]').click();
    await waitFor(() => form()?.querySelector('#code-error')?.textContent === '已收录的二维码只能用二维码替换');
    fill('service', 'G105');
    fill('gate', 'B1');
    assert.equal(field('service').value, 'G103');
    submit();
    await waitFor(() => !form() && server.records()[0].gate === 'B1');
    assert.deepEqual(server.records()[0].ticketCode, record.ticketCode);
    assert.equal(server.records()[0].lockedFields.includes('seat'), true);

    document.querySelector('[data-action="new"]').click();
    await waitFor(form);
    form().querySelector('[data-code-start]').click();
    await waitFor(() => form()?.querySelector('#code-status')?.textContent.includes('已收录一维条码'));
    assert.equal(field('template').value, 'rail-red-barcode');
    assert.deepEqual(fieldStars('saleCode'), []);
    assert.equal(field('service').value, '');
    assert.equal(field('service').readOnly, false);
    assert.equal(photoEntry().querySelector('[data-rail-photo-controls]').disabled, false);
    assert.equal(receipt().disabled, false);
    assert.ok(form().querySelector('#editor-preview [data-ticket-code][aria-label^="Code128"]'));
    form().querySelector('#code-remove').click();
    assert.ok(form().querySelector('.rail-linear-example:not([hidden])'));
    const barcodeFile = form().querySelector('#code-photo');
    Object.defineProperty(barcodeFile, 'files', { value: [imageBlob] });
    barcodeFile.dispatchEvent(new window.Event('change', { bubbles: true }));
    await waitFor(() => form()?.querySelector('#code-status')?.textContent.includes('已收录一维条码'));
    for (const [name, value] of Object.entries({ service:'T41', origin:'北京西', destination:'西安',
      departureDate:'2008-09-12', departureTime:'16:46', carriage:'09', seat:'023号下铺', seatClass:'硬卧' })) fill(name, value);
    submit();
    await waitFor(() => !form() && server.records().length === 2);
    const linear = server.records().find(item => item.template === 'rail-red-barcode');
    assert.equal(linear.ticketCode.rawBytes, DEMO_RAIL_LINEAR_CODE.rawBytes);
    assert.equal(linear.fieldSources.ticketCode, 'barcode');
    assert.equal(linear.fieldSources.service, 'manual');
    assert.equal(railQueries.length, 1);
  } finally {
    window.dispatchEvent(new window.Event('offline'));
    dom.window.close();
  }
});
