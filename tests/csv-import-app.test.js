import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { indexedDB } from 'fake-indexeddb';
import { prepareCloud } from './helpers/cloud.js';

test('the CSV button opens the picker and saves only reviewed tickets to GitHub', async () => {
  const dom = new JSDOM('<div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>', { url: 'http://localhost/#data' });
  const { window } = dom;
  for (const key of ['window', 'document', 'location', 'history', 'sessionStorage', 'FormData', 'navigator', 'indexedDB']) {
    Object.defineProperty(globalThis, key, { value: key === 'window' ? window : key === 'indexedDB' ? indexedDB : window[key], configurable: true });
  }
  window.scrollTo = () => {};
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const waitFor = async check => {
    for (let i = 0; i < 200; i++) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('CSV import did not settle');
  };
  const server = await prepareCloud([]);
  const importButton = () => document.querySelector('[data-action="import-csv"]');
  const choose = (name, contents) => {
    const picker = document.querySelector('#import-csv-file');
    Object.defineProperty(picker, 'files', { value: [{name,size:contents.length,text:async () => contents}], configurable: true });
    picker.dispatchEvent(new window.Event('change', { bubbles: true }));
  };

  try {
    await import('../src/app.js');
    await waitFor(() => importButton()?.disabled === false);
    assert.ok(document.querySelector('.backup-actions [data-action="backup"]'));
    assert.match(importButton().textContent, /导入 CSV/);
    assert.equal(document.querySelector('[data-action="csv"]'), null);
    const picker = document.querySelector('#import-csv-file');
    assert.match(picker.accept, /\.csv/);
    let opened = false;
    picker.click = () => { opened = true; };
    importButton().click();
    assert.equal(opened, true);

    choose('wrong.txt', 'test');
    assert.equal(document.querySelector('#import-status').textContent, '请选择 CSV 文件');
    choose('broken.csv', '车次\n"G103');
    await waitFor(() => document.querySelector('#import-status')?.textContent.includes('引号不完整'));
    assert.equal(server.records().length, 0);

    choose('tickets.CSV', [
      '交通方式,车次,出发站,到达站,日期,旅客',
      '火车,G103,北京南,上海虹桥,2026-11-16,示例旅客',
      '飞机,CA181,PEK,HND,2026-11-17,EXAMPLE/TRAVELER',
    ].join('\n'));
    await waitFor(() => document.querySelectorAll('.candidate-select').length === 2);
    assert.equal(server.records().length, 0);
    document.querySelector('.candidate-select[data-index="1"]').click();
    document.querySelector('[data-action="save-candidates"]').click();
    await waitFor(() => server.records().length === 1 && document.querySelector('h1')?.textContent === '我的票据');
    assert.equal(server.records()[0].service, 'G103');
    document.querySelector('[data-action="navigate"][data-page="data"]').click();
    await waitFor(() => importButton()?.disabled === false);
    window.dispatchEvent(new window.Event('offline'));
    assert.equal(importButton().disabled, true);
    assert.equal(document.querySelector('[data-action="backup"]').disabled, false);
  } finally {
    window.dispatchEvent(new window.Event('offline'));
    dom.window.close();
  }
});
