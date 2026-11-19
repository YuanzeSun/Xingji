import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { D1Store } from '../src/d1.js';
import { activateD1, readSyncState } from '../src/sync-state.js';
import { MemoryGitHub } from './helpers/cloud.js';
import { memoryD1, endpoint, token } from './helpers/d1.js';
import { browser, until, connect, useServers } from './helpers/d1-app.js';

test('either linked login uses the current D1 archive without copying the GitHub backup', async () => {
  const window = browser();
  const d1 = memoryD1([createRecord({ id: 'latest-d1', service: 'G22' })]);
  const id = d1.sqlite.prepare('SELECT id FROM archive_state').get().id;
  const connections = {
    github: { owner: 'user', repo: 'data', id: 77, branch: 'main', token: 'github-credential' },
    d1: { url: endpoint, id, token }
  };
  const github = new MemoryGitHub([createRecord({ id: 'older-github', service: 'G21' })]);
  d1.sqlite.prepare('UPDATE archive_state SET settings = ?').run(JSON.stringify({ connections, flightMcpKey: 'latest' }));
  useServers(github, d1);
  const db = await import('../src/db.js');
  const assertLinked = async () => {
    await until(() => document.querySelector('[data-action="backup-github"]')?.disabled === false);
    assert.equal(sessionStorage.getItem('xingji-github-token'), connections.github.token);
    assert.equal(await db.get('d1Token'), token);
    assert.deepEqual((await db.get('records')).map(row => row.id), ['latest-d1']);
    assert.equal((await db.get('settings')).flightMcpKey, 'latest');
    assert.equal(document.querySelector('dialog'), null);
    assert.equal(github.calls.some(call => call.method === 'PATCH'), false);
    assert.equal(d1.calls.some(call => call.method === 'POST'), false);
  };
  const { token: githubToken, ...githubConfig } = connections.github;
  const { token: d1Token, ...d1Config } = connections.d1;
  const archive = await new D1Store(d1Config, d1Token).read();
  await activateD1(await readSyncState(), d1Config, archive, {
    credential: d1Token, github: { config: githubConfig, token: githubToken }
  });
  try {
    await import('../src/app.js');
    await until(() => github.settings().connections?.d1?.id === id);
    assert.equal(github.records()[0].id, 'older-github', 'publishing an existing link must retain the backup contents');
    assert.equal(d1.calls.some(call => call.method === 'POST'), false);
    await until(() => document.querySelector('[data-action="backup-github"]')?.disabled === false);
    assert.equal(document.querySelector('[data-action="disconnect"], [data-action="disconnect-d1"]'), null);
    document.querySelector('[data-action="disconnect-all"]').click();
    await until(() => document.querySelector('.cloud-setup #d1-form'));
    assert.equal(sessionStorage.getItem('xingji-github-token'), null);
    assert.equal(sessionStorage.getItem('xingji-d1-token'), null);
    github.corrupt('archive/unknown.json', 'obsolete backup content');
    github.calls.length = d1.calls.length = 0;

    d1.available = false;
    connect(window, 'github');
    await until(() => document.querySelector('.cloud-setup')?.textContent.includes('暂时无法连接 D1'));
    assert.equal(sessionStorage.getItem('xingji-github-token'), null);
    assert.equal(await db.get('records', []).then(records => records.length), 0);

    d1.available = true;
    connect(window, 'github');
    await assertLinked();
    assert.equal(document.querySelector('[data-action="disconnect"], [data-action="disconnect-d1"]'), null);
    document.querySelector('[data-action="disconnect-all"]').click();
    await until(() => document.querySelector('.cloud-setup #d1-form'));
    assert.equal(sessionStorage.getItem('xingji-github-token'), null);
    assert.equal(sessionStorage.getItem('xingji-d1-token'), null);

    connect(window, 'd1');
    await assertLinked();
    const githubCalls = github.calls.length;
    document.querySelector('[data-action="sync"]').click();
    await until(() => document.querySelector('[data-d1-cloud-label]')?.textContent === '已同步');
    assert.equal(github.calls.length, githubCalls);
  } finally { window.dispatchEvent(new window.Event('offline')); window.close(); }
});
