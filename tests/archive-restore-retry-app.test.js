import test from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/db.js';
import { createRecord } from '../src/model.js';
import { fullBackup } from '../src/archive-backup.js';
import { prepareCloud } from './helpers/cloud.js';
import { endpoint, token } from './helpers/d1.js';
import { browser, until } from './helpers/d1-app.js';

test('JSON restore resumes the account choice after a failed upload and drops it when the session ends', async () => {
  const window = browser();
  const github = await prepareCloud();
  let rejectUpload = true;
  globalThis.fetch = async function (url, options) {
    assert.equal(new URL(url).hostname, 'api.github.com', 'restoring tickets must not connect to the D1 account');
    if (rejectUpload && options?.method === 'POST') throw new TypeError('Network interrupted');
    return github.fetch(url, options);
  };
  const connections = { d1: { id: '1'.repeat(32), url: endpoint, token } };
  const followup = () => document.querySelector('[data-restore-followup]');
  const next = () => document.querySelector('[data-action="continue-backup-restore"]');
  async function restore(id) {
    const file = document.querySelector('#import-json-file');
    const json = JSON.stringify(fullBackup([createRecord({ id, service: 'G21' })], {}, connections));
    Object.defineProperty(file, 'files', { value: [{ name: 'archive.json', size: json.length, text: async () => json }] });
    file.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => document.querySelector('[data-backup-restore]'));
    document.querySelector('[data-backup-restore] [type="submit"]').click();
    await until(() => followup()?.textContent.includes('等待同步'));
    assert.equal(next(), null);
    assert.equal(document.querySelector('[data-connect-from-backup]'), null);
  }
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('[data-action="import-json"]')?.disabled === false);
    await restore('restored');
    assert.equal((await db.get('syncMeta')).pending, true);
    assert.deepEqual(github.records(), []);
    rejectUpload = false;
    document.querySelector('[data-action="sync"]').click();
    await until(next);
    assert.equal((await db.get('syncMeta')).pending, false);
    assert.equal(github.records()[0].id, 'restored');
    next().click();
    await until(() => document.querySelector('[data-connect-from-backup]'));
    document.querySelector('[data-connect-from-backup]').click();
    assert.equal(document.querySelector('#d1-form [name="url"]').value, endpoint);
    assert.equal(document.querySelector('#d1-form [name="token"]').value, token);

    rejectUpload = true;
    await restore('next');
    document.querySelector('[data-action="disconnect"]').click();
    await until(() => document.querySelector('.cloud-setup #github-form'));
    assert.equal(next(), null);
    assert.equal(document.querySelector('#d1-form [name="token"]').value, '');
    assert.equal((await db.get('syncMeta')).pending, undefined);
  } finally { window.close(); }
});
