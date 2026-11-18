import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { prepareCloud } from './helpers/cloud.js';
import { memoryD1 } from './helpers/d1.js';
import { browser, until, connect, confirm, useServers } from './helpers/d1-app.js';

test('GitHub first: D1 adopts the latest GitHub data and later CSV imports only write to D1', async () => {
  const window = browser();
  const github = await prepareCloud([createRecord({ id: 'github-ticket', service: 'G21' })], { flightMcpKey: 'github-key' });
  const d1 = memoryD1([createRecord({ id: 'old-d1-ticket', service: 'D801' })]);
  useServers(github, d1);
  const picker = () => document.querySelector('#import-csv-file');
  const writable = () => document.querySelector('[data-action="import-csv"]')?.disabled === false;
  try {
    await import('../src/app.js');
    await until(writable);
    connect(window, 'd1');
    await until(() => document.querySelector('dialog h2')?.textContent === '切换到 Cloudflare D1');
    assert.equal(d1.calls.filter(call => call.method === 'POST').length, 0);
    github.push([createRecord({ id: 'latest-github', service: 'G22' })]);
    await confirm('切换到 Cloudflare D1');
    await until(() => document.querySelector('[data-cloud-label]')?.textContent === '手动备份' && writable());
    const migrated = d1.calls.find(call => call.method === 'POST').body;
    assert.equal(migrated.replace, true);
    assert.deepEqual(migrated.records.map(record => record.id), ['latest-github']);
    assert.equal(migrated.settings.flightMcpKey, 'github-key');
    assert.deepEqual(d1.sqlite.prepare('SELECT id FROM tickets').all().map(row => row.id), ['latest-github']);

    const githubCalls = github.calls.length;
    const csv = '交通方式,车次,出发站,到达站,日期,旅客\n火车,G103,北京南,上海虹桥,2026-11-16,测试旅客\n飞机,CA181,PEK,HND,2026-11-17,EXAMPLE/TRAVELER';
    Object.defineProperty(picker(), 'files', { value: [{ name: 'train.csv', size: csv.length, text: async () => csv }] });
    picker().dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => document.querySelector('[data-action="save-candidates"]'));
    document.querySelector('.candidate-select[data-index="1"]').click();
    document.querySelector('[data-action="save-candidates"]').click();
    await until(() => d1.sqlite.prepare('SELECT count(*) AS count FROM tickets').get().count === 2 && document.querySelector('h1')?.textContent === '我的票据');
    assert.equal(github.calls.length, githubCalls);
    assert.equal(github.records().length, 1);

    d1.available = false;
    window.dispatchEvent(new window.Event('online'));
    await until(() => document.querySelector('#connection-state')?.textContent.includes('当前仅可查看本地缓存'));
    assert.equal(github.calls.length, githubCalls);
  } finally { window.dispatchEvent(new window.Event('offline')); window.close(); }
});
