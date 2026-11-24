import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/db.js';
import { createRecord } from '../src/model.js';
import { MemoryGitHub } from './helpers/cloud.js';
import { memoryD1 } from './helpers/d1.js';
import { browser, until, useServers, connect, chooseSource, confirm } from './helpers/d1-app.js';
import { answerArithmetic } from './helpers/arithmetic.js';

test('a paired reset waits after reload, recognizes a lost D1 response, and keeps the confirmed provider', async () => {
  let window = browser();
  const github = new MemoryGitHub([]);
  const memberships = [{ id: 'test-plan', program: '示例会员计划', number: '0000123456', tier: '示例等级' }];
  const d1 = memoryD1([createRecord({ id: 'ticket', service: 'G21' })], { flightMcpKey: 'reset-setting', profile: { memberships } });
  useServers(github, d1);
  const writes = () => d1.calls.filter(call => call.method === 'POST').length;
  const resume = () => document.querySelector('[data-action="resume-archive-reset"]');
  async function reload(version) {
    window.close();
    window = browser();
    await import('../src/app.js?' + version);
    await until(resume);
  }
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('#d1-form'));
    connect(window, 'd1');
    await until(() => document.querySelector('[data-d1-cloud-label]')?.textContent === '已同步');
    connect(window, 'github');
    await chooseSource('d1');
    await confirm('确认覆盖 GitHub');
    await until(() => document.querySelector('[data-action="backup-github"]')?.disabled === false);

    document.querySelector('[data-action="reset-repository"]').click();
    await until(() => document.querySelector('[data-archive-reset]'));
    const form = document.querySelector('[data-archive-reset]');
    form.elements['unlink-clouds'].click();
    form.querySelector('[name="keep-cloud"][value="github"]').click();
    form.elements['confirm-reset'].click();
    answerArithmetic(document);
    d1.sqlite.exec("CREATE TRIGGER block_reset BEFORE DELETE ON tickets BEGIN SELECT RAISE(ABORT, 'blocked'); END");
    form.querySelector('[type="submit"]').click();
    await until(() => form.querySelector('[data-reset-error]').textContent.includes('尚未确认'));
    const githubAfter = github.head;
    const progress = await db.get('archiveResetProgress');
    assert.equal(progress.step, 'd1');
    assert.equal(progress.keep, 'github');
    assert.equal(progress.githubHead, githubAfter);
    assert.doesNotMatch(JSON.stringify(progress), /credential|reset-setting/);
    const requests = [github.calls.length, d1.calls.length];
    await reload('first-restart');
    assert.deepEqual([github.calls.length, d1.calls.length], requests);
    assert.equal(document.querySelector('[data-action="import-json"]').disabled, true);
    resume().click();
    await until(() => document.querySelector('[data-reset-resume]'));
    assert.match(document.querySelector('dialog').textContent, /继续使用 GitHub/);

    d1.sqlite.exec('DROP TRIGGER block_reset');
    d1.loseAcknowledgement = true;
    document.querySelector('[data-reset-resume] [type="submit"]').click();
    await until(() => document.querySelector('[data-reset-error]')?.textContent.includes('尚未确认'));
    const resets = writes();
    await reload('second-restart');
    resume().click();
    await until(() => document.querySelector('[data-reset-resume]'));
    document.querySelector('[data-reset-resume] [type="submit"]').click();
    await until(() => !document.querySelector('dialog') && document.querySelector('h1')?.textContent === '我的票据');
    assert.equal(github.head, githubAfter, 'the GitHub reset is applied once');
    assert.equal(writes(), resets, 'the acknowledged D1 generation is adopted without rewriting D1');
    assert.equal(await db.get('archiveResetProgress', null), null);
    assert.equal(await db.get('d1', null), null);
    assert.equal((await db.get('github')).id, 77);
    assert.deepEqual(github.records(), []);
    assert.equal(github.settings().flightMcpKey, 'reset-setting');
    assert.deepEqual(github.settings().profile.memberships, memberships);
    assert.deepEqual(JSON.parse(d1.sqlite.prepare('SELECT settings FROM archive_state').get().settings).profile.memberships, memberships);
    assert.deepEqual(github.settings().connections, { unlinked: true });
  } finally { window.close(); }
});
