import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { MemoryGitHub } from './helpers/cloud.js';
import { D1Store } from '../src/d1.js';
import { endpoint, memoryD1, token } from './helpers/d1.js';
import { browser, until, connect, chooseSource, confirm, useServers } from './helpers/d1-app.js';

test('D1 first: binding backs up once, later changes only reach GitHub on manual backup', async () => {
  const window = browser();
  const github = new MemoryGitHub([createRecord({ id: 'github-ticket', service: 'G21' })], { flightMcpKey: 'github-key', profile: { chineseName: '旧资料' } });
  github.corrupt('README.md', 'keep this');
  const before = github.head;
  const d1 = memoryD1([createRecord({ id: 'd1-ticket', service: 'G103' })], { flightMcpKey: 'd1-key', profile: { chineseName: '测试旅客' } });
  useServers(github, d1);
  const button = () => document.querySelector('[data-action="backup-github"]');
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('#d1-form'));
    assert.equal(document.querySelectorAll('details.setup-help').length, 0);
    assert.equal(document.querySelector('#d1-form [name="remember"]'), null);
    const db = await import('../src/db.js');
    connect(window, 'd1', 'invalid-worker-credential');
    await until(() => document.querySelector('#d1-form .form-error')?.textContent.includes('凭证无效'));
    assert.equal(await db.get('d1Token', ''), '');
    connect(window, 'd1');
    await until(() => document.querySelector('[data-d1-cloud-label]')?.textContent === '已同步');
    assert.equal(github.calls.length, 0);
    assert.equal(await db.get('d1Token'), token);
    assert.equal(d1.calls.filter(call => call.method === 'POST').length, 0);

    connect(window, 'github');
    await until(() => document.querySelector('#archive-source-form'));
    const sourceForm = document.querySelector('#archive-source-form');
    assert.match(sourceForm.textContent, /GitHub · 1 张/);
    assert.match(sourceForm.textContent, /D1 · 1 张/);
    assert.equal(github.records()[0].id, 'github-ticket');
    sourceForm.querySelector('[data-action="close-modal"]').click();
    await until(() => document.querySelector('#github-form button[type="submit"]')?.disabled === false);
    assert.equal(github.head, before);
    assert.equal(sessionStorage.getItem('xingji-github-token'), null);
    connect(window, 'github');
    await chooseSource('d1');
    await confirm('确认覆盖 GitHub');
    await until(() => button()?.disabled === false);
    assert.deepEqual(github.records().map(row => row.id), ['d1-ticket']);
    assert.equal(github.settings().flightMcpKey, 'd1-key');
    assert.equal(github.settings().profile.chineseName, '测试旅客');
    const d1Store = new D1Store({ url: endpoint }, token, d1.fetch.bind(d1));
    const snapshot = await d1Store.read();
    assert.deepEqual(github.settings().connections, {
      github: { owner: 'user', repo: 'data', id: 77, branch: 'main', token: 'github-credential' },
      d1: { id: snapshot.id, url: endpoint, token },
    });
    assert.equal(github.calls.filter(call => call.method === 'PATCH').length, 1);
    assert.ok(github.ancestor(before, github.head));
    assert.ok(github.trees.get(github.commits.get(github.head).tree)['README.md']);
    assert.equal(document.querySelector('#github-form'), null);

    const bindingHead = github.head;
    const calls = github.calls.length;
    await d1Store.write([...snapshot.records, createRecord({ id: 'new-ticket', service: 'G104' })], snapshot,
      { ...snapshot.settings, flightMcpKey: 'new-d1-key' });
    const d1Calls = d1.calls.length;
    window.dispatchEvent(new window.Event('online'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new window.Event('visibilitychange'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(button()?.disabled, false);
    assert.equal(d1.calls.length, d1Calls, 'idle network recovery and foregrounding must not read D1');
    document.querySelector('[data-action="sync"]').click();
    await until(() => d1.calls.length > d1Calls && button()?.disabled === false);
    assert.equal(github.calls.length, calls);
    assert.equal(github.head, bindingHead);

    button().click();
    await confirm('备份到 GitHub');
    await until(() => github.records().length === 2 && button()?.disabled === false);
    assert.equal(github.settings().flightMcpKey, 'new-d1-key');
    const saved = github.head;
    document.querySelector('[data-action=disconnect]').click();
    await until(() => document.querySelector('#github-form') && button().disabled);
    assert.equal(document.querySelector('[data-d1-cloud-label]').textContent, '已同步');
    connect(window, 'github');
    await until(() => button()?.disabled === false && !document.querySelector('#github-form'));
    assert.equal(github.head, saved);
  } finally { window.dispatchEvent(new window.Event('offline')); window.close(); }
});
