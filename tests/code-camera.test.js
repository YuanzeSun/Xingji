import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ticketCodeEditor, bindTicketCodeEditor } from '../src/code-editor.js';
import { DEMO_RAIL_TICKET_CODE } from '../src/demo-code.js';
import { createRecord } from '../src/model.js';
import { createBoardingCode } from '../src/bcbp.js';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function adjustZoom(f, value) {
  const slider = f.form.querySelector('[data-code-zoom-slider]');
  slider.value = value;
  slider.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
}
function fixture(values) {
  const draft = createRecord(values), dom = new JSDOM(`<form>${ticketCodeEditor(draft)}</form>`), form = dom.window.document.querySelector('form');
  const video = form.querySelector('video'), queue = new Map(); let next = 0, stopped = 0, reads = 0;
  video.play = async () => {}; video.pause = () => {};
  Object.defineProperties(video, { readyState: { value: 2 }, videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  dom.window.HTMLCanvasElement.prototype.toBlob = function (callback) { assert.equal(this.width, 1600); callback(new Blob(['captured frame'], { type: 'image/png' })); };
  const track = { stop: () => stopped++ }, stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const options = { cameraOptions: { mediaDevices: { getUserMedia: async options => { assert.equal(options.audio, false); assert.equal(options.video.facingMode.ideal, 'environment'); return stream; } }, schedule: fn => { queue.set(++next, fn); return next; }, unschedule: id => queue.delete(id) }, loadRebuilder: async () => async file => { reads++; assert.ok(file instanceof Blob); return { codes: [{ format: 'QRCode', data: DEMO_RAIL_TICKET_CODE }], issues: [] }; } };
  return { dom, form, draft, stream, queue, track, options, stopped: () => stopped, reads: () => reads };
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

test('native zoom and selectable focus use the active track and keep its capture constraints', async t => {
  const f = fixture(), applied = [];
  let nativeZoom = 1;
  const { mediaDevices } = f.options.cameraOptions;
  const open = mediaDevices.getUserMedia;
  mediaDevices.getSupportedConstraints = () => ({ zoom: true, pointsOfInterest: true });
  mediaDevices.getUserMedia = request => { assert.equal(request.video.zoom, true); return open(request); };
  Object.assign(f.track, {
    getCapabilities: () => ({ zoom: { min: .5, max: 3, step: .25 }, focusMode: ['continuous'] }),
    getSettings: () => ({ zoom: nativeZoom }), getConstraints: () => ({ width: { ideal: 1920 } }),
    applyConstraints: async request => {
      if (request.zoom?.exact === 2) throw new Error('Native Zoom failed');
      nativeZoom = request.zoom?.exact ?? nativeZoom;
      applied.push(request);
    }
  });
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => {}, f.options);
  t.after(() => { dispose(); f.dom.window.close(); });
  f.form.querySelector('[data-code-start]').click(); await settle();
  assert.deepEqual(applied[0].advanced, [{ focusMode: 'continuous' }]);
  assert.match(f.form.querySelector('[data-code-camera-status]').textContent, /点按画面可对焦/);
  adjustZoom(f, 1.25); await settle();
  assert.deepEqual(applied.at(-1).zoom, { exact: 1.25 });
  assert.equal(f.form.querySelector('[data-code-zoom-value]').textContent, '1.25×');
  const view = f.form.querySelector('[data-code-view]');
  view.getBoundingClientRect = () => ({ left: 20, top: 10, width: 200, height: 100 });
  const tap = () => view.dispatchEvent(new f.dom.window.MouseEvent('click', { clientX: 70, clientY: 85 }));
  tap();
  await settle();
  assert.deepEqual(applied.at(-1), { width: { ideal: 1920 }, zoom: { exact: 1.25 },
    advanced: [{ focusMode: 'continuous', pointsOfInterest: [{ x: .25, y: .75 }] }] });
  assert.equal(f.form.querySelector('[data-code-focus-mark]').hidden, false);
  adjustZoom(f, 2); await settle();
  assert.equal(view.style.getPropertyValue('--camera-crop'), '1.6');
  tap(); await settle();
  assert.deepEqual(applied.at(-1).advanced[0].pointsOfInterest, [{ x: .34375, y: .65625 }]);
});

test('camera access without zoom permission supports pinch, a slider and a matching frame crop', async t => {
  const f = fixture(), requests = [];
  const { mediaDevices } = f.options.cameraOptions, open = mediaDevices.getUserMedia;
  mediaDevices.getSupportedConstraints = () => ({ zoom: true });
  mediaDevices.getUserMedia = async request => {
    requests.push(request.video.zoom);
    if (request.video.zoom) throw Object.assign(new Error(), { name: 'NotAllowedError' });
    return open(request);
  };
  let crop;
  f.dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: (_video, ...args) => { crop = args; } });
  f.dom.window.HTMLCanvasElement.prototype.toBlob = callback => callback(new Blob(['cropped frame']));
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => {}, f.options);
  t.after(() => { dispose(); f.dom.window.close(); });
  f.form.querySelector('[data-code-start]').click(); await settle();
  assert.deepEqual(requests, [true, undefined]);
  assert.equal(f.form.querySelector('[data-code-focus]').hidden, true);
  assert.equal(f.form.querySelector('[data-code-zoom-slider]').min, '1');
  adjustZoom(f, 1.25);
  const view = f.form.querySelector('[data-code-view]');
  const pointer = (type, pointerId, clientX) => view.dispatchEvent(Object.assign(new f.dom.window.Event(type), { pointerId, clientX, clientY: 20, pointerType: 'touch' }));
  pointer('pointerdown', 1, 20); pointer('pointerdown', 2, 120); pointer('pointermove', 2, 180);
  pointer('pointerup', 1, 20); pointer('pointerup', 2, 180);
  assert.equal(view.style.getPropertyValue('--camera-crop'), '2');
  f.form.querySelector('[data-code-shutter]').click(); await settle();
  assert.deepEqual(crop, [480, 270, 960, 540, 0, 0, 960, 540]);
  assert.deepEqual(f.draft.ticketCode, DEMO_RAIL_TICKET_CODE);
});

test('selecting another rear lens excludes the front camera, discards the old decode and recovers from failure', async t => {
  const f = fixture(), opened = [], stopped = [];
  const { mediaDevices } = f.options.cameraOptions;
  mediaDevices.enumerateDevices = async () => [
    { kind: 'videoinput', deviceId: 'rear', label: 'Rear Camera' },
    { kind: 'videoinput', deviceId: 'front', label: 'Front Camera' },
    { kind: 'videoinput', deviceId: 'tele', label: 'Camera 3', getCapabilities: () => ({ facingMode: ['environment'] }) },
    { kind: 'videoinput', deviceId: 'missing', label: '后置超广角' }
  ];
  mediaDevices.getUserMedia = async ({ video }) => {
    const id = video.deviceId?.exact || 'rear';
    opened.push(id);
    if (id === 'missing') throw Object.assign(new Error(), { name: 'NotFoundError' });
    const track = { getSettings: () => ({ deviceId: id, facingMode: 'environment' }), stop: () => stopped.push(id) };
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  };
  let finishOld;
  f.options.loadRebuilder = async () => () => new Promise(resolve => { finishOld = resolve; });
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => assert.fail('old lens must not change the draft'), f.options);
  t.after(() => { dispose(); f.dom.window.close(); });
  f.form.querySelector('[data-code-start]').click(); await settle();
  const device = f.form.querySelector('[data-code-device]');
  assert.equal(device.value, 'rear');
  assert.deepEqual([...device.options].map(option => option.value), ['rear', 'tele', 'missing']);
  f.form.querySelector('[data-code-shutter]').click(); await settle();
  const switchTo = async id => { device.value = id; device.dispatchEvent(new f.dom.window.Event('change', { bubbles: true })); await settle(); };
  await switchTo('tele');
  finishOld({ codes: [{ format: 'QRCode', data: DEMO_RAIL_TICKET_CODE }], issues: [] }); await settle();
  assert.equal(f.draft.ticketCode, '');
  assert.equal(device.value, 'tele');
  assert.deepEqual(stopped, ['rear']);
  await switchTo('missing');
  assert.deepEqual(opened, ['rear', 'tele', 'missing', 'tele']);
  assert.deepEqual(stopped, ['rear', 'tele']);
  assert.equal(device.value, 'tele');
  assert.match(f.form.querySelector('[data-code-camera-status]').textContent, /恢复上一镜头/);
});
