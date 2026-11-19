import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { D1Store } from '../src/d1.js';
import { MemoryGitHub } from './helpers/cloud.js';
import { memoryD1, endpoint, token } from './helpers/d1.js';
import { browser, until, connect, useServers } from './helpers/d1-app.js';

test('an already signed-in D1 device discovers a new GitHub backup without migrating data', async () => {
  const window = browser();
  const record = createRecord({ id: 'main', service: 'G21' });
  const d1 = memoryD1([record]);
  const github = new MemoryGitHub([createRecord({ id: 'backup', service: 'G22' })]);
  useServers(github, d1);
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('#d1-form'));
    connect(window, 'd1');
    await until(() => document.querySelector('[data-d1-cloud-label]')?.textContent === '已同步');
    const store = new D1Store({ url: endpoint }, token);
    const remote = await store.read();
    const connections = {
      github: { id: 77, owner: 'user', repo: 'data', branch: 'main', token: 'other-device' },
      d1: { id: remote.id, url: endpoint, token },
    };
    github.push(github.records(), { connections });
    await store.write(remote.records, remote, { connections });
    const writes = d1.calls.filter(call => call.method === 'POST').length;
    document.querySelector('[data-action="sync"]').click();
    await until(() => document.querySelector('[data-action="backup-github"]')?.disabled === false);
    assert.equal(sessionStorage.getItem('xingji-github-token'), 'other-device');
    assert.equal(github.calls.some(call => call.method === 'PATCH'), false);
    assert.equal(d1.calls.filter(call => call.method === 'POST').length, writes);
  } finally { window.dispatchEvent(new window.Event('offline')); window.close(); }
});
