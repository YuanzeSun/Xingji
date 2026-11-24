import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ticketCodeEditor, bindTicketCodeEditor } from '../src/code-editor.js';
import { DEMO_RAIL_TICKET_CODE } from '../src/demo-code.js';
import { createRecord } from '../src/model.js';
import { createBoardingCode } from '../src/bcbp.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(values) {
  const draft = createRecord(values), dom = new JSDOM(`<form>${ticketCodeEditor(draft)}</form>`), form = dom.window.document.querySelector('form');
  const video = form.querySelector('video'), queue = new Map(); let next = 0, stopped = 0, reads = 0;
  video.play = async () => {}; video.pause = () => {};
  Object.defineProperties(video, { readyState: { value: 2 }, videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  dom.window.HTMLCanvasElement.prototype.toBlob = function (callback) { assert.equal(this.width, 1600); callback(new Blob(['captured frame'], { type: 'image/png' })); };
  const stream = { getTracks: () => [{ stop: () => stopped++ }] };
  const options = { cameraOptions: { mediaDevices: { getUserMedia: async options => { assert.equal(options.audio, false); assert.equal(options.video.facingMode.ideal, 'environment'); return stream; } }, schedule: fn => { queue.set(++next, fn); return next; }, unschedule: id => queue.delete(id) }, loadRebuilder: async () => async file => { reads++; assert.ok(file instanceof Blob); return { codes: [{ format: 'QRCode', data: DEMO_RAIL_TICKET_CODE }], issues: [] }; } };
  return { dom, form, draft, stream, queue, options, stopped: () => stopped, reads: () => reads };
}

test('camera opens only on request, captures and rebuilds code data, then releases its stream', async () => {
  const f = fixture(); let changed = 0;
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => changed++, f.options);
  assert.equal(f.queue.size, 0); assert.equal(f.reads(), 0);
  assert.match(f.form.textContent, /二维码/); assert.doesNotMatch(f.form.textContent, /原票二维码|选填/);
  f.form.querySelector('[data-code-start]').click(); await settle();
  assert.equal(f.form.querySelector('[data-code-camera]').hidden, false);
  const [id, frame] = f.queue.entries().next().value; f.queue.delete(id); await frame(); await settle();
  assert.equal(f.reads(), 1); assert.equal(changed, 1);
  assert.deepEqual(f.draft.ticketCode, DEMO_RAIL_TICKET_CODE);
  assert.equal(f.stopped(), 1); assert.equal(f.form.querySelector('[data-code-camera]').hidden, true);
  assert.equal(f.queue.size, 0); dispose(); f.dom.window.close();
});

test('the boarding-code camera retries promptly and the shutter uses the full image search', async () => {
  const f = fixture({ type: 'flight', template: 'air-boarding-pass' });
  const code = createBoardingCode({ passenger: 'EXAMPLE/TRAVELER', pnr: 'ABC123', origin: 'JFK', destination: 'LHR',
    carrier: 'BA', flightNumber: '321', date: '2026-05-18', cabin: 'Y', seat: '12A', sequence: '42', status: '1' });
  const modes = [], delays = [];
  const schedule = f.options.cameraOptions.schedule;
  f.options.cameraOptions.schedule = (fn, delay) => { delays.push(delay); return schedule(fn); };
  f.options.loadRebuilder = async () => async (image, type, { cameraFrame }) => {
    assert.equal(image.width, 1920);
    assert.equal(type, 'flight');
    modes.push(cameraFrame);
    return { codes: cameraFrame ? [] : [{ format: 'PDF417', data: code }], issues: [] };
  };
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => {}, f.options);
  try {
    f.form.querySelector('[data-code-start]').click(); await settle();
    const [id, fn] = f.queue.entries().next().value;
    f.queue.delete(id); await fn();
    assert.deepEqual(delays, [80, 200]);
    assert.deepEqual(modes, [1]);
    f.form.querySelector('[data-code-shutter]').click(); await settle();
    assert.deepEqual(modes, [1, 0]);
    assert.deepEqual(f.draft.boardingCode, code);
    assert.equal(f.stopped(), 1);
    assert.equal(f.queue.size, 0);
  } finally { dispose(); f.dom.window.close(); }
});

test('closing before permission resolves stops a late stream and does not modify the ticket', async () => {
  const f = fixture(); let grant;
  f.options.cameraOptions.mediaDevices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => assert.fail('late camera must not change a draft'), f.options);
  f.form.querySelector('[data-code-start]').click(); dispose(); grant(f.stream); await settle();
  assert.equal(f.stopped(), 1); assert.equal(f.reads(), 0); assert.equal(f.draft.ticketCode, ''); f.dom.window.close();
});

test('denied camera access keeps image upload available, and manual stop releases camera resources', async () => {
  const f = fixture();
  const getCamera = f.options.cameraOptions.mediaDevices.getUserMedia;
  f.options.cameraOptions.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); };
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => {}, f.options);
  f.form.querySelector('[data-code-start]').click(); await settle();
  assert.match(f.form.querySelector('[data-code-camera-status]').textContent, /未获相机权限/);
  assert.equal(f.form.querySelector('#code-photo').disabled, false);
  assert.equal(f.form.querySelector('[data-code-start]').disabled, false);
  f.options.cameraOptions.mediaDevices.getUserMedia = getCamera;
  f.form.querySelector('[data-code-start]').click(); await settle();
  f.form.querySelector('[data-code-stop]').click();
  assert.equal(f.stopped(), 1); assert.equal(f.queue.size, 0); assert.equal(f.draft.ticketCode, '');
  dispose(); f.dom.window.close();
});
