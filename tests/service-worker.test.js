import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const template = await readFile(new URL('../src/sw.template.js', import.meta.url), 'utf8');
const model = './ocr/paddle/model.tar';
const runtime = './vendor/paddle/index.mjs';
const script = (version, ocrVersion) => template.replace('__VERSION__', version)
  .replace('__SHELL__', '[]').replace('__OCR_VERSION__', ocrVersion)
  .replace('__OCR_FILES__', JSON.stringify([model, runtime]));
const source = script('test', 'models');

function worker({ offline = false, version = 'test', ocrVersion = 'models', storage = new Map(), response = 'latest-page' } = {}) {
  const base = 'https://example.com/archive/', listeners = {}, requests = [];
  const key = value => new URL(typeof value === 'string' || value instanceof URL ? value : value.url, base).href;
  const entriesFor = name => {
    if (!storage.has(name)) storage.set(name, new Map());
    return storage.get(name);
  };
  runInNewContext(script(version, ocrVersion), {
    URL,
    self: {
      location: new URL('sw.js', base), clients: { claim: async () => {} },
      addEventListener: (name, handler) => { listeners[name] = handler; }
    },
    caches: {
      keys: async () => [...storage.keys()],
      delete: async name => storage.delete(name),
      open: async name => {
        const entries = entriesFor(name);
        return {
          match: async request => entries.get(key(request))?.clone(),
          put: async (request, response) => entries.set(key(request), response.clone())
        };
      }
    },
    fetch: async (request, options) => {
      requests.push({ url: key(request), options });
      if (offline) throw new TypeError('Offline');
      return new Response(response);
    }
  });
  return {
    entries: entriesFor('xingji-' + version), requests, base,
    async activate() {
      let completion;
      listeners.activate({ waitUntil: value => { completion = value; } });
      await completion;
    },
    async load(path, mode = 'navigate', headers = {}) {
      let result;
      listeners.fetch({ request: { url: new URL(path, base).href, method: 'GET', mode, headers: new Headers(headers) }, respondWith: value => { result = value; } });
      return result;
    }
  };
}

test('online navigation replaces stale app HTML instead of keeping users on a broken release', async () => {
  const app = worker(); app.entries.set(app.base, new Response('outdated-page'));
  assert.equal(await (await app.load('./')).text(), 'latest-page');
  assert.equal(app.requests[0].options.cache, 'no-store');
  assert.equal(await app.entries.get(app.base).text(), 'latest-page');
});

test('the worker reports its entry URL so a suspended mobile page can detect an outdated client', () => {
  let handler, reply;
  runInNewContext(source.replace('const SHELL = [];', 'const SHELL = ["./src/app-NEW.js", "./src/chunks/other.js"];'), {
    URL, self: { location: new URL('https://example.com/Xingji/sw.js'), addEventListener: (name, fn) => { if (name === 'message') handler = fn; } }
  });
  const sender = { postMessage: message => { reply = message; } };
  handler({ data: { type: 'unrelated' }, source: sender }); assert.equal(reply, undefined);
  handler({ data: { type: 'XINGJI_CHECK_APP_VERSION' }, source: sender });
  assert.equal(reply.type, 'XINGJI_APP_VERSION'); assert.equal(reply.appUrl, 'https://example.com/Xingji/src/app-NEW.js');
});

test('offline navigation with a new query falls back to the precached app shell', async () => {
  const app = worker({ offline: true }); app.entries.set(app.base + 'index.html', new Response('offline-page'));
  assert.equal(await (await app.load('?update=login-fix')).text(), 'offline-page');
});

test('versioned assets use cached bytes and authenticated requests bypass app caching', async () => {
  const app = worker(); app.entries.set(app.base + 'src/app-123.js', new Response('cached-code'));
  assert.equal(await (await app.load('src/app-123.js', 'cors')).text(), 'cached-code');
  assert.equal(app.requests.length, 0);
  assert.equal(await app.load('private.json', 'cors', { Authorization: 'Bearer test-only' }), undefined);
});

test('app updates retain downloaded OCR models and runtime for offline reuse', async () => {
  const storage = new Map();
  const first = worker({ storage, version: 'page-a', response: 'ocr-bytes' });
  for (const asset of [model, runtime]) {
    assert.equal(await (await first.load(asset, 'cors')).text(), 'ocr-bytes');
    assert.equal(await (await first.load(asset, 'cors')).text(), 'ocr-bytes');
  }
  assert.equal(first.requests.length, 2);
  const updated = worker({ storage, version: 'page-b', offline: true });
  await updated.activate();
  assert.equal(storage.has('xingji-page-a'), false);
  assert.equal(storage.has('xingji-ocr-models'), true);
  for (const asset of [model, runtime]) {
    assert.equal(await (await updated.load(asset, 'cors')).text(), 'ocr-bytes');
  }
  assert.equal(updated.requests.length, 0);
});

test('an updated OCR fingerprint loads fresh bytes even when the model URL is unchanged', async () => {
  const storage = new Map();
  const first = worker({ storage, ocrVersion: 'old-model', response: 'old-bytes' });
  await first.load(model, 'cors');
  const updated = worker({ storage, ocrVersion: 'new-model', response: 'new-bytes' });
  await updated.activate();
  assert.equal(storage.has('xingji-ocr-old-model'), false);
  assert.equal(await (await updated.load(model, 'cors')).text(), 'new-bytes');
  assert.equal(await (await updated.load(model, 'cors')).text(), 'new-bytes');
  assert.equal(updated.requests.length, 1);
});
