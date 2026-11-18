import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { MemoryGitHub } from './helpers/cloud.js';
import { memoryD1, token } from './helpers/d1.js';
import { answerArithmetic } from './helpers/arithmetic.js';
import { browser, until, connect, chooseSource, confirm, useServers } from './helpers/d1-app.js';

test('D1-first binding can keep GitHub data and one reset clears both archives', async () => {
  const window = browser();
  const github = new MemoryGitHub([createRecord({ id: 'github-original', service: 'G21' })],
    { flightMcpKey: 'github-mcp', profile: { chineseName: 'GitHub passenger' } });
  const d1 = memoryD1([createRecord({ id: 'd1-original', service: 'G103' })],
    { flightMcpKey: 'old-d1-mcp' });
  useServers(github, d1);
  const reset = () => document.querySelector('[data-action="reset-repository"]');
  const d1Records = () => d1.sqlite.prepare('SELECT id FROM tickets ORDER BY id').all().map(record => record.id);
  const d1Settings = () => JSON.parse(d1.sqlite.prepare('SELECT settings FROM archive_state').get().settings);
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('#d1-form'));
    const firstForm = document.querySelector('#d1-form');
    connect(window, 'd1');
    await until(() => document.querySelector('[data-d1-cloud-label]')?.textContent === '已同步');
    assert.equal(document.querySelector('#d1-form'), null);
    const before = d1.calls.length;
    firstForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(d1.calls.length, before);

    const githubHead = github.head;
    connect(window, 'github');
    await chooseSource('github');
    await confirm('确认覆盖 D1');
    await until(() => document.querySelector('[data-action="backup-github"]')?.disabled === false);
    assert.equal(github.head, githubHead);
    assert.deepEqual(d1Records(), ['github-original']);
    assert.equal(d1Settings().flightMcpKey, 'github-mcp');
    assert.equal(d1Settings().connections.d1.token, token);

    document.querySelector('[data-action="disconnect-d1"]').click();
    await until(() => document.querySelector('#d1-form'));
    assert.equal(sessionStorage.getItem('xingji-d1-token'), null);
    assert.equal(document.querySelector('#d1-form [type="submit"]').textContent, '重新登录 D1');
    reset().click();
    await until(() => document.querySelector('[data-reset-prepare-error]')?.textContent.includes('登录 D1'));
    document.querySelector('[data-reset-preparing] [data-action="close-modal"]').click();
    assert.equal(github.head, githubHead);
    connect(window, 'd1');
    await until(() => document.querySelector('[data-action="backup-github"]')?.disabled === false);
    assert.deepEqual(d1Records(), ['github-original']);
    assert.equal(github.head, githubHead);
    assert.equal(document.querySelectorAll('[data-action="reset-repository"]').length, 1);

    const beforeD1Settings = d1Settings(), beforeGitHubSettings = github.settings();
    reset().click();
    await until(() => document.querySelector('[data-archive-reset]'));
    assert.match(document.querySelector('.reset-targets').textContent, /GitHub.*D1/s);
    const form = document.querySelector('[data-archive-reset]');
    form.elements['confirm-reset'].click();
    answerArithmetic(document);
    d1.sqlite.exec("CREATE TRIGGER block_reset BEFORE DELETE ON tickets BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    form.querySelector('[type="submit"]').click();
    await until(() => form.querySelector('[data-reset-error]').textContent.includes('GitHub 已重置'));
    assert.deepEqual(github.records(), []);
    assert.deepEqual(d1Records(), ['github-original']);
    const afterGitHubReset = github.head;

    d1.sqlite.exec('DROP TRIGGER block_reset');
    form.querySelector('[type="submit"]').click();
    await until(() => !document.querySelector('dialog') && document.querySelector('h1')?.textContent === '我的票据');
    assert.equal(github.head, afterGitHubReset, 'a retry must not reset a completed GitHub archive twice');
    assert.deepEqual(d1Records(), []);
    assert.deepEqual(github.settings(), beforeGitHubSettings);
    assert.deepEqual(d1Settings(), beforeD1Settings);
  } finally { window.dispatchEvent(new window.Event('offline')); window.close(); }
});
