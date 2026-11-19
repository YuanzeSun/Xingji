import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecord } from '../src/model.js';
import { signOutCloud } from '../src/sync-state.js';
import { prepareCloud } from './helpers/cloud.js';
import { endpoint, token } from './helpers/d1.js';
import { browser, until } from './helpers/d1-app.js';

test('another tab restores sign-in and clears the cache on joint sign-out without a cloud refresh', async () => {
  const window = browser();
  let channel;
  window.BroadcastChannel = class extends window.EventTarget {
    constructor() { super(); channel = this; }
    postMessage() {}
  };
  const github = await prepareCloud([createRecord({ id: 'ticket', service: 'G21' })]);
  const db = await import('../src/db.js');
  const snapshot = await db.atomic(['github', 'githubToken', 'records', 'base', 'settings', 'settingsBase', 'syncMeta']);
  await signOutCloud();
  const notify = data => channel.dispatchEvent(new window.MessageEvent('message', { data }));
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('.cloud-setup #github-form'));
    const requests = github.calls.length;
    await db.setMany([['github', snapshot.github], ['githubToken', 'new-login']]);
    notify({});
    await until(() => document.querySelector('.cloud-setup [data-action="disconnect"]'));
    await db.setMany(Object.entries(snapshot).filter(([key]) => key !== 'githubToken'));
    notify({});
    await until(() => document.querySelector('[data-action="import-json"]')?.disabled === false);
    assert.equal(await db.get('githubToken'), 'new-login');
    assert.equal(github.calls.length, requests);

    await db.setMany([['d1', { id: '1'.repeat(32), url: endpoint }], ['d1Token', token]]);
    notify({});
    await until(() => document.querySelector('[data-action="backup-github"]')?.disabled === false);
    assert.ok(document.querySelector('[data-action="disconnect-all"]'));

    await signOutCloud();
    notify({ clearView: true });
    await until(() => document.querySelector('.cloud-setup #github-form'));
    assert.equal(await db.get('githubToken', ''), '');
    assert.equal(await db.get('d1Token', ''), '');
    assert.deepEqual(await db.get('records'), []);
    assert.equal(github.calls.length, requests);
  } finally { window.close(); }
});
