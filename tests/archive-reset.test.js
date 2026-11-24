import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { MemoryGitHub } from './helpers/cloud.js';
import { createRecord } from '../src/model.js';
import { GitHubStore, synchronize } from '../src/github.js';
import { bindRepository, readSyncState, replaceWithRemote, acknowledgeSync } from '../src/sync-state.js';

globalThis.indexedDB = indexedDB;
const ticket = year => createRecord({ id: 'ticket-' + year, service: 'G103', origin: '北京南', destination: '上海虹桥', departureDate: `${year}-01-01` });
const config = () => ({ owner: 'user', repo: 'data', branch: 'main', id: 77 });

test('file deletion stops ordinary writes; explicit reset empties all current files and creates a new generation', async () => {
  const records = [ticket(2024), ticket(2025)], server = new MemoryGitHub(records, { profile: { chineseName: '示例' } }), store = new GitHubStore(config(), 'test', server.fetch);
  const original = server.head; server.corrupt('notes.txt', 'keep me'); server.corrupt('archive/index.json', null);
  let request;
  await assert.rejects(synchronize(store, records, records, {}, { baseHead: original }), error => { request = error; return error.code === 'ARCHIVE_FILES_MISSING'; });
  assert.equal(server.calls.some(call => call.method !== 'GET'), false);
  const reset = await store.resetRepository(request.snapshot.head,{profile:{chineseName:'示例'}});
  assert.deepEqual(reset.records, []); assert.equal(reset.settings.profile.chineseName,'示例'); assert.ok(reset.generation);
  const result = await store.read(); assert.equal(result.initialized, true); assert.equal(result.generation, reset.generation);
  assert.deepEqual(result.paths, []);
  const files = server.trees.get(server.commits.get(server.head).tree);
  assert.equal(files['notes.txt'],undefined);assert.deepEqual(Object.keys(files),['archive/index.json']);assert.equal(server.ancestor(original,server.head),true);
  assert.equal(files['archive/2024.json'], undefined); assert.equal(files['archive/2025.json'], undefined);
  await assert.rejects(synchronize(store, records, [{ ...records[0], seat: '08F' }], {}, { baseHead: original }), error => error.code === 'ARCHIVE_RESET');
});

test('missing individual year files also allow reset, but confirmation cannot erase a changed or repaired repository', async () => {
  const server = new MemoryGitHub([ticket(2025)]), store = new GitHubStore(config(), 'test', server.fetch);
  server.corrupt('archive/2025.json', null);
  let request; await assert.rejects(store.read(), error => { request = error; return error.code === 'ARCHIVE_FILES_MISSING'; });
  server.push([ticket(2026)]);
  await assert.rejects(store.resetRepository(request.snapshot.head), /变化|恢复/);
  assert.equal(server.records()[0].id, 'ticket-2026');
  server.private = false; await assert.rejects(store.resetRepository(server.head), /私有/);
});

test('deleting every archive file is a reset request for an existing device, while a fresh repository initializes normally', async () => {
  const records = [ticket(2025)], server = new MemoryGitHub(records), store = new GitHubStore(config(), 'test', server.fetch), original = server.head;
  server.corrupt('archive/2025.json', null); server.corrupt('archive/index.json', null);
  let request;
  await assert.rejects(synchronize(store, records, records, {}, { baseHead: original }), error => { request = error; return error.code === 'ARCHIVE_FILES_MISSING'; });
  assert.equal(server.calls.some(call => call.method !== 'GET'), false);
  const remote = await store.resetRepository(request.snapshot.head);
  const current = await synchronize(store, [], [], {}, { baseHead: remote.head, baseGeneration: remote.generation });
  assert.equal(current.head, remote.head); assert.equal(current.generation, remote.generation);
  const fresh = new MemoryGitHub(); fresh.corrupt('archive/index.json', null);
  assert.deepEqual((await synchronize(new GitHubStore(config(), 'test', fresh.fetch), [], records)).records, records);
});

test('accepting a reset clears local records and settings atomically and retains generation on ordinary acknowledgements', async () => {
  const db = await import('../src/db.js');
  await bindRepository(config());
  await db.setMany([['records', [ticket(2025)]], ['base', [ticket(2025)]], ['settings', { profile: { chineseName: '示例' } }], ['settingsBase', {}], ['syncMeta', { revision: 2, head: 'before', verified: true, pending: true }]]);
  const captured = await readSyncState();
  const remote = { records: [], settings: {}, head: 'after', generation: 'new-generation' };
  const accepted = await replaceWithRemote(captured, remote);
  assert.deepEqual(accepted.records, []); assert.deepEqual(accepted.base, []); assert.deepEqual(accepted.settings, { flightMcpKey: '' });
  assert.equal(accepted.config.id, 77); assert.equal(accepted.meta.generation, 'new-generation'); assert.equal(accepted.meta.pending, false);
  const confirmed = await acknowledgeSync(accepted, remote); assert.equal(confirmed.meta.generation, 'new-generation');
  await assert.rejects(replaceWithRemote(captured, remote), /变化/);
});

test('reset retains known settings despite incompatible ticket files and unknown settings, and confirms a lost upload reply',async()=>{
  const connections = { github: { owner: 'user', repo: 'data', id: 77, branch: 'main', token: 'keep-token' } };
  const memberships = [{ id: 'test-plan', program: '示例会员计划', number: '0000123456', tier: '' }];
  const server=new MemoryGitHub([ticket(2025)],{profile:{chineseName:'保留',memberships},flightMcpKey:'keep-key',connections}),store=new GitHubStore(config(),'test',server.fetch);
  const files=server.trees.get(server.commits.get(server.head).tree),index=JSON.parse(server.blobs.get(files['archive/index.json']));
  index.settings.obsoleteVersionField={old:true};server.corrupt('archive/index.json',JSON.stringify(index));server.corrupt('archive/2025.json','invalid old data');server.corrupt('old-route-cache.json','old cache');
  const before=server.head;server.loseAcknowledgement=true;
  const reset=await store.resetRepository(before);
  assert.equal(reset.settings.profile.chineseName,'保留');assert.equal(reset.settings.flightMcpKey,'keep-key');
  assert.deepEqual(reset.settings.profile.memberships,memberships);
  assert.deepEqual(reset.settings.connections, connections);
  assert.equal(Object.hasOwn(reset.settings,'obsoleteVersionField'),false);
  assert.deepEqual(Object.keys(server.trees.get(server.commits.get(server.head).tree)),['archive/index.json']);
  assert.equal(server.ancestor(before,reset.head),true);assert.equal(server.calls.filter(call=>call.method==='PATCH').length,1);
});
