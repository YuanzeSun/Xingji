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
function pinchZoom(f) {
  const view = f.form.querySelector('[data-code-view]');
  const pointer = (type, pointerId, clientX) => view.dispatchEvent(Object.assign(new f.dom.window.Event(type), { pointerId, clientX, clientY: 20, pointerType: 'touch' }));
  pointer('pointerdown', 1, 20); pointer('pointerdown', 2, 120); pointer('pointermove', 2, 180);
  pointer('pointerup', 1, 20); pointer('pointerup', 2, 180);
}
function fixture(values) {
  const draft = createRecord(values), dom = new JSDOM(`<form>${ticketCodeEditor(draft)}</form>`), form = dom.window.document.querySelector('form');
  const video = form.querySelector('video'), queue = new Map(), delays = []; let next = 0, stopped = 0, reads = 0;
  video.play = async () => {}; video.pause = () => {};
  Object.defineProperties(video, { readyState: { value: 2 }, videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
  dom.window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  dom.window.HTMLCanvasElement.prototype.toBlob = () => assert.fail('the live scanner should read the uncompressed frame directly');
  const track = { stop: () => stopped++ }, stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const options = { cameraOptions: { mediaDevices: { getUserMedia: async options => { assert.equal(options.audio, false); assert.equal(options.video.facingMode.ideal, 'environment'); return stream; } }, schedule: (fn, delay) => { delays.push(delay); queue.set(++next, fn); return next; }, unschedule: id => queue.delete(id) }, loadRebuilder: async () => async image => { reads++; assert.ok(image instanceof dom.window.HTMLCanvasElement); return { codes: [{ format: 'QRCode', data: DEMO_RAIL_TICKET_CODE }], issues: [] }; } };
  return { dom, form, draft, stream, queue, delays, track, options, stopped: () => stopped, reads: () => reads };
}

test('camera opens only on request, captures and rebuilds code data, then releases its stream', async () => {
  const f = fixture(); let changed = 0;
  const load = f.options.loadRebuilder;
  f.options.loadRebuilder = async () => {
    const rebuild = await load();
    return (image, _type, { cameraFrame }) => {
      assert.equal(image.width, 1920);
      return cameraFrame === 1 ? { codes: [], issues: [] } : rebuild(image);
    };
  };
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => changed++, f.options);
  assert.equal(f.queue.size, 0); assert.equal(f.reads(), 0);
  assert.equal(f.form.querySelector('[data-code-start]').textContent, '相机扫描');
  assert.doesNotMatch(f.form.textContent, /虚构车票二维码|将完整的码对准相机/);
  f.form.querySelector('[data-code-start]').click(); await settle();
  assert.equal(f.form.querySelector('[data-code-camera]').hidden, false);
  for (let i = 0; i < 2; i++) {
    const [id, frame] = f.queue.entries().next().value;
    f.queue.delete(id);
    await frame();
  }
  assert.deepEqual(f.delays, [80, 200]);
  assert.equal(f.reads(), 1); assert.equal(changed, 1);
  assert.deepEqual(f.draft.ticketCode, DEMO_RAIL_TICKET_CODE);
  assert.equal(f.stopped(), 1); assert.equal(f.form.querySelector('[data-code-camera]').hidden, true);
  assert.equal(f.queue.size, 0); dispose(); f.dom.window.close();
});

test('the boarding-code camera retries promptly and the shutter uses the full image search', async () => {
  const f = fixture({ type: 'flight', template: 'air-boarding-pass' });
  const code = createBoardingCode({ passenger: 'EXAMPLE/TRAVELER', pnr: 'ABC123', origin: 'JFK', destination: 'LHR',
    carrier: 'BA', flightNumber: '321', date: '2026-05-18', cabin: 'Y', seat: '12A', sequence: '42', status: '1' });
  const modes = [];
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
    assert.deepEqual(f.delays, [80, 200]);
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

test('one browser-selected rear stream supports zoom and focus without a lens picker', async t => {
  const f = fixture(), applied = [];
  let nativeZoom = 1, opens = 0, listings = 0;
  const { mediaDevices } = f.options.cameraOptions;
  const open = mediaDevices.getUserMedia;
  mediaDevices.getSupportedConstraints = () => ({ zoom: true, pointsOfInterest: true });
  mediaDevices.enumerateDevices = async () => { listings++; return []; };
  mediaDevices.getUserMedia = request => {
    opens++;
    assert.equal(request.video.zoom, true);
    assert.equal(request.video.deviceId, undefined);
    return open(request);
  };
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
  assert.equal(f.form.querySelector('[data-code-camera] select'), null);
  assert.deepEqual(applied[0].advanced, [{ focusMode: 'continuous' }]);
  assert.equal(f.form.querySelector('[data-code-camera-status]').textContent, '');
  assert.equal(f.form.querySelector('[data-code-focus]').hidden, false);
  adjustZoom(f, 1.25); await settle();
  assert.deepEqual(applied.at(-1).zoom, { exact: 1.25 });
  assert.equal(f.form.querySelector('[data-code-zoom-value]').textContent, '1.25×');
  const view = f.form.querySelector('[data-code-view]');
  view.getBoundingClientRect = () => ({ left: 20, top: 10, width: 200, height: 100 });
  const tap = () => {
    view.dispatchEvent(Object.assign(new f.dom.window.Event('pointerdown'), { pointerType: 'mouse' }));
    view.dispatchEvent(new f.dom.window.MouseEvent('click', { clientX: 70, clientY: 85 }));
  };
  tap();
  await settle();
  assert.deepEqual(applied.at(-1), { width: { ideal: 1920 }, zoom: { exact: 1.25 },
    advanced: [{ focusMode: 'continuous', pointsOfInterest: [{ x: .25, y: .75 }] }] });
  assert.equal(f.form.querySelector('[data-code-focus-mark]').hidden, false);
  pinchZoom(f); await settle();
  assert.equal(view.style.getPropertyValue('--camera-crop'), '1.6');
  tap(); await settle();
  assert.deepEqual(applied.at(-1).advanced[0].pointsOfInterest, [{ x: .34375, y: .65625 }]);
  assert.equal(opens, 1);
  assert.equal(listings, 0);
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
  const dispose = bindTicketCodeEditor(f.form, f.draft, () => {}, f.options);
  t.after(() => { dispose(); f.dom.window.close(); });
  f.form.querySelector('[data-code-start]').click(); await settle();
  assert.deepEqual(requests, [true, undefined]);
  assert.equal(f.form.querySelector('[data-code-focus]').hidden, true);
  assert.equal(f.form.querySelector('[data-code-zoom-slider]').min, '1');
  adjustZoom(f, 1.25);
  const view = f.form.querySelector('[data-code-view]');
  pinchZoom(f);
  assert.equal(view.style.getPropertyValue('--camera-crop'), '2');
  f.form.querySelector('[data-code-shutter]').click(); await settle();
  assert.deepEqual(crop, [480, 270, 960, 540, 0, 0, 960, 540]);
  assert.deepEqual(f.draft.ticketCode, DEMO_RAIL_TICKET_CODE);
});
