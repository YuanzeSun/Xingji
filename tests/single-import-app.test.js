import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCloud } from './helpers/cloud.js';
import { browser, until } from './helpers/d1-app.js';
import { pickReceipt, stubReceiptPDF } from './helpers/receipt-pdf.js';

test('ticket entry is in the archive and rail receipts accept one PDF journey per review', async () => {
  const window = browser();
  location.hash = 'import';
  const github = await prepareCloud();
  const pdf = stubReceiptPDF();
  const makeFile = (text, name = '发票.PDF') => ({
    name, size: 100, arrayBuffer: async () => new TextEncoder().encode(text).buffer
  });
  const status = () => document.querySelector('[data-rail-receipt-status]').textContent;
  const journey = '车次：G21\n出发站：北京南\n到达站：南京南\n日期：2024-10-01\n时间：08:00\n座位：08F';
  const fill = (key, value) => {
    const field = document.querySelector('#editor-form').elements[key];
    field.value = value;
    field.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('.page-header [data-action="new"]:not(:disabled)'));
    assert.equal(location.hash, '#archive');
    assert.equal(document.querySelector('nav [data-page="import"], #import-files, #import-text'), null);
    document.querySelector('.page-header [data-action="new"]').click();
    await until(() => document.querySelector('#editor-form'));
    fill('type', 'flight');
    assert.equal(document.querySelector('[data-rail-receipt-file], #import-text, [data-ticket-clipboard]'), null);
    fill('type', 'rail');
    assert.equal(document.querySelector('[data-code-editor]').nextElementSibling, document.querySelector('[data-rail-receipt-entry]'));
    assert.equal(document.querySelector('[data-rail-receipt-entry]').nextElementSibling, document.querySelector('[data-rail-photo-entry]'));
    assert.equal(document.querySelector('[data-rail-receipt-file]').accept, '.pdf,application/pdf');
    assert.equal(document.querySelector('[data-rail-receipt]').textContent, '识别电子报销凭证录入');

    for (const name of ['发票.json', '发票.txt', '发票.eml']) {
      pickReceipt(window, { name, arrayBuffer() { assert.fail('Only PDFs should be read'); } });
      assert.match(status(), /PDF 格式/);
    }
    pickReceipt(window, makeFile(journey + '\f车次：G33\n出发站：南京南\n到达站：上海虹桥\n日期：2024-10-02'));
    await until(() => status().includes('多段行程'));
    assert.equal(document.querySelector('[name="service"]').value, '');
    assert.deepEqual(github.records(), []);

    fill('passenger', '手动姓名');
    pickReceipt(window, makeFile(journey + '\n旅客姓名：发票姓名'));
    await until(() => status().includes('已填入'));
    const form = document.querySelector('#editor-form');
    assert.equal(form.elements.service.value, 'G21');
    assert.equal(form.elements.origin.value, '北京南');
    assert.equal(form.elements.passenger.value, '手动姓名');
    assert.equal(form.querySelector('[data-field-source="service"]').dataset.sourceKind, 'pdf');
    assert.deepEqual(github.records(), []);
  } finally {
    pdf.deregister();
    window.close();
  }
});
