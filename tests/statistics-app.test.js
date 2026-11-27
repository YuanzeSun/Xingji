import { applyStatisticsDate, bindTestDialogs } from './helpers/stat-date.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { todayDate } from '../src/journey-date.js';
import { createRecord } from '../src/model.js';
import { prepareCloud } from './helpers/cloud.js';

test('statistics navigation reads the current archive, preserves its range across pages and never writes archive data', async () => {
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>', { url: 'http://localhost/#archive' }), { window } = dom;
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData', 'Image']) Object.defineProperty(globalThis, key, { value: key === 'window' ? window : window[key], configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  Object.defineProperty(globalThis, 'indexedDB', { value: indexedDB, configurable: true }); window.scrollTo = () => {};
  bindTestDialogs(window);
  const train = { origin: '北京南', destination: '上海虹桥', service: 'G1', railTrainsets: 'CR400BF-B-5099' };
  const rows = [
    createRecord({ ...train, departureDate: '2020-01-01' }),
    createRecord({ ...train, departureDate: '2021-01-01', service: 'G21' }),
    createRecord({ type: 'flight', template: 'air-boarding-pass', origin: 'PEK', destination: 'HND', departureDate: '2024-01-01', aircraft: 'A320' }),
    createRecord({ departureDate: '2200-01-01' })
  ];
  const server = await prepareCloud(rows);
  const wait = async fn => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('Statistics page did not settle'); };
  const click = page => document.querySelector(`[data-action="navigate"][data-page="${page}"]`).click();
  const counts = () => Array.from(document.querySelectorAll('.statistics-journey-card'), card =>
    Array.from(card.querySelectorAll('dl > div:nth-child(-n+2) strong'), value => value.textContent));
  try {
    await import('../src/app.js'); await wait(() => document.querySelector('[data-page="statistics"]'));
    click('statistics'); await wait(() => document.querySelector('.statistics-journey-metrics'));
    assert.equal(location.hash, '#statistics'); assert.deepEqual(counts(), [['2 次', '2 个'], ['1 班', '2 个']]);
    const repeats = document.querySelector('[data-stat-repeated="rail"]');
    repeats.querySelector('summary').click();
    repeats.querySelector('[data-action="view"]').click();
    await wait(() => document.querySelector('.ticket-detail-modal'));
    assert.equal(document.querySelector('.ticket-detail-modal .heading-service').textContent, 'G21');
    document.querySelector('.ticket-detail-modal [data-action="close-modal"]').click();
    await wait(() => !document.querySelector('.ticket-detail-modal'));
    assert.equal(repeats.querySelector('details').open, true);
    const from = document.querySelector('[data-stat-from]');
    from.click();
    const dialog = document.querySelector('.statistics-date-dialog');
    const date = dialog.querySelector('input[type="date"]');
    assert.equal(date.value, '');
    assert.equal(date.max, todayDate());
    date.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(dialog.open, true);
    assert.equal(from.textContent, '不限');
    assert.deepEqual(counts(), [['2 次', '2 个'], ['1 班', '2 个']]);
    dialog.querySelector('[data-cancel-date]').click();
    assert.equal(from.textContent, '不限');
    const end = document.querySelector('[data-stat-to]');
    end.click();
    const endForm = document.querySelector('.statistics-date-dialog form');
    endForm.elements.date.value = '2200-01-01';
    assert.equal(endForm.checkValidity(), false);
    endForm.querySelector('[data-clear-date]').click();
    assert.equal(document.querySelector('[data-stat-to]').textContent, todayDate());
    applyStatisticsDate(document, '[data-stat-from]', '2024-01-01');
    assert.deepEqual(counts(), [['0 次', '0 个'], ['1 班', '2 个']]);
    click('archive'); await wait(() => document.querySelector('.ticket-grid'));
    click('statistics'); await wait(() => document.querySelector('.statistics-journey-metrics'));
    assert.equal(document.querySelector('[data-stat-from]').textContent, '2024-01-01');
    assert.equal(server.calls.some(call => ['POST', 'PATCH', 'DELETE'].includes(call.method)), false);
    assert.equal(server.records().length, 4);
  } finally { window.dispatchEvent(new window.Event('offline')); dom.window.close(); }
});
