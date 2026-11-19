import test from 'node:test';
import assert from 'node:assert/strict';
import { fullBackup } from '../src/archive-backup.js';
import { createRecord } from '../src/model.js';
import { prepareCloud } from './helpers/cloud.js';
import { memoryD1 } from './helpers/d1.js';
import { browser, until, connect, chooseSource, confirm, useServers } from './helpers/d1-app.js';

test('GitHub first: D1 adopts the latest GitHub data and later JSON imports only write to D1', async () => {
  const window = browser();
  const github = await prepareCloud([createRecord({ id: 'github-ticket', service: 'G21' })], { flightMcpKey: 'github-key' });
  const d1 = memoryD1([createRecord({ id: 'old-d1-ticket', service: 'D801' })]);
  useServers(github, d1);
  const picker = () => document.querySelector('#import-json-file');
  const writable = () => document.querySelector('[data-action="import-json"]')?.disabled === false;
  try {
    await import('../src/app.js');
    await until(writable);
    connect(window, 'd1');
    await until(() => document.querySelector('#archive-source-form'));
    assert.equal(d1.calls.filter(call => call.method === 'POST').length, 0);
    await chooseSource('github');
    github.push(github.records(), { connections: {
      github: { id: 77, owner: 'user', repo: 'data', branch: 'main', token: 'github-credential' },
      d1: { id: '0'.repeat(32), url: 'https://different.workers.dev', token: 'other-d1' }
    } });
    await confirm('确认覆盖 D1');
    await until(() => document.querySelector('#d1-form')?.parentElement.textContent.includes('已关联另一份 D1 票库'));
    assert.equal(d1.calls.filter(call => call.method === 'POST').length, 0);

    github.push(github.records(), { flightMcpKey: 'github-key' });
    connect(window, 'd1');
    await chooseSource('github');
    github.push([createRecord({ id: 'latest-github', service: 'G22' })]);
    await confirm('确认覆盖 D1');
    await until(() => document.querySelector('[data-cloud-label]')?.textContent === '手动备份' && writable());
    const migrated = d1.calls.find(call => call.method === 'POST').body;
    assert.equal(migrated.replace, true);
    assert.deepEqual(migrated.records.map(record => record.id), ['latest-github']);
    assert.equal(migrated.settings.flightMcpKey, 'github-key');
    assert.deepEqual(d1.sqlite.prepare('SELECT id FROM tickets').all().map(row => row.id), ['latest-github']);

    const githubCalls = github.calls.length;
    const json = JSON.stringify(fullBackup([
      createRecord({ id: 'imported', service: 'G103', origin: '北京南', destination: '上海虹桥', departureDate: '2026-11-16' })
    ], { flightMcpKey: 'github-key' }, {}));
    Object.defineProperty(picker(), 'files', { value: [{ name: 'archive.json', size: json.length, text: async () => json }] });
    picker().dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => document.querySelector('[data-backup-restore] button[type=submit]'));
    document.querySelector('[data-backup-restore] button[type=submit]').click();
    await until(() => d1.sqlite.prepare('SELECT count(*) AS count FROM tickets').get().count === 2 && !document.querySelector('dialog'));
    assert.equal(github.calls.length, githubCalls);
    assert.equal(github.records().length, 1);

    d1.available = false;
    document.querySelector('[data-action="sync"]').click();
    await until(() => document.querySelector('#connection-state')?.textContent.includes('当前仅可查看本地缓存'));
    assert.equal(github.calls.length, githubCalls);
  } finally { window.dispatchEvent(new window.Event('offline')); window.close(); }
});
