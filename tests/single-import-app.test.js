import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCloud } from './helpers/cloud.js';
import { applyImport, createRecord } from '../src/model.js';
import { normalizeRailInvoice, parseRailInvoicePage } from '../src/rail-invoice.js';
import { browser, until } from './helpers/d1-app.js';
import { pickReceipt, stubReceiptPDF, receiptBytes, receiptPage } from './helpers/receipt-pdf.js';

test('ticket entry is in the archive and rail receipts accept one PDF journey per review', async () => {
  const window = browser();
  location.hash = 'import';
  const github = await prepareCloud();
  const pdf = stubReceiptPDF();
  const makeFile = (...pages) => ({ name: '发票.PDF', size: 100, arrayBuffer: async () => receiptBytes(...pages) });
  const status = () => document.querySelector('[data-rail-receipt-status]').textContent;
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
    pickReceipt(window, makeFile(receiptPage(), receiptPage({ service: 'G33' })));
    await until(() => status().includes('多段行程'));
    assert.equal(document.querySelector('[name="service"]').value, '');
    assert.deepEqual(github.records(), []);

    fill('passenger', '手动姓名');
    pickReceipt(window, makeFile(receiptPage({ service: 'D21', seat: '06车009号下铺', seatClass: '动卧' })));
    await until(() => status().includes('已填入'));
    const form = document.querySelector('#editor-form');
    assert.equal(form.elements.service.value, 'D21');
    assert.equal(form.elements.origin.value, '北京南');
    assert.equal(form.elements.passenger.value, '手动姓名');
    assert.equal(form.elements.carriage.value, '06');
    assert.equal(form.elements.seat.value, '009号下铺');
    assert.equal(form.elements.seatClass.value, '动卧');
    assert.equal(form.elements.price.value, '503.50');
    assert.equal(form.elements.ticketNumber.value, '');
    assert.equal(form.elements.identity.required, false);
    assert.equal(form.elements.identity.value, '');
    assert.doesNotMatch(form.textContent, /1101012000\*{4}0012/);
    assert.equal(form.querySelector('[data-field-source="service"]').dataset.sourceKind, 'pdf');
    assert.match(form.textContent, /电子报销凭证资料.*示例单位/s);
    assert.deepEqual(github.records(), []);
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => github.records().length === 1);
    const [saved] = github.records();
    assert.deepEqual(saved.railInvoice, {
      electronicTicketNumber: '2600000000000000000000001',
      buyerName: '示例单位', buyerTaxId: '100000000000000001'
    });
    assert.equal(saved.identity, '');
    assert.equal(saved.ticketCode, '');
    assert.doesNotMatch(JSON.stringify(saved), /26000000000000000001(?!\d)|2026-06-01|1101012000\*{4}0012/);

    const printed = createRecord({ ...saved, id: 'printed-ticket', ticketNumber: 'A000001', railInvoice: undefined });
    const { records: merged } = applyImport([printed], [saved]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].ticketNumber, 'A000001');
    assert.deepEqual(merged[0].railInvoice, saved.railInvoice);
  } finally {
    pdf.deregister();
    window.close();
  }
});

test('rail invoices discard masked values before preview and storage', () => {
  const page = receiptPage({ passenger: '示例＊' });
  page.items.find(item => item.str === '示例单位').str = '示例＊＊';
  page.items.find(item => item.str === '100000000000000001').str = '100000********0001';
  const parsed = parseRailInvoicePage(page);
  assert.equal(parsed.passenger, '');
  assert.equal(parsed.identity, '');
  const expected = { electronicTicketNumber: '2600000000000000000000001', buyerName: '', buyerTaxId: '' };
  assert.deepEqual(parsed.railInvoice, expected);
  assert.deepEqual(normalizeRailInvoice({ ...parsed.railInvoice, maskedIdentity: '1101012000****0012' }), expected);
});
