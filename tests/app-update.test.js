import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { watchAppUpdates } from '../src/app-update.js';

function browser(t, options = {}) {
  const dom = new JSDOM('<meta name="xingji-build" content="10" /><script type="module" src="./src/app-OLD.js"></script><input value="未保存的编辑" />', { url: 'https://example.com/Xingji/', pretendToBeVisual: true });
  const { window } = dom, worker = new window.EventTarget(), requests = [];
  let updates = 0;
  worker.controller = { postMessage: message => requests.push(message) };
  worker.register = async (path, settings) => {
    assert.equal(path, './sw.js'); assert.equal(settings.updateViaCache, 'none');
    return { update: async () => { updates++; } };
  };
  Object.defineProperty(window.navigator, 'serviceWorker', { value: worker });
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location })) Object.defineProperty(globalThis, key, { value, configurable: true });
  const cleanup = watchAppUpdates(options);
  t.after(() => { cleanup(); window.close(); });
  return {
    window, worker, requests, updates: () => updates,
    message(appUrl, source = worker.controller, builtAt = 20) {
      const event = new window.Event('message');
      Object.assign(event, { source, data: { type: 'XINGJI_APP_VERSION', appUrl, builtAt } }); worker.dispatchEvent(event);
    }
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('first installation and the current shell do not offer a redundant update', async t => {
  const app = browser(t);
  await tick();
  assert.deepEqual(app.requests, [{ type: 'XINGJI_CHECK_APP_VERSION' }]);
  app.message('https://example.com/Xingji/src/app-OLD.js');
  app.worker.dispatchEvent(new app.window.Event('controllerchange'));
  app.message('https://example.com/Xingji/src/app-OLD.js');
  assert.equal(document.querySelector('.app-update'), null);
});

test('a new worker offers one explicit refresh and preserves unfinished edits', async t => {
  let dirty = true, reloads = 0, warning = '';
  const app = browser(t, { canReload: () => dirty ? '请先保存编辑' : true, reload: () => reloads++, notify: message => { warning = message; } });
  await tick();
  app.message('https://example.com/Xingji/src/app-NEW.js', {});
  app.message('https://untrusted.example/src/app-NEW.js');
  app.message('invalid-url');
  assert.equal(document.querySelector('.app-update'), null);
  app.worker.dispatchEvent(new app.window.Event('controllerchange'));
  app.message('https://example.com/Xingji/src/app-NEW.js');
  app.message('https://example.com/Xingji/src/app-NEW.js');
  assert.equal(document.querySelectorAll('.app-update').length, 1);
  assert.equal(reloads, 0);
  document.querySelector('.app-update button').click();
  assert.equal(warning, '请先保存编辑'); assert.equal(reloads, 0);
  assert.equal(document.querySelector('input').value, '未保存的编辑');
  dirty = false; document.querySelector('.app-update button').click(); assert.equal(reloads, 1);
});

test('an older worker cannot offer a rollback and a current worker clears a stale notice', async t => {
  const app = browser(t);
  await tick();
  app.message('https://example.com/Xingji/src/app-EARLIER.js', app.worker.controller, 9);
  app.message('https://example.com/Xingji/src/app-NO-BUILD.js', app.worker.controller, null);
  assert.equal(document.querySelector('.app-update'), null);
  app.message('https://example.com/Xingji/src/app-NEW.js');
  assert.ok(document.querySelector('.app-update'));
  app.message('https://example.com/Xingji/src/app-OLD.js', app.worker.controller, 30);
  assert.equal(document.querySelector('.app-update'), null);
});

test('returning to a mobile page checks for updates, with throttling and offline protection', async t => {
  const originalNow = Date.now; let time = originalNow(); Date.now = () => time;
  t.after(() => { Date.now = originalNow; });
  const app = browser(t); await tick();
  app.window.dispatchEvent(new app.window.Event('focus')); await tick(); assert.equal(app.updates(), 0);
  time += 61000;
  document.dispatchEvent(new app.window.Event('visibilitychange'));
  app.window.dispatchEvent(new app.window.Event('focus')); await tick(); assert.equal(app.updates(), 1);
  time += 61000; Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  app.window.dispatchEvent(new app.window.Event('focus')); await tick(); assert.equal(app.updates(), 1);
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  app.window.dispatchEvent(new app.window.Event('online')); await tick(); assert.equal(app.updates(), 2);
});
