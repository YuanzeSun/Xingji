import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { archive, createRecord } from '../src/model.js';
import { signOutCloud } from '../src/sync-state.js';
import { prepareCloud } from './helpers/cloud.js';
import { browser, until } from './helpers/d1-app.js';

test('imports stay with their archive and original image, and never replace an unrelated editor', async t => {
  const window = browser();
  location.hash = 'import';
  let channel;
  window.BroadcastChannel = class extends window.EventTarget {
    constructor() { super(); channel = this; }
    postMessage() {}
  };
  const github = await prepareCloud();
  const records = [
    createRecord({ id: 'flight', service: 'G21', origin: '原票据出发站' }),
    createRecord({ id: 'train', service: 'G23', destination: '原票据到达站' })
  ];
  const json = JSON.stringify(archive(records));
  let read, finish;
  const click = selector => document.querySelector(selector).click();
  const go = page => click('[data-page="' + page + '"]');
  const pick = file => {
    const input = document.querySelector('#import-files');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  async function deferredFile() {
    const reading = new Promise(resolve => { read = resolve; });
    const contents = new Promise(resolve => { finish = resolve; });
    pick({ name: 'records.json', size: json.length, text() { read(); return contents; } });
    await reading;
  }
  const ocrURL = new URL('../src/ocr.js', import.meta.url).href;
  const hook = registerHooks({
    load(url, context, next) {
      if (url !== ocrURL) return next(url, context);
      return {
        format: 'module', shortCircuit: true,
        source: 'export async function recognize(file) { return { text: "车次：" + (file.name === "first.png" ? "G103" : "G107") + "\\n出发站：北京南\\n到达站：上海虹桥\\n日期：2025-05-03\\n旅客姓名：测试旅客" }; }'
      };
    }
  });
  t.mock.method(URL, 'createObjectURL', blob => 'blob:fixture-' + blob.name);
  const revoke = t.mock.method(URL, 'revokeObjectURL', () => {});
  try {
    await import('../src/app.js');
    await until(() => document.querySelector('#import-files'));

    pick(new window.File(['one'], 'first.png', { type: 'image/png' }));
    await until(() => document.querySelector('.scan-reference img'));
    assert.equal(document.querySelector('.scan-reference img').getAttribute('src'), 'blob:fixture-first.png');
    click('dialog [data-action="close-modal"]');
    await until(() => !document.querySelector('dialog'));

    pick(new window.File(['two'], 'second.png', { type: 'image/png' }));
    await until(() => document.querySelectorAll('.review-row').length === 2);
    click('[data-action="edit-candidate"][data-index="0"]');
    await until(() => document.querySelector('.scan-reference img'));
    assert.equal(document.querySelector('.scan-reference img').getAttribute('src'), 'blob:fixture-first.png');
    click('dialog [data-action="close-modal"]');
    await until(() => !document.querySelector('dialog'));
    click('[data-action="review"]');
    await until(() => document.querySelector('[data-action="edit-candidate"][data-index="1"]'));
    click('[data-action="edit-candidate"][data-index="1"]');
    await until(() => document.querySelector('.scan-reference img'));
    assert.equal(document.querySelector('.scan-reference img').getAttribute('src'), 'blob:fixture-second.png');
    click('dialog [data-action="close-modal"]');
    await until(() => !document.querySelector('dialog'));
    assert.ok(revoke.mock.calls.some(call => call.arguments[0] === 'blob:fixture-first.png'));

    await deferredFile();
    go('archive');
    await until(() => document.querySelector('[data-action="new"]'));
    click('[data-action="new"]');
    await until(() => document.querySelector('#editor-form'));
    const service = document.querySelector('#editor-form [name=service]');
    service.value = 'G801';
    service.dispatchEvent(new window.Event('input', { bubbles: true }));
    finish(json);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('#editor-form [name=service]').value, 'G801');
    globalThis.confirm = () => true;
    click('dialog [data-action="close-modal"]');
    go('import');
    await until(() => document.querySelector('[data-action="review"]')?.textContent.includes('4'));
    click('[data-action="review"]');
    await until(() => document.querySelectorAll('.review-row').length === 4);
    click('[data-action="discard-candidates"]');
    await until(() => !document.querySelector('dialog'));

    await deferredFile();
    const demo = document.querySelector('#demo-toggle');
    demo.checked = true;
    demo.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => !document.querySelector('[data-page="import"]'));
    finish(json);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('dialog'), null);
    assert.doesNotMatch(document.body.textContent, /原票据出发站/);
    click('[data-action="exit-demo"]');
    await until(() => document.querySelector('[data-page="import"]'));
    go('import');
    await until(() => document.querySelector('[data-action="review"]')?.textContent.includes('2'));

    await deferredFile();
    await signOutCloud();
    channel.dispatchEvent(new window.MessageEvent('message', { data: { clearView: true } }));
    await until(() => document.querySelector('.cloud-setup'));
    finish(json);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('dialog'), null);
    assert.doesNotMatch(document.body.textContent, /原票据出发站/);
    assert.deepEqual(github.records(), []);
  } finally {
    hook.deregister();
    window.close();
  }
});
