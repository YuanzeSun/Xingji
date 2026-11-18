import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { MemoryGitHub } from './helpers/cloud.js';
import { memoryD1 } from './helpers/d1.js';
import { browser, until, connect, confirm, useServers } from './helpers/d1-app.js';

test('D1 first: binding clears the GitHub archive until the user backs up', async () => {
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
    connect(window, 'd1');
    await until(() => document.querySelector('[data-d1-cloud-label]')?.textContent === '已同步');
    assert.equal(github.calls.length, 0);
    assert.equal(d1.calls.filter(call => call.method === 'POST').length, 0);

    connect(window, 'github');
    await until(() => document.querySelector('dialog h2')?.textContent === '将 GitHub 绑定为备份仓库');
    assert.equal(github.records()[0].id, 'github-ticket');
    await confirm('将 GitHub 绑定为备份仓库');
    await until(() => button()?.disabled === false);
    assert.deepEqual(github.records(), []);
    assert.equal(github.settings().flightMcpKey, '');
    assert.equal(github.settings().profile, undefined);
    assert.ok(github.ancestor(before, github.head));
    assert.ok(github.trees.get(github.commits.get(github.head).tree)['README.md']);

    const calls = github.calls.length;
    const d1Calls = d1.calls.length;
    window.dispatchEvent(new window.Event('online'));
    await until(() => d1.calls.length > d1Calls && button()?.disabled === false);
    assert.equal(github.calls.length, calls);
    assert.deepEqual(github.records(), []);

    button().click();
    await confirm('备份到 GitHub');
    await until(() => github.records().length === 1 && button()?.disabled === false);
    assert.equal(github.records()[0].id, 'd1-ticket');
    assert.equal(github.settings().flightMcpKey, 'd1-key');
    assert.equal(github.settings().profile.chineseName, '测试旅客');

    const saved = github.head;
    connect(window, 'github');
    await until(() => button()?.disabled === false && document.querySelector('#github-form button[type="submit"]')?.disabled === false);
    assert.equal(github.head, saved);
  } finally { window.dispatchEvent(new window.Event('offline')); window.close(); }
});
