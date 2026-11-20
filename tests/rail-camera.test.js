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

test('rail photo layout uses the same sloped row and ignores a nearby sales station', () => {
  const item = (text, x, y, width, score = .96) => ({
    text, score, poly: [[x, y], [x + width, y - width * .25], [x + width + 6, y + 22 - width * .25], [x + 6, y + 22]]
  });
  const reading = paddleRailReading({
    image: { width: 520, height: 335 },
    items: [
      item('Z123P000001', 25, 51, 110), item('宁波东', 363, 36, 59),
      item('羊草', 100, 120, 65), item('6214', 224, 87, 55),
      item('宋', 360, 57, 25, .54), item('2013年10月23日04:26开', 56, 172, 178),
      item('网折', 253, 181, 38), item('限乘当日当次车', 63, 220, 148)
    ]
  }, 'blue');
  const [record] = recognizedRailRecords(reading);
  assert.deepEqual([record.service, record.origin, record.destination], ['6214', '羊草', '宋']);
  assert.equal(record.ticketNumber, 'Z123P000001');
  assert.deepEqual(record.ticketMarks.map(mark => [mark.text, mark.shape]), [['网', 'plain'], ['折', 'plain']]);
});

test('exact station pinyin corrects an unknown spelling in the same photographed column', () => {
  const item = (text, x, y, width, height) => ({
    text, score: .96, poly: [[x, y], [x + width, y], [x + width, y + height], [x, y + height]]
  });
  const reading = paddleRailReading({
    image: { width: 520, height: 335 },
    items: [
      item('成郁南站', 24, 67, 120, 27), item('Chengdunan', 32, 94, 111, 20),
      item('C3366', 220, 65, 78, 28), item('邛崃站', 380, 69, 103, 28),
      item('2023年12月15日17:32开', 26, 119, 224, 22), item('仅供报销使用', 28, 210, 143, 22)
    ]
  }, 'blue');
  assert.equal(recognizedRailRecords(reading)[0].origin, '成都南');
});
