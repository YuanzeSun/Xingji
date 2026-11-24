import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_TICKET_CODE } from '../src/demo-code.js';
import { createRecord } from '../src/model.js';
import { GitHubStore } from '../src/github.js';
import { MemoryGitHub } from './helpers/cloud.js';

test('GitHub writes persist code payload and parameters without any image or matrix', async () => {
  const record = createRecord({ id: 'code-data', departureDate: '2026-11-15', ticketCode: DEMO_TICKET_CODE });
  const server = new MemoryGitHub(), store = new GitHubStore({ owner: 'user', repo: 'data' }, 'test', server.fetch);
  await store.verify(); const snapshot = await store.read();
  await store.write([record], snapshot);
  const write = server.calls.findLast(call => call.path === '/git/trees' && call.method === 'POST');
  const yearFile = write.body.tree.find(file => file.path === 'archive/2026.json');
  assert.doesNotMatch(yearFile.content, /data:image|modules|pixels|<svg|<path/);
  assert.deepEqual(JSON.parse(yearFile.content).records[0].ticketCode, DEMO_TICKET_CODE);
  assert.deepEqual((await store.read()).records[0].ticketCode, DEMO_TICKET_CODE);
});
