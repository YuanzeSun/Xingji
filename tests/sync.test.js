import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubStore, synchronize } from '../src/github.js';
import { createRecord } from '../src/model.js';
import { MemoryGitHub } from './helpers/cloud.js';
const record = () => createRecord({ id: 'sync-test', origin: '北京', destination: '上海', seat: '01A' });
test('initial connection and background sync call fetch with its global browser receiver', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async function (url, options) {
    assert.equal(this, globalThis, 'browser fetch must receive Window, never GitHubStore');
    assert.equal(url, 'https://api.github.com/repos/user/data');
    assert.equal(options.cache, 'no-store');
    calls++;
    return Response.json({ id: 77, private: true, permissions: { push: true }, default_branch: 'main' });
  };
  try {
    await new GitHubStore({ owner: 'user', repo: 'data' }, 'test-key').verify();
    await new GitHubStore({ owner: 'user', repo: 'data' }, 'test-key', globalThis.fetch).verify();
    assert.equal(calls, 2);
  } finally { globalThis.fetch = previous; }
});

test('public data repositories are rejected before any write', async () => {
  const calls = [];
  const store = new GitHubStore({ owner: 'user', repo: 'data' }, 'redacted', async (url, options) => { calls.push(options); return new Response(JSON.stringify({ private: false, permissions: { push: true } })); });
  await assert.rejects(() => store.verify(), /私有仓库/); assert.equal(calls.length, 1); assert.equal(calls[0].method, undefined);
});
test('a GitHub archive index requires the reset generation and settings', async () => {
  const server = new MemoryGitHub();
  const store = new GitHubStore({ owner: 'user', repo: 'data', branch: 'main' }, 'test-key', server.fetch);
  const { manifest } = await store.readArchiveIndex();
  for (const [field, error] of [['generation', /重置标识/], ['settings', /索引无效/]]) {
    const incomplete = { ...manifest };
    delete incomplete[field];
    server.corrupt('archive/index.json', JSON.stringify(incomplete));
    await assert.rejects(store.read(), error);
  }
});
test('conflicts do not write; explicit choices are rechecked against current remote', async () => {
  const base = record(), local = { ...base, seat: '02A' }, remote = { ...base, seat: '03A' };
  let writes = 0;
  const store = { read: async () => ({ records: [remote] }), write: async () => writes++ };
  const result = await synchronize(store, [base], [local]); assert.equal(result.conflicts.length, 1); assert.equal(writes, 0);
  const choice = { 'sync-test:seat': { choice: 'remote', local: '02A', remote: '03A' } };
  const resolved = await synchronize(store, [base], [local], choice); assert.equal(resolved.conflicts.length, 0); assert.equal(resolved.records[0].seat, '03A');
  remote.seat = '04A'; const stale = await synchronize(store, [base], [local], choice); assert.equal(stale.conflicts.length, 1);
});
test('all year files are committed together and a non-forced branch update prevents clobbering', async () => {
  const calls = [];
  const store = new GitHubStore({ owner: 'user', repo: 'data', branch: 'main' }, 'redacted', async (url, options) => {
    calls.push({ path: new URL(url).pathname, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ sha: calls.length === 1 ? 'tree-sha' : 'commit-sha' }));
  });
  await store.write([record()], { head: 'old-head', tree: 'old-tree', paths: ['archive/2010.json'] });
  assert.equal(calls[0].body.base_tree, 'old-tree'); assert.equal(calls[0].body.tree.some(t => t.path === 'archive/2010.json' && t.sha === null), true);
  assert.deepEqual(calls[1].body.parents, ['old-head']); assert.equal(calls[2].body.force, false);
});

test('direct deletion removes ticket contents and concurrent edits can be retained with a checked choice', async () => {
  const base = record(), deleted = createRecord({ ...base, deleted: true });
  assert.deepEqual(deleted, { id: base.id, deleted: true, updatedAt: base.updatedAt });
  let remote = { ...base, seat: '03A' }, written;
  const store = { read: async () => ({ records: [remote] }), write: async records => { written = records; } };
  const conflict = await synchronize(store, [base], [deleted]);
  assert.equal(conflict.conflicts.length, 1); assert.equal(conflict.conflicts[0].field, 'deleted'); assert.equal(written, undefined);
  const c = conflict.conflicts[0], keep = { 'sync-test:deleted': { choice: 'remote', local: c.local, remote: c.remote, context: c.context } };
  const retained = await synchronize(store, [base], [deleted], keep);
  assert.equal(retained.conflicts.length, 0); assert.equal(retained.records[0].seat, '03A'); assert.equal(retained.records[0].origin, '北京');
  const discard = { 'sync-test:deleted': { ...keep['sync-test:deleted'], choice: 'local' } };
  assert.equal((await synchronize(store, [base], [deleted], discard)).conflicts.length, 0);
  assert.deepEqual(written, [deleted]);
  remote = { ...remote, seat: '04A' }; written = undefined;
  assert.equal((await synchronize(store, [base], [deleted], keep)).conflicts.length, 1, 'a new edit must invalidate an earlier deletion choice');
  assert.equal(written, undefined);
  const removed = await synchronize({ read: async () => ({ records: [base] }), write: async records => { written = records; } }, [base], [deleted]);
  assert.equal(removed.conflicts.length, 0); assert.deepEqual(written, [deleted]);
});
