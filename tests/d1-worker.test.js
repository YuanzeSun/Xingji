import test from 'node:test';
import assert from 'node:assert/strict';
import { D1Store, workerURL } from '../src/d1.js';
import { createRecord } from '../src/model.js';
import { sharedSettings } from '../src/shared-settings.js';
import { endpoint, token, memoryD1 } from './helpers/d1.js';

test('D1 worker restricts origins and access, and supports conditional reads', async () => {
  const db = memoryD1();
  const api = endpoint + '/v1/archive', headers = { Authorization: 'Bearer ' + token };
  assert.equal((await db.fetch(api)).status, 401);
  assert.equal((await db.fetch(api, { headers: { ...headers, Origin: 'https://other.example' } })).status, 403);
  const cors = await db.fetch(api, { method: 'OPTIONS', headers: { Origin: 'https://yuanzesun.github.io' } });
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get('Access-Control-Allow-Origin'), 'https://yuanzesun.github.io');
  assert.match(cors.headers.get('Access-Control-Allow-Headers'), /If-None-Match/);
  const first = await db.fetch(api, { headers });
  const archive = await first.json();
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(archive.records, []);
  headers['If-None-Match'] = `"${archive.id}:${archive.head}"`;
  assert.equal((await db.fetch(api, { headers })).status, 304);
  assert.throws(() => workerURL('https://user:secret@example.com'));
  assert.throws(() => workerURL('http://example.com'));
  assert.throws(() => workerURL('https://example.com/api'));
  assert.equal(workerURL('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
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
});
