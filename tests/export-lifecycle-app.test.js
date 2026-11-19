import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createRecord } from '../src/model.js';
import { signOutCloud } from '../src/sync-state.js';
import { prepareCloud } from './helpers/cloud.js';
import { browser, until } from './helpers/d1-app.js';

test('a delayed export cannot reopen a private dialog or deliver private data after switching views', async t => {
  const window = browser();
  location.hash = 'archive';
  let channel, releaseModule, deliver, loading = false;
  window.BroadcastChannel = class extends window.EventTarget {
    constructor() { super(); channel = this; }
    postMessage() {}
  };
  globalThis.exportModuleGate = new Promise(resolve => { releaseModule = resolve; });
  globalThis.deliverExport = callback => { deliver = callback; };
  const url = new URL('../src/export-dialog.js', import.meta.url).href;
  const hook = registerHooks({
    load(href, context, next) {
      if (href !== url) return next(href, context);
      loading = true;
      return {
        format: 'module', shortCircuit: true,
        source: 'await globalThis.exportModuleGate; export function exportDialog() { return ""; } export function bindExportDialog(_,records,{download}) { globalThis.deliverExport(() => download(new Blob([records[0].origin]), "private.pdf")); return () => {}; }'
      };
    }
  });
  const objectURL = t.mock.method(URL, 'createObjectURL', () => 'blob:fixture');
  const click = selector => document.querySelector(selector).click();
  try {
    await prepareCloud([createRecord({ id: 'export-test', origin: '测试出发地', destination: '测试到达地' })]);
    await import('../src/app.js');
    await until(() => document.querySelector('[data-archive-select]'));
    click('[data-archive-select]');
    click('[data-action="export-album"]');
    await until(() => loading);
    const demo = document.querySelector('#demo-toggle');
    demo.checked = true;
    demo.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => document.querySelector('[data-action="exit-demo"]'));
    releaseModule();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('dialog'), null);

    click('[data-action="exit-demo"]');
    await until(() => document.querySelector('[data-archive-select="export-test"]'));
    click('[data-archive-select="export-test"]');
    click('[data-action="export-album"]');
    await until(() => deliver);
    await signOutCloud();
    channel.dispatchEvent(new window.MessageEvent('message', { data: { clearView: true } }));
    await until(() => document.querySelector('.cloud-setup'));
    assert.equal(await deliver(), false);
    assert.equal(document.querySelector('dialog'), null);
    assert.equal(objectURL.mock.callCount(), 0);
  } finally { hook.deregister(); window.close(); }
});
