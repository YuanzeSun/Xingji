import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { createRecord } from '../src/model.js';
import { prepareCloud } from './helpers/cloud.js';

test('statistics navigation reads the current archive, preserves its range across pages and never writes archive data', async () => {
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>', { url: 'http://localhost/#archive' }), { window } = dom;
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData', 'Image']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true }); window.scrollTo = () => {};
  const rows = [createRecord({ origin: '北京南', destination: '上海虹桥', departureDate: '2020-01-01' }), createRecord({ type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'HND', departureDate: '2024-01-01', aircraft: 'A320' }), createRecord({ departureDate: '2200-01-01' })];
  const server = await prepareCloud(rows);
  const wait = async fn => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Statistics page did not settle'); };
  const click = page => document.querySelector(`[data-action="navigate"][data-page="${page}"]`).click();
  try {
    await import('../src/app.js'); await wait(() => document.querySelector('[data-page="statistics"]'));
    click('statistics'); await wait(() => document.querySelector('.statistics-summary'));
    assert.equal(location.hash, '#statistics'); assert.match(document.querySelector('.statistics-summary').textContent, /火车1次飞机1次/);
    const from = document.querySelector('[data-stat-from]'); from.value = '2024-01-01'; from.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.match(document.querySelector('.statistics-summary').textContent, /火车0次飞机1次/);
    click('archive'); await wait(() => document.querySelector('.ticket-grid'));
    click('statistics'); await wait(() => document.querySelector('.statistics-summary'));
    assert.equal(document.querySelector('[data-stat-from]').value, '2024-01-01');
    assert.equal(server.calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method)), false);
    assert.equal(server.records().length, 3);
  } finally { window.dispatchEvent(new window.Event('offline')); dom.window.close(); }
});
