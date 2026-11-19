import {answerArithmetic} from './helpers/arithmetic.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { prepareCloud } from './helpers/cloud.js';
import { createRecord } from '../src/model.js';

test('deleted archive automatically asks, cancellation preserves cache, and checked confirmation rebuilds an empty library', async () => {
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>', { url: 'http://localhost/#archive' }), { window } = dom;
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData', 'Image']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true });
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  window.HTMLDialogElement.prototype.close = function() { this.open = false; };
  const wait = async predicate => { for (let i = 0; i < 300; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('Reset UI did not settle'); };
  try {
    const db = await import('../src/db.js');
    const records = [createRecord({ service: 'G103', origin: '北京南', destination: '上海虹桥', departureDate: '2025-01-01' })];
    const server = await prepareCloud(records, { profile: { chineseName: '示例' } });
    server.corrupt('notes.txt', 'keep me'); server.corrupt('archive/index.json', null);
    await import('../src/app.js');
    await wait(() => document.querySelector('[data-archive-reset]'));
    assert.equal(document.querySelector('[data-archive-reset] [type="submit"]').disabled, true);
    assert.equal(server.calls.some(call => call.method !== 'GET'), false);
    document.querySelector('[data-archive-reset] [data-action="close-modal"]').click();
    await wait(() => !document.querySelector('dialog'));
    assert.equal(document.querySelector('dialog'), null); assert.equal((await db.get('records')).length, 1);
    assert.equal(document.querySelector('[data-action="new"]').disabled, true);
    document.querySelector('[data-action="reset-archive"]').click();
    await wait(() => document.querySelector('[data-archive-reset]'));
    document.querySelector('[name="confirm-reset"]').click();
    assert.equal(document.querySelector('[data-archive-reset] [type="submit"]').disabled, false);
    answerArithmetic(document);
    document.querySelector('[data-archive-reset]').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await wait(async () => !document.querySelector('dialog') && (await db.get('records')).length === 0);
    assert.deepEqual(server.records(), []); assert.equal(server.settings().profile.chineseName,'示例');
    assert.deepEqual(await db.get('base'), []); assert.equal((await db.get('syncMeta')).pending, false); assert.ok((await db.get('syncMeta')).generation);
    assert.equal(await db.get('githubToken'), 'test-key'); assert.equal((await db.get('github')).id, 77);
    assert.equal(server.calls.filter(call => call.method === 'PATCH').length, 1);
    assert.equal(server.trees.get(server.commits.get(server.head).tree)['notes.txt'],undefined);
  } finally { dom.window.close(); }
});
