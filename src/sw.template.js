const CACHE = 'xingji-__VERSION__';
const SHELL = __SHELL__;
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('xingji-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', event => {
  if (event.data?.type !== 'XINGJI_CHECK_APP_VERSION') return;
  const app = SHELL.find(path => /^\.\/src\/app-[^/]+\.js$/.test(path));
  if (app) event.source?.postMessage({ type: 'XINGJI_APP_VERSION', appUrl: new URL(app, self.location.href).href });
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || event.request.headers.has('Authorization')) return;
  const navigation = event.request.mode === 'navigate';
  const cached = async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(event.request) || (navigation ? cache.match(new URL('./index.html', self.location.href)) : undefined);
  };
  const network = async () => {
    const response = await fetch(event.request, navigation ? { cache: 'no-store' } : undefined);
    if (response.ok) {
      try { await (await caches.open(CACHE)).put(event.request, response.clone()); } catch {}
    }
    return response;
  };
  // Refresh app HTML online; content-hashed assets remain available offline.
  event.respondWith(navigation ? network().catch(cached) : cached().then(hit => hit || network()));
});
