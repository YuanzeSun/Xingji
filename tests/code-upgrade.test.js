import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeCodeRecords, hasLegacyCodes } from '../src/code-upgrade.js';
import { DEMO_TICKET_CODE } from '../src/demo-code.js';
import { createRecord, archive } from '../src/model.js';
import { GitHubStore, synchronize } from '../src/github.js';
import { MemoryGitHub } from './helpers/cloud.js';

test('old code images convert once to payload data and failed conversion preserves the originals', async () => {
  const image = 'data:image/png;base64,' + btoa('old code image fixture');
  const original = [{ id: 'a', ticketCode: image }, { id: 'b', ticketCode: image }];
  let calls = 0;
  const converted = await upgradeCodeRecords(original, async (blob, type) => {
    calls++; assert.equal(type, 'rail'); assert.equal(blob.type, 'image/png');
    return { codes: [{ data: DEMO_TICKET_CODE, verified: true }], issues: [] };
  });
  assert.equal(calls, 1); assert.equal(hasLegacyCodes(converted), false);
  assert.deepEqual(converted[0].ticketCode, DEMO_TICKET_CODE); assert.equal(original[0].ticketCode, image);
  await assert.rejects(upgradeCodeRecords(original, async () => ({ codes: [], issues: [] })), /保留原数据/);
  assert.equal(original[0].ticketCode, image);
});

test('GitHub writes persist payload and parameters without any image or matrix, even on a conversion-only sync', async () => {
  const record = createRecord({ id: 'code-data', departureDate: '2026-11-15', ticketCode: DEMO_TICKET_CODE });
  const server = new MemoryGitHub([record]), store = new GitHubStore({ owner: 'user', repo: 'data' }, 'test', server.fetch);
  await store.verify(); const snapshot = await store.read();
  const legacyText = JSON.stringify({ ...archive([record]), records: [{ ...record, ticketCode: 'data:image/png;base64,old' }] });
  snapshot.contents['archive/2026.json'] = legacyText; snapshot.rewritePaths = ['archive/2026.json'];
  await store.write([record], snapshot);
  const write = server.calls.findLast(call => call.path === '/git/trees' && call.method === 'POST');
  const yearFile = write.body.tree.find(file => file.path === 'archive/2026.json');
  assert.doesNotMatch(yearFile.content, /data:image|modules|pixels|<svg|<path/);
  assert.deepEqual(JSON.parse(yearFile.content).records[0].ticketCode, DEMO_TICKET_CODE);
  assert.deepEqual((await store.read()).records[0].ticketCode, DEMO_TICKET_CODE);
  let written = 0;
  const mock = { read: async () => ({ ...snapshot, rewritePaths: ['archive/2026.json'] }), write: async () => { written++; return 'converted-head'; } };
  const synced = await synchronize(mock, [record], [record]);
  assert.equal(written, 1); assert.equal(synced.head, 'converted-head');
});
