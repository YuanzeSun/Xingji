import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { signOutCloud } from '../src/sync-state.js';
import { prepareCloud } from './helpers/cloud.js';
import { browser, until } from './helpers/d1-app.js';
import { pickReceipt, stubReceiptPDF } from './helpers/receipt-pdf.js';

test('photo references and pending receipts stay with their ticket editor', async t => {
  const window = browser();
  location.hash = 'archive';
  globalThis.confirm = () => true;
  let channel;
  window.BroadcastChannel = class extends window.EventTarget {
    constructor() { super(); channel = this; }
    postMessage() {}
  };
  const github = await prepareCloud();
  const text = '车次：G21\n出发站：北京南\n到达站：南京南\n日期：2025-05-03';
  let finish;
  const click = selector => document.querySelector(selector).click();
  const form = () => document.querySelector('#editor-form');
  async function deferredFile() {
    let reading = false;
    const contents = new Promise(resolve => { finish = () => resolve(new TextEncoder().encode(text).buffer); });
    pickReceipt(window, { name: 'receipt.pdf', size: 100, arrayBuffer() { reading = true; return contents; } });
    await until(() => reading);
  }
  const pdf = stubReceiptPDF();
  const ocrURL = new URL('../src/ocr.js', import.meta.url).href;
  const ocr = registerHooks({
    load(url, context, next) {
      if (url !== ocrURL) return next(url, context);
      return { format: 'module', shortCircuit: true, source: 'export async function recognize() { return { text: ' + JSON.stringify(text) + ' }; }' };
    }
  });
  t.mock.method(URL, 'createObjectURL', blob => 'blob:fixture-' + blob.name);
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('[data-action="new"]:not(:disabled)'));
    for (const name of ['first.png', 'second.png']) {
      click('[data-action="new"]');
      await until(form);
      const picker = form().querySelector('[data-rail-photo-file]');
      Object.defineProperty(picker, 'files', { value: [new window.File(['photo'], name, { type: 'image/png' })] });
      picker.dispatchEvent(new window.Event('change', { bubbles: true }));
      await until(() => document.querySelector('.scan-reference img'));
      assert.equal(document.querySelector('.scan-reference img').getAttribute('src'), 'blob:fixture-' + name);
      click('dialog [data-action="close-modal"]');
      await until(() => !form());
      assert.equal(form(), null);
      assert.ok(revoke.mock.calls.some(call => call.arguments[0] === 'blob:fixture-' + name));
    }

    click('[data-action="new"]');
    await until(form);
    await deferredFile();
    click('dialog [data-action="close-modal"]');
    await until(() => !form());
    click('[data-action="new"]');
    await until(form);
    const service = form().elements.service;
    service.value = 'G801';
    service.dispatchEvent(new window.Event('input', { bubbles: true }));
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(form().elements.service.value, 'G801');

    await deferredFile();
    await signOutCloud();
    channel.dispatchEvent(new window.MessageEvent('message', { data: { clearView: true } }));
    await until(() => document.querySelector('.cloud-setup'));
    finish();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('dialog'), null);
    assert.deepEqual(github.records(), []);
  } finally {
    ocr.deregister();
    pdf.deregister();
    window.close();
  }
});
