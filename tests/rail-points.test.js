import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { readTrips } from '../extensions/xingji-12306/read-trips.js';
import { extensionArchive } from '../scripts/package-extension.mjs';
import { RAIL_POINTS_EXTENSION, RAIL_POINTS_PAGE, railPointsRange, railPointsRecords } from '../src/rail-points.js';
import { browser, until } from './helpers/d1-app.js';
import { prepareCloud } from './helpers/cloud.js';

const ride = { date: '20261116', service: 'G21', originCode: 'VNP', destinationCode: 'AOH',
  seatClassCode: 'O', carriage: '05', passenger: '示例甲', orderNumber: 'E000000001' };

test('the 12306 extension includes its worker and is available only to the Xingji page', async () => {
  const manifest = JSON.parse(await readFile(new URL('../extensions/xingji-12306/manifest.json', import.meta.url), 'utf8'));
  const digest = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex').slice(0, 32);
  const id = [...digest].map(digit => String.fromCharCode(97 + parseInt(digit, 16))).join('');
  assert.equal(id, RAIL_POINTS_EXTENSION);
  assert.deepEqual(manifest.permissions, ['scripting']);
  assert.deepEqual(manifest.host_permissions, ['https://cx.12306.cn/*']);
  assert.deepEqual(manifest.externally_connectable.matches, ['https://yuanzesun.github.io/Xingji/*']);
  const recordedFiles = Object.keys(unzipSync(await extensionArchive(process.cwd(), 'xingji-12306')));
  assert.ok(['manifest.json', 'background.js', 'read-trips.js', 'INSTALL.txt'].every(file => recordedFiles.includes('xingji-12306/' + file)));
});

test('12306 reads the existing browser session, paginates, and returns trip fields only', async t => {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(RAIL_POINTS_PAGE) });
  t.after(() => { delete globalThis.location; });
  const requests = [];
  const trades = Array.from({ length: 11 }, (_, index) => ({ trade_id: String(index), trade_type: '0', record_sum: '11' }));
  let signedIn = true;
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    requests.push(path);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'manual');
    if (path.endsWith('/checkLogin')) return Response.json({ data: { flag: signedIn ? '1' : '0', mobile: 'private' } });
    if (path.endsWith('/pointSimpleQuery')) {
      assert.equal(options.body.get('queryStartDate'), '20251124');
      assert.equal(options.body.get('queryEndDate'), '20261124');
      const page = Number(options.body.get('pageIndex'));
      return Response.json({ status: 1, data: trades.slice((page - 1) * 10, page * 10) });
    }
    assert.equal(path, '/tlcx/memberInfo/PointDetailQuery');
    const detail = {
      query_type: 'tr', station_train_code: 'G21', train_date: '20261116', board_station_telecode: 'VNP',
      arrive_station_telecode: 'AOH', seat_type_code: 'O', coach_no: '05',
      v_assignee_id_name: '示例甲', sequence_no: 'E000000001', v_assignee_id_no: '1234****5678'
    };
    const id = options.body.get('trade_id');
    if (id === '0') return Response.json({ status: '1', data: [detail, { ...detail, query_type: 'fc' }] });
    if (id === '10') return Response.json({ status: '1', data: [{ ...detail, query_type: 'tg',
      resign_station_train_code: 'G25', resign_train_date: '20261118', resign_board_station_telecode: 'VNP',
      resign_arrive_station_telecode: 'AOH', resign_seat_type_code: 'M', v_assignee_id_name: '示＊甲' }] });
    return Response.json({ status: 0, errorMsg: '无积分详情' });
  });
  const result = await readTrips('2025-11-24', '2026-11-24');
  assert.deepEqual(requests.slice(0, 3), ['/tlcx/login/checkLogin', '/tlcx/memberInfo/pointSimpleQuery', '/tlcx/memberInfo/pointSimpleQuery']);
  assert.equal(requests.length, 14);
  const records = railPointsRecords([...result.rides, result.rides[0]]);
  assert.deepEqual(records.map(({ record, event }) => [record.service, record.passenger, record.seatClass, event]), [
    ['G25', '', '一等座', '改签'], ['G21', '示例甲', '二等座', '']
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|1234|5678/);
  assert.equal(records[1].record.orderNumber, 'E000000001');
  assert.equal(records[1].record.fieldSources.departureDate, 'rail-points');
  assert.deepEqual(records[1].record.lockedFields, []);
  signedIn = false;
  const failed = await readTrips('2025-11-24', '2026-11-24');
  assert.match(failed.error, /扫码登录/);
  assert.equal(requests.length, 15);
});

test('12306 results stay in review until a single user-selected trip is saved', async t => {
  const window = browser();
  const github = await prepareCloud();
  t.after(() => { window.close(); delete globalThis.chrome; });
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome/142.0' });
  let reply;
  globalThis.chrome = { runtime: { sendMessage(id, request, callback) {
    assert.equal(id, RAIL_POINTS_EXTENSION);
    assert.deepEqual(request, { action: 'readRailPoints', ...railPointsRange() });
    reply = callback;
  } } };
  await import('../src/app.js');
  const action = '[data-action="rail-points"]';
  await until(() => document.querySelector(action)?.disabled === false);
  document.querySelector(action).click();
  await until(() => document.querySelector('#rail-points-form'));
  assert.equal(document.querySelector('#rail-points-form a').href, RAIL_POINTS_PAGE);
  document.querySelector('#rail-points-form [type="submit"]').click();
  await until(() => reply);
  reply({ rides: [ride, { ...ride, service: 'G25' }] });
  await until(() => document.querySelectorAll('[data-action="rail-points-trip"]').length === 2);
  assert.deepEqual(github.records(), []);
  document.querySelector('[data-action="rail-points-trip"]').click();
  await until(() => document.querySelector('#editor-form'));
  const form = document.querySelector('#editor-form');
  assert.equal(form.elements.service.value, 'G21');
  assert.equal(form.elements.origin.value, '北京南');
  assert.equal(form.elements.destination.value, '上海虹桥');
  assert.equal(form.elements.departureTime.required, false);
  assert.equal(form.elements.identity.value, '');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => github.records().length === 1 && !document.querySelector('dialog'));
  const [saved] = github.records();
  assert.equal(saved.departureTime, '');
  assert.equal(saved.seat, '');
  assert.equal(saved.price, '');
  assert.equal(saved.fieldSources.service, 'rail-points');
});
