import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/db.js';
import { createRecord } from '../src/model.js';
import { fullBackup, readFullBackup } from '../src/archive-backup.js';
import { sharedSettings } from '../src/shared-settings.js';
import { prepareCloud } from './helpers/cloud.js';
import { endpoint, memoryD1, token } from './helpers/d1.js';
import { browser, until, chooseSource, confirm, useServers } from './helpers/d1-app.js';
import { D1Store } from '../src/d1.js';

test('restored tickets and settings sync before proposing the only missing account', async () => {
  const window = browser();
  const github = await prepareCloud([], { flightMcpKey: 'previous-mcp', profile: { chineseName: '旧资料' } });
  const d1 = memoryD1([createRecord({ id: 'old-d1' })], { flightMcpKey: 'different-mcp', profile: { chineseName: '旧 D1 资料' } });
  useServers(github, d1);
  const d1Store = new D1Store({ url: endpoint }, token, d1.fetch.bind(d1));
  const d1Snapshot = await d1Store.read();
  const restored = createRecord({ id: 'restored', service: 'G21', origin: '北京南', destination: '南京南', departureDate: '2026-01-01' });
  const settings = sharedSettings({ flightMcpKey: 'restored-mcp', profile: { chineseName: '测试旅客', documents: [{ id: 'test-passport', type: 'passport', number: 'TEST123' }] } });
  const connections = { github: { owner: 'another', repo: 'other', id: 999, branch: 'main', token: 'test-github-backup-key' },
    d1: { id: d1Snapshot.id, url: endpoint, token } };
  const backup = fullBackup([restored], settings, connections);
  assert.deepEqual(readFullBackup(backup).connections, connections);
  assert.deepEqual(readFullBackup(backup).settings, settings);

  const restore = async value => {
    const picker = document.querySelector('#import-json-file');
    const json = JSON.stringify(value);
    Object.defineProperty(picker, 'files', {
      value: [{ name: 'ticket-backup.json', size: json.length, text: async () => json }], configurable: true
    });
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => document.querySelector('[data-backup-restore]'));
    assert.equal(document.querySelector('[data-connect-from-backup]'), null);
    document.querySelector('[data-backup-restore] button[type=submit]').click();
  };

  try {
    await import('../src/app.js');
    await until(() => document.querySelector('[data-action="import-json"]')?.disabled === false);
    await restore(backup);
    await until(() => document.querySelector('dialog h2')?.textContent === '是否添加 Cloudflare D1 连接');
    assert.deepEqual(github.settings(), settings);
    assert.deepEqual(github.records().map(row => row.id), ['restored']);
    assert.equal(d1.calls.filter(call => call.method === 'POST').length, 0);
    assert.equal(await db.get('githubToken'), 'test-key');
    assert.equal(await db.get('d1Token', ''), '');
    document.querySelector('[data-connect-from-backup]').click();
    const form = document.querySelector('#d1-form');
    assert.equal(form.elements.token.value, token);
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await chooseSource('github');
    await confirm('确认覆盖 D1');
    await until(() => document.querySelector('[data-d1-cloud-label]')?.textContent === '已同步');
    const migrated = await d1Store.read();
    assert.deepEqual(migrated.records.map(row => row.id), ['restored']);
    assert.deepEqual(migrated.settings, { ...settings, connections: {
      github: { owner: 'user', repo: 'data', id: 77, branch: 'main', token: 'test-key' },
      d1: connections.d1
    } });
    assert.deepEqual(readFullBackup(fullBackup(migrated.records, migrated.settings, {})).connections, migrated.settings.connections);

    const newSettings = sharedSettings({ flightMcpKey: 'backup-only-settings' });
    await restore(fullBackup([], newSettings, connections));
    await until(() => !document.querySelector('dialog'));
    assert.deepEqual((await d1Store.read()).settings, { ...newSettings, connections: migrated.settings.connections });
    assert.deepEqual(github.settings(), { ...settings, connections: migrated.settings.connections });
    assert.equal(document.querySelector('[data-connect-from-backup]'), null);
  } finally { window.dispatchEvent(new window.Event('offline')); window.close(); }
});
