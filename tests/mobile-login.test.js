import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { MemoryGitHub } from './helpers/cloud.js';
import { createRecord } from '../src/model.js';
import { sharedSettings } from '../src/shared-settings.js';

test('a fresh mobile login accepts cloud profiles and keys without rewriting the archive', async () => {
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>', { url: 'http://localhost/' }), { window } = dom;
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', configurable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true }); window.scrollTo = () => {};
  const record = createRecord({ id: 'mobile-ticket', origin: '北京南', destination: '天津', service: 'C2021', departureDate: '2023-05-26' });
  const settings = sharedSettings({ flightMcpKey: 'fictional-cloud-key', profile: { chineseName: '测试旅客' } });
  const server = new MemoryGitHub([record], settings), originalHead = server.head;
  globalThis.fetch = server.fetch;
  const wait = async check => { for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('Mobile login did not settle'); };
  try {
    await import('../src/app.js'); await wait(() => document.querySelector('#github-form'));
    const form = document.querySelector('#github-form');
    for (const [field, value] of Object.entries({ owner: 'user', repo: 'data', token: 'fictional-login-token' })) form.elements[field].value = value;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await wait(() => document.querySelector('.ticket-card') && document.querySelector('.sync-button')?.textContent.includes('已同步'));
    const db = await import('../src/db.js');
    assert.deepEqual(await db.get('settings'), settings);
    assert.equal((await db.get('records'))[0].id, record.id);
    assert.equal(server.head, originalHead);
    assert.equal(server.calls.some(call => ['POST', 'PATCH'].includes(call.method)), false);
    assert.doesNotMatch(document.body.textContent, /不支持的字段|fictional-cloud-key/);
  } finally { dom.window.close(); }
});
