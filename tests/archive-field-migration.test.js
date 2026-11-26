import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/db.js';
import { createRecord } from '../src/model.js';
import { createBoardingCode } from '../src/bcbp.js';
import { flightQuery } from '../src/flight-query.js';
import { D1Store } from '../src/d1.js';
import { planArchiveFieldMigration, writeArchiveFieldMigration } from '../src/archive-field-migration.js';
import { prepareCloud } from './helpers/cloud.js';
import { browser, until } from './helpers/d1-app.js';
import { endpoint, memoryD1, token } from './helpers/d1.js';

const flight = createRecord({
  id: 'flight-old', type: 'flight', template: 'air-boarding-pass', service: 'CA181',
  originCode: 'PEK', destinationCode: 'HND', departureDate: '2025-11-15',
  boardingCode: createBoardingCode({
    passenger: 'DOE/JANE', pnr: 'TESTAA', origin: 'PEK', destination: 'HND', carrier: 'CA',
    flightNumber: '181', date: '2025-11-15', cabin: 'Y', seat: '12A', sequence: '25', status: '1'
  }),
  boardingCodeSource: 'original', boardingLegIndex: '0'
});
const flightWithStop = createRecord({ ...flight, flightStop: { ...flightQuery(flight), airport: 'KIX' },
  fieldSources: { ...flight.fieldSources, flightStop: 'variflight' } });
const train = createRecord({ id: 'train-current', service: 'G21', departureDate: '2026-01-01', orderNumber: 'E123456',
  ticketMarks: [{ text: '网', shape: 'circle', offsetX: 6, offsetY: -4 }] });
const oldFlight = {
  ...structuredClone(flight), orderNumber: 'TRAVEL-ORDER', flightStops: { ...flightQuery(flight), count: 1, airports: ['KIX'] },
  offsetX: '5', offsetY: '0', fieldSources: {
    ...flight.fieldSources, orderNumber: 'manual', flightStops: 'variflight', offsetX: 'manual', offsetY: 'default'
  }, lockedFields: ['orderNumber', 'offsetX']
};
for (const field of ['actualBoardingTime', 'boardingCodeSource', 'boardingLegIndex']) delete oldFlight[field];

function replaceOldShard(server) {
  const files = { ...server.trees.get(server.commits.get(server.head).tree) };
  const manifest = JSON.parse(server.blobs.get(files['archive/index.json']));
  const path = 'archive/2025.json';
  const file = JSON.parse(server.blobs.get(files[path]));
  files[path] = manifest.files[path] = server.blob(JSON.stringify({ ...file, records: [oldFlight] }));
  files['archive/index.json'] = server.blob(JSON.stringify(manifest));
  server.head = server.commit(server.tree(files));
  return files;
}

test('GitHub migration previews changes, cancels without writing, and updates only the affected shard after confirmation', async () => {
  const window = browser();
  const server = await prepareCloud([flight, train], { profile: { chineseName: '测试' } });
  const button = () => document.querySelector('[data-action="migrate-fields"]');
  const preview = () => document.querySelector('[data-field-migration-form]');
  const files = replaceOldShard(server);
  const previewHead = server.head;
  await db.setMany([['records', [oldFlight, train]], ['base', [oldFlight, train]],
    ['syncMeta', { revision: 1, head: previewHead, verified: true, pending: false }]]);
  try {
    await import('../src/app.js');
    await until(() => button()?.disabled === false && document.querySelector('#connection-state')?.textContent.includes('字段来源包含无效内容'));
    button().click();
    await until(preview);
    const text = preview().textContent;
    assert.match(text, /2025-11-15 · CA181/);
    const [removed] = preview().querySelectorAll('dd');
    assert.deepEqual(new Set(removed.textContent.split('、')),
      new Set(['订单号', '字段来源 / 订单号', '旧经停资料', '字段来源 / 旧经停资料', '整张票面的横向偏移', '整张票面的纵向偏移',
        '字段来源 / 整张票面的横向偏移', '字段来源 / 整张票面的纵向偏移']));
    assert.match(text, /补齐.*实际登机时间/);
    assert.match(text, /补齐.*条码来源.*条码航段/);
    assert.doesNotMatch(text, /TRAVEL-ORDER/);
    preview().querySelector('[data-action="close-modal"]').click();
    await until(() => !preview());
    assert.equal(server.head, previewHead);
    assert.equal(server.calls.some(call => call.method !== 'GET'), false);

    button().click();
    await until(preview);
    preview().querySelector('[type="submit"]').click();
    await until(() => !preview() && server.head !== previewHead);
    await until(() => button()?.disabled === false);
    assert.deepEqual(server.records(), [flightWithStop, train]);
    assert.deepEqual(await db.get('records'), [flightWithStop, train]);
    assert.equal(server.settings().profile.chineseName, '测试');
    assert.deepEqual(server.calls.find(call => call.method === 'POST' && call.path === '/git/trees').body.tree.map(item => item.path),
      ['archive/2025.json', 'archive/index.json']);
    assert.equal(server.trees.get(server.commits.get(server.head).tree)['archive/2026.json'], files['archive/2026.json']);

    button().click();
    await until(preview);
    assert.match(preview().textContent, /票库已符合当前版本/);
    assert.equal(preview().querySelector('[type="submit"]'), null);
  } finally {
    window.dispatchEvent(new window.Event('offline'));
    window.close();
  }
});

test('D1 migration aborts on a stale preview and updates only changed records after a new preview', async () => {
  const server = memoryD1([oldFlight, train], { flightMcpKey: 'test-key' });
  const store = new D1Store({ url: endpoint }, token, server.fetch.bind(server));
  const snapshot = await store.readRaw();
  const plan = planArchiveFieldMigration(snapshot);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.errors.length, 0);
  const newerTrain = { ...train, gate: '8' };
  await store.write([oldFlight, newerTrain], snapshot, snapshot.settings);
  await assert.rejects(writeArchiveFieldMigration(store, snapshot, plan), { status: 409 });
  assert.equal((await store.readRaw()).records[0].orderNumber, oldFlight.orderNumber);

  const fresh = await store.readRaw();
  await writeArchiveFieldMigration(store, fresh, planArchiveFieldMigration(fresh));
  assert.deepEqual(server.calls.filter(call => call.method === 'POST').at(-1).body.records, [flightWithStop]);
  const migrated = await store.read();
  assert.deepEqual(migrated.records, [flightWithStop, newerTrain]);
  assert.equal(migrated.generation, snapshot.generation);
  assert.equal(migrated.settings.flightMcpKey, 'test-key');
  assert.equal(planArchiveFieldMigration(await store.readRaw()).changes.length, 0);
});

test('a record with an invalid required field is listed and prevents migration', async () => {
  const snapshot = { records: [oldFlight, { ...train, template: '' }] };
  const plan = planArchiveFieldMigration(snapshot);
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.errors, [{ id: train.id, message: '不支持的票面样式' }]);
  await assert.rejects(writeArchiveFieldMigration({}, snapshot, plan), /没有可提交的迁移/);
});
