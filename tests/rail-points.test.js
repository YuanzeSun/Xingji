import test from 'node:test';
import assert from 'node:assert/strict';
import { readTrips } from '../extensions/xingji-connector/read-trips.js';
import { RAIL_POINTS_PAGE, railPointsRange, railPointsRecords } from '../src/rail-points.js';
import { XINGJI_CONNECTOR_ID } from '../src/browser-connector.js';
import { browser, until } from './helpers/d1-app.js';
import { prepareCloud } from './helpers/cloud.js';

const ride = { date: '20261116', service: 'G21', originCode: 'VNP', destinationCode: 'AOH',
  seatClassCode: 'O', carriage: '05', passenger: '示例甲', orderNumber: 'E000000001' };

test('12306 reads the existing browser session, paginates, and returns trip fields only', async t => {
  Object.defineProperty(globalThis, 'location', { configurable: true, value: new URL(RAIL_POINTS_PAGE) });
  t.after(() => { delete globalThis.location; });
  const requests = [];
  const trades = Array.from({ length: 11 }, (_, index) => ({ trade_id: String(index), trade_type: '0', record_sum: '11' }));
  let signedIn = true, hasTrades = true, listStatus = true;
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    requests.push(path);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.redirect, 'manual');
    if (path.endsWith('/checkLogin')) return Response.json({ data: { flag: signedIn ? '1' : '0', mobile: 'private' } });
    if (path.endsWith('/pointSimpleQuery')) {
      assert.equal(options.body.get('queryStartDate'), '20251124');
      assert.equal(options.body.get('queryEndDate'), '20261124');
      const page = Number(options.body.get('pageIndex'));
      return Response.json({ status: page === 1 ? listStatus : 1, data: hasTrades ? trades.slice((page - 1) * 10, page * 10) : null });
    }
    assert.equal(path, '/tlcx/memberInfo/PointDetailQuery');
    const detail = {
      query_type: 'tr', station_train_code: 'G21', train_date: '20261116', board_station_telecode: 'VNP',
      arrive_station_telecode: 'AOH', seat_type_code: 'O', coach_no: '05',
      v_assignee_id_name: '示例甲', sequence_no: 'E000000001', v_assignee_id_no: '1234****5678'
    };
    const id = options.body.get('trade_id');
    if (id === '0') return Response.json({ status: true, data: [detail, { ...detail, query_type: 'fc' }] });
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
  assert.deepEqual(records[1].record.lockedFields, ['carriage', 'departureDate', 'destination', 'orderNumber', 'origin', 'passenger', 'seatClass', 'service']);
  assert.equal(records[0].record.lockedFields.includes('passenger'), false);
  hasTrades = false;
  assert.deepEqual(await readTrips('2025-11-24', '2026-11-24'), { rides: [] });
  listStatus = false;
  assert.match((await readTrips('2025-11-24', '2026-11-24')).error, /第 1 页积分流水/);
  signedIn = false;
  const failed = await readTrips('2025-11-24', '2026-11-24');
  assert.match(failed.error, /扫码登录/);
  assert.equal(requests.length, 19);
});

test('12306 sends the selected dates and holds results for individual review', async t => {
  const window = browser();
  const identity = '000000200001011234';
  const github = await prepareCloud([], { profile: { chineseName: ride.passenger, documents: [{ type: 'national-id', number: identity }] } });
  const fetcher = globalThis.fetch, railRequests = [];
  let finishLookup;
  globalThis.fetch = async (url, options) => {
    const { hostname, pathname, searchParams } = new URL(url);
    if (hostname === 'rg-api.zenglingkun.cn' && pathname === '/api/v2/getTrainMain') {
      const service = searchParams.get('trainNum');
      railRequests.push(service);
      assert.equal(searchParams.get('date'), '20261116');
      if (service === 'G21') await new Promise(resolve => { finishLookup = resolve; });
      return Response.json({ success: true, data: { no: service, bureau: 'H', car: 'CR400BF-S', numberFull: [service], rundays: ['20261116'], timetable: [
        { station: '北京南', day: 0, depart: '09:30' }, { station: '上海虹桥', day: 0, arrive: '13:18' }
      ] } });
    }
    if (hostname.endsWith('.zenglingkun.cn')) return Response.json({ success: false }, { status: 404 });
    return fetcher(url, options);
  };
  t.after(() => { window.close(); delete globalThis.chrome; });
  Object.defineProperty(window.navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 Chrome/142.0' });
  const today = Date.parse(railPointsRange().end);
  const daysBefore = days => new Date(today - days * 86400000).toISOString().slice(0, 10);
  const range = { start: daysBefore(45), end: daysBefore(3) };
  let reply, installed = false;
  globalThis.chrome = { runtime: { sendMessage(id, request, callback) {
    assert.equal(id, XINGJI_CONNECTOR_ID);
    if (request.action === 'connectorStatus') { callback(installed ? { installed: true } : undefined); return; }
    assert.deepEqual(request, { action: 'readRailPoints', ...range });
    reply = callback;
  } } };
  await import('../src/app.js');
  const action = '[data-action="rail-points"]';
  await until(() => document.querySelector(action)?.disabled === false);
  const services = document.querySelector('[aria-labelledby="travel-services-title"]');
  assert.ok(services.contains(document.querySelector(action)));
  assert.ok(services.contains(document.querySelector('.desktop-flight-settings')));
  assert.equal(services.querySelectorAll('a[download]').length, 1);
  assert.ok(services.querySelector('.travel-services-heading a[download]'));
  assert.equal(services.querySelector('[data-connector-installation]').hidden, true);
  assert.equal(reply, undefined);
  installed = true;
  window.dispatchEvent(new window.Event('focus'));
  await until(() => document.querySelector('[data-connector-installation]')?.hidden === false);
  assert.equal(document.querySelector('[data-connector-installation]').textContent, '已安装');
  document.querySelector(action).click();
  await until(() => document.querySelector('#rail-points-form'));
  const query = document.querySelector('#rail-points-form');
  assert.equal(query.querySelector('a').href, RAIL_POINTS_PAGE);
  query.elements.start.value = range.start;
  query.elements.end.value = range.end;
  query.querySelector('[type="submit"]').click();
  await until(() => reply);
  reply({ rides: [ride, { ...ride, service: 'G25', passenger: '示例乙' }] });
  await until(() => document.querySelectorAll('[data-action="rail-points-trip"]').length === 2);
  assert.deepEqual(railRequests, []);
  assert.deepEqual(github.records(), []);
  document.querySelectorAll('[data-action="rail-points-trip"]')[1].click();
  await until(() => document.querySelector('#editor-form'));
  assert.equal(document.querySelector('#editor-form').elements.identity.value, '');
  document.querySelector('dialog [data-action="close-modal"]').click();
  document.querySelector(action).click();
  await until(() => document.querySelector('[data-action="rail-points-trip"]'));
  document.querySelector('[data-action="rail-points-trip"]').click();
  await until(() => document.querySelector('#editor-form'));
  const form = document.querySelector('#editor-form');
  assert.equal(form.elements.service.value, 'G21');
  assert.equal(form.elements.origin.value, '北京南');
  assert.equal(form.elements.destination.value, '上海虹桥');
  assert.equal(form.elements.departureTime.required, false);
  assert.equal(form.elements.identity.value, '');
  for (const key of ['origin', 'destination', 'service', 'departureDateYear', 'passenger', 'carriage', 'orderNumber']) assert.equal(form.elements[key].readOnly, true, key);
  for (const selector of ['[name=departureDateMonth]', '[name=departureDateDay]', '[data-seat-preset]', '[data-code-start]', '[data-code-upload]', '#code-photo', '[data-rail-receipt]', '[data-rail-receipt-file]', '[data-rail-photo]', '[data-rail-photo-upload]']) {
    assert.equal(form.querySelector(selector).matches(':disabled'), true, selector);
  }
  assert.equal(form.elements.identity.readOnly, false);
  assert.equal(form.querySelector('[data-seat-number]').readOnly, false);
  form.elements.service.value = 'G100';
  form.elements.service.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(form.elements.service.value, 'G21');
  await until(() => finishLookup);
  assert.deepEqual(railRequests, ['G25', 'G21']);
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(github.records(), []);
  finishLookup();
  await until(() => github.records().length === 1 && !document.querySelector('dialog'));
  const [saved] = github.records();
  assert.equal(saved.departureTime, '09:30');
  assert.equal(saved.fieldSources.departureTime, 'railgo');
  assert.equal(saved.seat, '');
  assert.equal(saved.price, '');
  assert.equal(saved.fieldSources.service, 'rail-points');
  assert.equal(saved.fieldSources.passenger, 'rail-points');
  assert.equal(saved.fieldSources.identity, undefined);
  assert.ok(saved.lockedFields.includes('departureDate'));
  const view = `[data-action="view"][data-id="${saved.id}"]`;
  await until(() => document.querySelector(view));
  document.querySelector(view).click();
  await until(() => document.querySelector('[data-action="edit"]:not(:disabled)'));
  document.querySelector('[data-action="edit"]').click();
  await until(() => document.querySelector('#editor-form'));
  const reopened = document.querySelector('#editor-form');
  assert.equal(reopened.elements.service.readOnly, true);
  assert.equal(reopened.elements.departureTime.readOnly, false);
  assert.match(reopened.querySelector('[data-field-source="departureTime"]').textContent, /RailGo · \d{4}-\d{2}-\d{2}/);
  assert.equal(reopened.querySelector('[data-code-start]').disabled, true);
  assert.deepEqual(railRequests, ['G25', 'G21']);
});
