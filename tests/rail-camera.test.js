import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { openRailCamera } from '../src/rail-camera.js';
import { readPrintedDate } from '../src/scan-date.js';
import { railStationFromRegion, printedRailNumber } from '../src/rail-ticket.js';
import { marksFromRailRegion } from '../src/ticket-marks.js';
import { chooseRailReading, fullRailRead, paddleRailReading, recognizedRailRecords } from '../src/paddle-rail.js';

test('the rail camera delivers one photo only after a shutter press', async t => {
  const { window } = new JSDOM('<div id="preview"></div>');
  t.after(() => window.close());
  window.HTMLMediaElement.prototype.play = async () => {};
  Object.defineProperties(window.HTMLVideoElement.prototype, {
    videoWidth: { get: () => 1280 },
    videoHeight: { get: () => 720 }
  });
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  window.HTMLCanvasElement.prototype.toBlob = callback => callback(new Blob(['fixture']));
  let shots = 0, stopped = 0;
  const root = window.document.querySelector('#preview');
  const close = openRailCamera(root, () => shots++, {
    mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) }
  });
  t.after(close);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(shots, 0);
  assert.equal(root.querySelector('[data-shutter]').disabled, false);
  root.querySelector('[data-shutter]').click();
  assert.equal(shots, 1);
  assert.equal(stopped, 1);
  assert.equal(root.childElementCount, 0);
});

test('rail regions distinguish matching stations, numbers and isolated marks', () => {
  assert.equal(railStationFromRegion('北 京 南 站\nBeijingnan'), '北京南');
  assert.equal(railStationFromRegion('Beijingnan\nNanjingnan'), '');
  assert.equal(printedRailNumber('X 000001'), 'X000001');
  assert.equal(printedRailNumber('000000000000000000001 南京南站售', true), '000000000000000000001');
  assert.equal(printedRailNumber('12345678900001 X000001 南京南站售', true), '12345678900001X000001');
  assert.equal(printedRailNumber('13812345678', true), '');
  assert.deepEqual(marksFromRailRegion('网\n孩\n网上购票').map(mark => [mark.text, mark.shape]), [['网','circle'],['孩','plain']]);
  assert.equal(readPrintedDate('2018410015'), '');
  assert.equal(readPrintedDate('2018年10月018'), '2018-10-01');
});

test('Paddle detections keep the route order and recover a standalone stamp', () => {
  const item = (text, x, y, width = 110, score = .92) => ({
    text, score, poly: [[x, y], [x + width, y], [x + width, y + 24], [x, y + 24]]
  });
  const reading = paddleRailReading({
    image: { width: 640, height: 400 },
    items: [
      item('X000001', 24, 15), item('南京南站', 490, 65), item('Ｇ２１', 265, 64),
      item('北京南站', 30, 66), item('Nanjingnan', 480, 100), item('Beijingnan', 30, 101),
      item('2026年11月16日15:00开', 30, 120), item('网', 300, 190, 24), item('残', 340, 190, 24, .49),
      item('仅供报销使用', 30, 280), item('12345678900001 X000001 北京南站售', 30, 380, 420)
    ]
  }, 'blue');
  const records = recognizedRailRecords(reading);
  assert.equal(fullRailRead(records), true);
  assert.equal(records[0].service, 'G21');
  assert.equal(records[0].origin, '北京南');
  assert.equal(records[0].destination, '南京南');
  assert.equal(records[0].saleCode, '12345678900001X000001');
  assert.deepEqual(records[0].ticketMarks.map(mark => mark.text), ['网']);
});

test('rail OCR only supplements a matching ticket and prefers the complete read', () => {
  const primary = { text: 'X000001\n车次：G21\n出发站：北京南\n到达站：南京南\n检票：1口' };
  const fallback = { text: '车次：G21\n出发站：北京南\n到达站：南京南\n2026年11月16日15:00开\n检票：1口' };
  const [record] = recognizedRailRecords(chooseRailReading(primary, fallback));
  assert.equal(record.ticketNumber, 'X000001');
  assert.equal(fullRailRead([record]), true);
  const differentTrain = { ...fallback, text: fallback.text.replace('G21', 'G23') };
  assert.strictEqual(chooseRailReading(primary, differentTrain), differentTrain);
});

test('Paddle recovers numeric train routes from the station row and rejects a collage', () => {
  const item = (text, x, y, width = 55) => ({
    text, score: .97, poly: [[x, y], [x + width, y], [x + width, y + 20], [x, y + 20]]
  });
  const image = { width: 640, height: 400 };
  const items = [item('天津', 36, 44), item('1521', 260, 45), item('哈尔滨', 466, 43),
    item('2011*09月02日15:31开', 37, 120, 210), item('限乘当日当次车', 38, 165)];
  const [ticket] = recognizedRailRecords(paddleRailReading({ image, items }, 'blue'));
  assert.deepEqual([ticket.service, ticket.origin, ticket.destination, ticket.departureDate.year], ['1521', '天津', '哈尔滨', 2011]);

  items.push(item('G23', 250, 275), item('2025年03月02日16:01开', 40, 320, 210));
  const collage = paddleRailReading({ image, items }, 'blue');
  assert.equal(collage.multiplePrintedTickets, true);
  assert.deepEqual(recognizedRailRecords(collage), []);
});
