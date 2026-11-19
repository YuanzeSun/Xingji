import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { createRecord } from '../src/model.js';
import { GitHubStore, synchronize } from '../src/github.js';
import { readSyncState, stageRecords, acknowledgeSync, bindRepository } from '../src/sync-state.js';
import * as db from '../src/db.js';
import { MemoryGitHub } from './helpers/cloud.js';

Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
const config = () => ({ owner: 'user', repo: 'data', branch: 'main', id: 77 });
const ticket = (extra = {}) => createRecord({ id: 'ticket', service: 'G103', departureDate: '2026-11-15', origin: '清河', destination: '上海虹桥', passenger: '张三', seat: '01A', price: '500', ...extra });
const store = server => new GitHubStore(config(), 'test-key', server.fetch);
async function seed(records, head = 'h0') { await db.setMany([['records', structuredClone(records)], ['base', structuredClone(records)], ['github', config()], ['syncMeta', { head, revision: 1, verified: true, pending: false }], ['lastSync', null]]); }

test('editing a rail ticket into a duplicate rejects different ticket numbers and merges compatible data', async () => {
  const first = ticket({ id: 'a', ticketNumber: 'X000001' });
  const second = ticket({ id: 'b', service: 'G104', ticketNumber: 'X000002', gate: '13A' });
  const proposed = { ...second, service: first.service };
  await seed([first, second]);
  await assert.rejects(stageRecords([first, second], [first, proposed], config()), /票号.*冲突/);
  assert.deepEqual((await readSyncState()).records, [first, second]);

  const server = new MemoryGitHub([second]), baseHead = server.head;
  server.push([second, first]);
  await assert.rejects(synchronize(store(server), [second], [proposed], {}, { baseHead }), /票号.*冲突/);
  assert.equal(server.calls.some(call => call.method === 'POST' || call.method === 'PATCH'), false);
  const staged = await stageRecords([first, second], [first, { ...proposed, ticketNumber: '' }], config());
  assert.equal(staged.records.length, 1);
  assert.equal(staged.records[0].ticketNumber, first.ticketNumber);
  assert.equal(staged.records[0].gate, '13A');
  assert.deepEqual(staged.records[0].mergedIds, ['b']);
});

test('GitHub round-trip keeps ordinal-only and year-only tickets in the shared partitions', async () => {
  const records = [
    ticket({ id:'B', departureDate:{year:2026,dayOfYear:null} }),
    ticket({ id:'a', departureDate:{year:2026,dayOfYear:319} }),
    ticket({ id:'unknown-year', departureDate:{year:null,dayOfYear:319} }),
    ticket({ id:'deleted', deleted:true }),
  ];
  const server = new MemoryGitHub();
  const client = store(server), before = await client.read();
  await client.verify();
  await client.write(records, before);
  const result = await client.read();
  assert.deepEqual(new Set(Object.keys(result.contents)), new Set(['archive/2026.json', 'archive/unknown.json']));
  assert.deepEqual(JSON.parse(result.contents['archive/2026.json']).records.map(row=>row.id), ['B','a']);
  assert.deepEqual(Object.fromEntries(result.records.map(row=>[row.id,row])),Object.fromEntries(records.map(row=>[row.id,row])));
});

test('two devices concurrently edit separate fields, reject the losing branch update, then converge after retry', async () => {
  const base = ticket(), server = new MemoryGitHub([base]), head = server.head;
  const retry = async records => { for (let i = 0; i < 3; i++) { try { return await synchronize(store(server), [base], records, {}, { baseHead: head }); } catch (error) { if (error.status !== 422 || i === 2) throw error; } } };
  await Promise.all([retry([{ ...base, seat: '02A' }]), retry([{ ...base, price: '600' }])]);
  assert.equal(server.records().length, 1); assert.equal(server.records()[0].seat, '02A'); assert.equal(server.records()[0].price, '600');
  assert.ok(server.calls.filter(c => c.method === 'PATCH').length >= 3);
  assert.ok(server.calls.every(c => c.cache === 'no-store'));
});

test('an upload acknowledged only by the server is retried without duplicating records or repeating a commit', async () => {
  const base = ticket(), local = { ...base, price: '600' }, server = new MemoryGitHub([base]), previous = server.head;
  server.loseAcknowledgement = true;
  await assert.rejects(synchronize(store(server), [base], [local], {}, { baseHead: previous }), /Connection lost/);
  const accepted = server.head;
  const retried = await synchronize(store(server), [base], [local], {}, { baseHead: previous });
  assert.equal(retried.head, accepted); assert.equal(server.records().length, 1);
  assert.equal(server.calls.filter(c => c.method === 'PATCH').length, 1);
});

test('a restart reloads pending edits and confirms an already accepted upload without duplication', async () => {
  const base = ticket(), server = new MemoryGitHub([base]); await seed([base], server.head);
  await stageRecords([base], [{ ...base, price: '600' }], config());
  const beforeShutdown = await readSyncState(); server.loseAcknowledgement = true;
  await assert.rejects(synchronize(store(server), beforeShutdown.base, beforeShutdown.records, {}, { baseHead: beforeShutdown.meta.head }), /Connection lost/);
  // Reopen application state entirely from storage; no in-memory sync response survives.
  const restarted = await readSyncState();
  assert.equal(restarted.meta.pending, true); assert.equal(restarted.records[0].price, '600'); assert.equal(restarted.base[0].price, '500');
  const result = await synchronize(store(server), restarted.base, restarted.records, {}, { baseHead: restarted.meta.head });
  const confirmed = await acknowledgeSync(restarted, result);
  assert.equal(confirmed.meta.pending, false); assert.equal(confirmed.meta.head, server.head);
  assert.equal(server.records().length, 1); assert.equal(server.calls.filter(c => c.method === 'PATCH').length, 1);
});

test('incomplete, altered or rolled-back cloud snapshots never trigger a write', async () => {
  for (const damage of ['missing', 'altered', 'index']) {
    const server = new MemoryGitHub([ticket()]);
    server.corrupt(damage === 'index' ? 'archive/index.json' : 'archive/2026.json', damage === 'altered' ? '{}' : null);
    await assert.rejects(synchronize(store(server), [], [ticket()]), /索引|完整|校验/);
    assert.equal(server.calls.some(c => c.method === 'POST'), false);
  }
  const server = new MemoryGitHub([ticket()]), old = server.head, current = server.push([ticket({ price: '600' })]); server.head = old;
  await assert.rejects(synchronize(store(server), [ticket()], [ticket()], {}, { baseHead: current }), /回退|分叉/);
  assert.equal(server.calls.some(c => c.method === 'POST'), false);
  server.id = 88; await assert.rejects(store(server).verify(), /身份/);
});

test('independent IDs with conflicting data are rejected before a cloud write', async () => {
  const a = ticket({ id: 'a', lockedFields: ['seat'] }), b = ticket({ id: 'b', seat: '02A', lockedFields: ['seat'] }), server = new MemoryGitHub([a]);
  await assert.rejects(synchronize(store(server), [], [b]), /座位.*冲突/);
  assert.deepEqual(server.records().map(record => record.id), ['a']);
  assert.equal(server.calls.some(c => c.method === 'POST'), false);
});

test('local transactions preserve edits from two tabs and reject competing changes to the same field', async () => {
  const base = ticket(); await seed([base]);
  await Promise.all([stageRecords([base], [{ ...base, seat: '02A' }], config()), stageRecords([base], [{ ...base, price: '600' }], config())]);
  const current = await readSyncState(); assert.equal(current.records[0].seat, '02A'); assert.equal(current.records[0].price, '600'); assert.equal(current.meta.pending, true);
  await seed([base]);
  const results = await Promise.allSettled([stageRecords([base], [{ ...base, seat: '02A' }], config()), stageRecords([base], [{ ...base, seat: '03A' }], config())]);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  await assert.rejects(bindRepository({ ...config(), id: 99 }), /其他仓库/);
});

test('an in-flight sync retains later edits, while a stale acknowledgement cannot replace a newer baseline', async () => {
  const base = ticket(); await seed([base]); const captured = await readSyncState();
  await stageRecords([base], [{ ...base, price: '600' }], config());
  const result = await acknowledgeSync(captured, { records: [{ ...base, seat: '02A' }], head: 'h1' });
  assert.equal(result.records[0].price, '600'); assert.equal(result.records[0].seat, '02A'); assert.equal(result.meta.pending, true);
  const stale = await acknowledgeSync(captured, { records: [base], head: 'old' });
  assert.equal(stale.retry, true); assert.equal((await readSyncState()).meta.head, 'h1');
  const next = await readSyncState(); const clean = await acknowledgeSync(next, { records: next.records, head: 'h2' });
  assert.equal(clean.meta.pending, false);
  const unchanged = await acknowledgeSync(await readSyncState(), { records: clean.records, head: 'h2' });
  assert.equal(unchanged.changed, false, 'unchanged polls must not create cross-tab broadcast loops');
});

test('a failed local transaction cannot leave records and baseline half updated', async () => {
  const before = ticket(); await seed([before]);
  await assert.rejects(db.atomic(['records', 'base'], () => ({ write: { records: [ticket({ price: '999' })], base: () => {} } })));
  assert.deepEqual((await readSyncState()).records, [before]); assert.deepEqual((await readSyncState()).base, [before]);
});
