import test from 'node:test';
import assert from 'node:assert/strict';
import { indexedDB } from 'fake-indexeddb';
import { sharedSettings, sameSettings, maskedKey } from '../src/shared-settings.js';
import { createRecord, archive } from '../src/model.js';
import { GitHubStore, synchronize } from '../src/github.js';
import { activeBinding, stageSettings, stageRecords, readSyncState, acknowledgeSync } from '../src/sync-state.js';
import * as db from '../src/db.js';
import { MemoryGitHub } from './helpers/cloud.js';
Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
const config = { owner: 'user', repo: 'data', id: 77, branch: 'main' }, base = createRecord({ id: 'trip', origin: '清河', destination: '上海虹桥', service: 'G103', departureDate: '2026-11-15' });
const context = { binding: activeBinding({ config }), generation: '' };
const settings = key => ({ flightMcpKey: key }), store = server => new GitHubStore({ ...config }, 'test-key', server.fetch);
const sync = (server, records, local, baseline, head = server.head) => synchronize(store(server), [base], records, {}, { baseHead: head, baseSettings: baseline, localSettings: local });
async function seed(server, value) { await db.setMany([['records', [base]], ['base', [base]], ['github', config], ['settings', value], ['settingsBase', value], ['syncMeta', { verified: true, pending: false, head: server.head, revision: 1 }]]); }

test('shared settings reject connection credentials; ticket exports never contain service keys', () => {
  assert.deepEqual(sharedSettings(), settings('')); assert.ok(sameSettings(undefined, settings('')));
  for (const value of [{ githubToken: 'should-not-sync' }, { flightMcpKey: 'bad\nkey' }, { flightMcpKey: {} }, null]) assert.throws(() => sharedSettings(value));
  assert.equal(maskedKey('private-key-1234'), '已设置 · 尾号 1234'); assert.doesNotMatch(maskedKey('private-key-1234'), /private-key/);
  assert.doesNotMatch(JSON.stringify(archive([base])), /flightMcpKey|githubToken/);
});

test('a key saved on one device is obtained on another; simultaneous ticket edits retain the key', async () => {
  const server = new MemoryGitHub([base]), original = server.head;
  const saved = await sync(server, [base], settings('shared-key'), settings(''), original);
  assert.equal(server.settings().flightMcpKey, 'shared-key');
  const another = await sync(server, [{ ...base, seat: '08A' }], settings(''), settings(''), original);
  assert.equal(another.settings.flightMcpKey, 'shared-key'); assert.equal(another.records[0].seat, '08A');
  assert.equal(server.settings().flightMcpKey, 'shared-key');
  const downloaded = await new GitHubStore({ ...config }, 'second-device-key', server.fetch).read();
  assert.equal(downloaded.settings.flightMcpKey, 'shared-key'); assert.equal(saved.conflicts.length, 0);
});

test('competing keys require a checked choice and an outdated choice cannot overwrite a new key', async () => {
  const server = new MemoryGitHub([base], settings('old')); const head = server.head; server.push([base], settings('remote'));
  const options = { baseHead: head, baseSettings: settings('old'), localSettings: settings('local') };
  const result = await synchronize(store(server), [base], [base], {}, options);
  assert.equal(result.conflicts.length, 1); const conflict = result.conflicts[0]; assert.equal(conflict.kind, 'settings');
  const choice = { 'settings:flightMcpKey': { choice: 'local', local: conflict.local, remote: conflict.remote } };
  server.push([base], settings('changed-again'));
  assert.equal((await synchronize(store(server), [base], [base], choice, options)).conflicts.length, 1);
  assert.equal(server.calls.some(c => c.method === 'POST'), false);
  const latest = await synchronize(store(server), [base], [base], {}, options), c = latest.conflicts[0];
  const resolved = await synchronize(store(server), [base], [base], { 'settings:flightMcpKey': { choice: 'remote', local: c.local, remote: c.remote } }, options);
  assert.equal(resolved.settings.flightMcpKey, 'changed-again'); assert.equal(resolved.conflicts.length, 0);
});

test('pending settings survive a lost upload reply and a later local ticket edit until atomic confirmation', async () => {
  const server = new MemoryGitHub([base], settings('old')); await seed(server, settings('old'));
  await stageSettings(settings('old'), settings('new'), context); const captured = await readSyncState(); server.loseAcknowledgement = true;
  await assert.rejects(sync(server, captured.records, captured.settings, captured.settingsBase, captured.meta.head), /Connection lost/);
  await stageRecords([base], [{ ...base, price: '500' }], context);
  const reopened = await readSyncState(); assert.equal(reopened.meta.pending, true); assert.equal(reopened.settings.flightMcpKey, 'new');
  const result = await sync(server, reopened.records, reopened.settings, reopened.settingsBase, reopened.meta.head);
  const accepted = await acknowledgeSync(reopened, result);
  assert.equal(accepted.meta.pending, false); assert.equal(accepted.settingsBase.flightMcpKey, 'new'); assert.equal(accepted.base[0].price, '500');
  assert.equal(server.records().length, 1); assert.equal(server.settings().flightMcpKey, 'new');
  await assert.rejects(stageSettings(settings('old'), settings('competing'), context), /更新/);
});
