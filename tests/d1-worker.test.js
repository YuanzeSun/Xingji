import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Store, workerURL } from '../src/d1.js';
import worker from '../cloudflare/d1/worker.js';
import { createRecord } from '../src/model.js';
import { sharedSettings } from '../src/shared-settings.js';
import { endpoint, token, memoryD1 } from './helpers/d1.js';

test('D1 worker accepts any origin but requires the bearer token for reads and writes', async () => {
  const db = memoryD1();
  const api = endpoint + '/v1/archive', origin = 'https://other.example';
  const headers = { Authorization: 'Bearer ' + token, Origin: origin };
  assert.equal((await db.fetch(api, { headers: { Origin: origin } })).status, 401);
  const cors = await db.fetch(api, { method: 'OPTIONS', headers: {
    Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type'
  } });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(cors.headers.get('Access-Control-Allow-Methods'), /POST/);
  assert.match(cors.headers.get('Access-Control-Allow-Headers'), /Authorization.*Content-Type.*If-None-Match/);
  const first = await db.fetch(api, { headers });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('Access-Control-Allow-Origin'), '*');
  const archive = await first.json();
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(archive.records, []);
  const unchanged = await db.fetch(api, { headers: { ...headers, 'If-None-Match': `"${archive.id}:${archive.head}"` } });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get('Access-Control-Allow-Origin'), '*');

  const post = { method: 'POST', body: JSON.stringify({
    id: archive.id, head: archive.head, records: [createRecord({ id: 'cross-origin-ticket' })], removed: []
  }) };
  const denied = await db.fetch(api, { ...post, headers: { ...headers, Authorization: 'Bearer invalid' } });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await db.fetch(api, { ...post, headers: { ...headers, 'Content-Type': 'application/json' } })).status, 200);
  const second = await db.fetch(api, { headers: { ...headers, Origin: 'https://another.example' } });
  assert.deepEqual((await second.json()).records.map(record => record.id), ['cross-origin-ticket']);
});

test('D1 connection requires a Worker root URL', () => {
  assert.throws(() => workerURL('https://user:secret@example.com'));
  assert.throws(() => workerURL('http://example.com'));
  assert.throws(() => workerURL('https://example.com/api'));
  assert.equal(workerURL('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
});

test('D1 reports a misnamed binding and missing schema before attempting migration', async () => {
  const misnamed = new D1Store({ url: endpoint }, token, (url, options) =>
    worker.fetch(new Request(url, options), { ARCHIVE_TOKEN: token, xingji: {} }));
  await assert.rejects(misnamed.read(), { status: 503, message: /Worker 缺少 ARCHIVE 绑定/ });

  const db = memoryD1();
  const store = new D1Store({ url: endpoint }, token, db.fetch.bind(db));
  assert.deepEqual((await store.read()).records, []);
  db.sqlite.exec('DELETE FROM archive_state');
  await assert.rejects(store.read(), { status: 503, message: /初始化 SQL/ });
  db.sqlite.exec('DROP TABLE archive_state');
  await assert.rejects(store.read(), { status: 503, message: /初始化 SQL/ });

  const oldWorker = new D1Store({ url: endpoint }, token, async () =>
    Response.json({ error: 'D1 数据库操作失败，请检查 Worker 绑定和数据库迁移' }, { status: 503 }));
  await assert.rejects(oldWorker.read(), { status: 503, message: /读取.*ARCHIVE 绑定/ });
});

test('D1 whole replacements are atomic and stale clients cannot delete or overwrite tickets', async () => {
  const original = createRecord({ id: 'old', service: 'G21' });
  const replacement = createRecord({ id: 'new', service: 'G103' });
  const db = memoryD1([original], { flightMcpKey: 'old-key' });
  const store = new D1Store({ url: endpoint }, token, db.fetch.bind(db));
  const baseline = await store.read();
  db.sqlite.exec("CREATE TRIGGER fail_insert BEFORE INSERT ON tickets WHEN new.id = 'blocked' BEGIN SELECT RAISE(ABORT, 'blocked'); END;");
  await assert.rejects(store.replace(baseline, [replacement, { ...replacement, id: 'blocked' }], sharedSettings()), /503/);
  assert.deepEqual(await store.read(), baseline);

  const state = await store.replace(baseline, [replacement], sharedSettings({ flightMcpKey: 'new-key' }));
  assert.notEqual(state.generation, baseline.generation);
  await assert.rejects(store.replace(baseline, [], sharedSettings()), { status: 409 });
  const current = await store.read();
  assert.deepEqual(current.records.map(row => row.id), ['new']);
  assert.equal(current.settings.flightMcpKey, 'new-key');
  await store.write([replacement, original], current, current.settings);
  assert.deepEqual(db.calls.at(-1).body.records.map(row => row.id), ['old']);
  assert.equal(Object.hasOwn(db.calls.at(-1).body, 'settings'), false);
  assert.equal((await store.read()).generation, current.generation);
  await assert.rejects(store.write([], current, sharedSettings()), { status: 409 });
  assert.deepEqual((await store.read()).records.map(row => row.id), ['new', 'old']);
  const resetId = crypto.randomUUID(), beforeReset = await store.read();
  await assert.rejects(store.replace(beforeReset, [replacement], beforeReset.settings, { resetId }), { status: 400 });
  await assert.rejects(store.replace(beforeReset, [], beforeReset.settings, { resetId: 'bad-id' }), { status: 400 });
  const reset = await store.replace(beforeReset, [], beforeReset.settings, { resetId });
  assert.equal(reset.head, resetId);
  assert.equal(reset.generation, resetId);
  await assert.rejects(store.replace(reset, [], reset.settings, { resetId }), { status: 400 });
  assert.deepEqual(await store.read(), reset);
});
