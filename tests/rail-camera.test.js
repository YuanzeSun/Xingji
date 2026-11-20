import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { openRailCamera } from '../src/rail-camera.js';
import { readPrintedDate } from '../src/scan-date.js';
import { railStationFromRegion, printedRailNumber } from '../src/rail-ticket.js';
import { marksFromRailRegion } from '../src/ticket-marks.js';

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
