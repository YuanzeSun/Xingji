import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = (await readFile(new URL('../src/sw.template.js', import.meta.url), 'utf8')).replace('__VERSION__', 'test').replace('__SHELL__', '[]');
function worker({ offline = false } = {}) {
  const base = 'https://example.com/archive/', listeners = {}, entries = new Map(), requests = [];
  const key = value => new URL(typeof value === 'string' || value instanceof URL ? value : value.url, base).href;
  const cache = {
    match: async request => entries.get(key(request))?.clone(),
    put: async (request, response) => entries.set(key(request), response.clone())
  };
  runInNewContext(source, {
    URL,
    self: { location: new URL('sw.js', base), addEventListener: (name, handler) => { listeners[name] = handler; } },
    caches: { open: async () => cache, match: cache.match },
    fetch: async (request, options) => {
      requests.push({ url: key(request), options });
      if (offline) throw new TypeError('Offline');
      return new Response('latest-page');
    }
  });
  return {
    entries, requests, base,
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
