import {calendarDate} from '../src/journey-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { videoCrop, frameMetrics, frameMotion, frameQuality, scanCandidate, createScanConsensus, parseScanText } from '../src/scan-engine.js';
import { scannerMarkup, mountScanner } from '../src/scanner.js';
import { readPrintedDate, dateRectangle } from '../src/scan-date.js';
import {createBoardingCode} from '../src/bcbp.js';
import {barcodeFieldLocked} from '../src/barcode-fields.js';

const notice = '日期：2026-11-15 车次：G103\n出发：北京南 到达：上海虹桥\n时间：08:00 二等座';
const wait = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(options = {}) {
  const dom = new JSDOM(scannerMarkup(options.type), { url: 'https://example.com/' }), root = dom.window.document.querySelector('#live-scanner');
  let stopped = 0, terminated = 0, reads = 0, captured = [], clock = 2000;
  const tasks = [], track = { stop() { stopped++; }, addEventListener() {} }, stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  dom.window.HTMLMediaElement.prototype.play = async () => {};
  dom.window.HTMLMediaElement.prototype.pause = () => {};
  const frame = { metrics: { mean: 160, contrast: 50, sharpness: 15, fingerprint: Array(384).fill(160) }, snapshot: () => ({ toBlob: callback => callback(new Blob(['frame'], { type: 'image/png' })) }) };
  const dispose = mountScanner(root, {
    mediaDevices: { getUserMedia: async constraints => { assert.equal(constraints.audio, false); assert.equal(constraints.video.facingMode.ideal, 'environment'); return stream; } },
    loadRecognizer: async () => ({ recognize: async () => { reads++; return { text: notice, confidence: 90 }; }, terminate: async () => { terminated++; } }),
    schedule: fn => { tasks.push(fn); return fn; }, unschedule: fn => { const i = tasks.indexOf(fn); if (i >= 0) tasks.splice(i, 1); },
    readFrame: () => frame, now: () => clock, prepareImage: image => image,
    onResult: (record, blob) => captured.push({ record, blob }), ...options
  });
  return { dom, root, dispose, frame, get stopped() { return stopped; }, get terminated() { return terminated; }, get reads() { return reads; }, get captured() { return captured; }, async ticks(n) { for (let i = 0; i < n; i++) { await wait(); clock += 350; tasks.shift()?.(); await wait(); } } };
}

test('camera crop maps the visible guide through cover scaling for portrait and landscape screens', () => {
  const crop = videoCrop(1920, 1080, { left: 0, top: 0, width: 360, height: 640 }, { left: 20, top: 200, width: 320, height: 200 });
  assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.width <= 1920 && crop.y + crop.height <= 1080);
  assert.ok(Math.abs(crop.width / crop.height - 1.6) < .001);
  assert.equal(videoCrop(0, 0, { width: 0, height: 0 }, { width: 1, height: 1 }), null);
});

test('blank, dark and overexposed frames do not trigger capture and motion must settle', () => {
  const image = value => ({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(value) });
  for (const value of [0, 160, 255]) assert.ok(frameQuality(frameMetrics(image(value))));
  const textured = image(200); for (let i = 0; i < 64 * 64; i++) if ((i % 8) < 3) textured.data.fill(20, i * 4, i * 4 + 3);
  const metrics = frameMetrics(textured); assert.equal(frameQuality(metrics), '');
  assert.equal(frameMotion(metrics.fingerprint, metrics.fingerprint), 0);
  assert.equal(frameMotion(null, metrics.fingerprint), Infinity);
});

test('automatic acceptance requires meaningful ticket fields and matching reads', () => {
  const record = scanCandidate(notice, 90, 'rail'); assert.equal(record.service, 'G103');
  assert.equal(scanCandidate(notice, 10, 'rail'), null); assert.equal(scanCandidate('G103', 95, 'rail'), null);
  assert.equal(scanCandidate(notice, 90, 'flight'), null);
  const agreement = createScanConsensus();
  assert.equal(agreement.observe(record, 90), null); assert.equal(agreement.observe({ ...record, id: 'another-frame' }, 85).service, 'G103');
  agreement.reset(); agreement.observe(record, 90);
  assert.equal(agreement.observe({ ...record, service: 'G104' }, 90), null);
  assert.equal(agreement.observe(null, 90), null);
});

test('printed rail dates and unambiguous station pinyin are recovered without interpreting unrelated numbers as dates', () => {
  const text = 'X000003\n杭州东站 G7602 南京南站\nHangzhoudong Nanjingnan\n20184104018 19:28% 03#12A#\n二等座\n1101011990xxxx1234 示例旅客\n限乘当日当次车';
  const r = scanCandidate('日期：2018-10-01\n' + text, 74, 'rail');
  assert.equal(calendarDate(r.departureDate), '2018-10-01'); assert.equal(r.origin, '杭州东'); assert.equal(r.destination, '南京南');
  assert.equal(r.carriage, '03'); assert.equal(r.seat, '12A'); assert.equal(r.passenger, '示例旅客');
  assert.equal(parseScanText('G103 二等座\n票号 20184104018')[0].departureDate, '');
  assert.equal(parseScanText('G103 二等座\n20184134018 19:28')[0].departureDate, '');
  assert.equal(parseScanText(text.replace('20184104018', '201841040148'))[0].departureDate, '');
  assert.equal(parseScanText('G103 二等座\n20184104018\n19:28')[0].departureDate, '');
  assert.equal(readPrintedDate('2018年10月018'), '2018-10-01');
  assert.equal(readPrintedDate('2018年10月158'), '2018-10-15');
  assert.equal(readPrintedDate('2018410015'), '', 'numeric noise alone cannot establish the date');
  assert.equal(readPrintedDate('2018年13月018'), '');
  assert.equal(dateRectangle(''), null);
  assert.equal(scanCandidate('日期：2018-10-01\n' + text + '\n\nT95306', 74, 'rail').service, 'G7602', 'footer OCR noise cannot split a single camera frame into unrelated text tickets');
});

test('stable camera frames are recognized automatically, then camera and worker are released', async () => {
  const h = harness(); await h.ticks(12);
  assert.equal(h.captured.length, 1); assert.equal(h.captured[0].record.service, 'G103');
  assert.equal(h.captured[0].blob.type, 'image/png'); assert.equal(h.reads, 2);
  assert.equal(h.stopped, 1); assert.equal(h.terminated, 1);
  assert.doesNotMatch(h.root.innerHTML, /type="file"|capture="|拍照|快门/);
  h.dispose(); h.dom.window.close();
});

test('flight camera scanning waits for the combined OCR and barcode result and returns locked decoded fields',async()=>{
  let reads=0,finish;
  const boardingCode=createBoardingCode({passenger:'EXAMPLE/TRAVELER',pnr:'ABC123',origin:'JFK',destination:'LHR',carrier:'BA',flightNumber:'321',date:'2026-05-18',cabin:'Y',seat:'12A',sequence:'42',status:'1',electronic:''});
  const h=harness({type:'auto',loadRecognizer:async()=>({recognize:async(_image,options)=>{reads++;assert.equal(options.type,'auto');assert.equal(options.refineRailDate,true);return new Promise(resolve=>{finish=resolve;});},terminate:async()=>{}})});
  try{
    assert.equal(h.root.querySelector('[aria-pressed="true"]').textContent, '自动');
    h.frame.metrics.mean=248;
    await h.ticks(5);assert.equal(reads,1);assert.equal(h.captured.length,0);
    h.frame.metrics.fingerprint=Array(384).fill(90);
    await h.ticks(1);
    finish({text:'BOARDING PASS\nFLIGHT: BA999\nDATE: 18MAY2026\nSEAT: 46K\nBOARDING TIME: 09:55',confidence:90,boardingCodes:[boardingCode]});
    await wait();assert.equal(h.captured.length,1);
    const record=h.captured[0].record;assert.equal(record.service,'BA321');assert.equal(record.seat,'12A');assert.equal(record.boardingTime,'09:55');assert.equal(record.boardingCodeSource,'original');assert.equal(barcodeFieldLocked(record,'seat'),true);assert.equal(barcodeFieldLocked(record,'boardingTime'),false);
  }finally{h.dispose();h.dom.window.close();}
});

test('a boarding pass keeps repeated coupon fields together and distinguishes boarding from departure time', () => {
  const text = '中国东方航空 登机牌 BOARDING PASS\n姓名 NAME 航班 FLIGHT 日期 DATE\n示例旅客 MU5403 2025.05.03\nSHA TFU\n航程 ROUTE\nSHA - TFU\nGATE BOARDING DEPARTURE SEAT\nD21 09:55 10:35 32A';
  const record = scanCandidate(text, 90, 'flight');
  assert.equal(record.service, 'MU5403'); assert.equal(calendarDate(record.departureDate), '2025-05-03');
  assert.equal(record.originCode, 'SHA'); assert.equal(record.destinationCode, 'TFU');
  assert.equal(record.boardingTime, '09:55'); assert.equal(record.departureTime, '10:35');
  assert.equal(record.passenger, '示例旅客');
  assert.equal(scanCandidate(text.replace('09:55', '69:55'), 90, 'flight').boardingTime, '');
});

test('motion invalidates an in-flight recognition and closing stops a late-arriving camera', async () => {
  let finishRead;
  const h = harness({ loadRecognizer: async () => ({ recognize: () => new Promise(resolve => { finishRead = resolve; }), terminate: async () => {} }) });
  await h.ticks(5); assert.ok(finishRead);
  h.frame.metrics = { ...h.frame.metrics, fingerprint: Array(384).fill(30) }; await h.ticks(1);
  finishRead({ text: notice, confidence: 95 }); await wait(); assert.equal(h.captured.length, 0);
  h.dispose(); h.dom.window.close();
  let grant, stops = 0;
  const late = harness({ mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } });
  late.dispose(); grant({ getTracks: () => [{ stop() { stops++; } }] }); await wait();
  assert.equal(stops, 1); assert.equal(late.captured.length, 0); late.dom.window.close();
});

test('backgrounding releases the camera, and a denied camera can be retried', async () => {
  const h = harness();
  await h.ticks(1);
  const doc = h.dom.window.document, retry = h.root.querySelector('#scanner-retry');
  Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
  doc.dispatchEvent(new h.dom.window.Event('visibilitychange'));
  assert.equal(h.stopped, 1);
  assert.equal(retry.hidden, false);
  Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
  doc.dispatchEvent(new h.dom.window.Event('visibilitychange'));
  assert.equal(retry.hidden, false);
  retry.click();
  await h.ticks(1);
  assert.equal(retry.hidden, true);
  h.dispose();
  h.dom.window.close();

  let attempts = 0;
  const track = { stop() {} };
  const denied = harness({ mediaDevices: { async getUserMedia() {
    if (++attempts === 1) throw Object.assign(new Error(), { name: 'NotAllowedError' });
    return { getTracks: () => [track], getVideoTracks: () => [track] };
  } } });
  await wait();
  const retryDenied = denied.root.querySelector('#scanner-retry');
  assert.match(denied.root.querySelector('#scanner-status').textContent, /允许相机/);
  assert.equal(retryDenied.hidden, false);
  retryDenied.click();
  await denied.ticks(1);
  assert.equal(attempts, 2);
  assert.equal(retryDenied.hidden, true);
  denied.dispose();
  denied.dom.window.close();
});
