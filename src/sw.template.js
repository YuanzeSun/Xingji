const CACHE = 'xingji-__VERSION__';
const BUILT_AT = __BUILT_AT__;
const SHELL_PAGE = new URL(__SHELL_PAGE__, self.location.href);
const APP_URL = new URL(__APP_ENTRY__, self.location.href).href;
const APP_ROOT = new URL('./', self.location.href).pathname;
const SHELL = __SHELL__;
const OCR_CACHE = 'xingji-ocr-__OCR_VERSION__';
const OCR_PATHS = new Set(__OCR_FILES__.map(path => new URL(path, self.location.href).pathname));
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('xingji-') && k !== CACHE && k !== OCR_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', event => {
  if (event.data?.type !== 'XINGJI_CHECK_APP_VERSION') return;
  event.source?.postMessage({ type: 'XINGJI_APP_VERSION', appUrl: APP_URL, builtAt: BUILT_AT });
});
async function loadHome(request) {
  const saved = async () => (await caches.open(CACHE)).match(SHELL_PAGE);
  let response;
  try {
    response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      const html = await response.clone().text();
      const build = html.match(/<meta name="xingji-build" content="(\d+)"\s*\/?>/);
      if (Number(build?.[1]) >= BUILT_AT) return response;
    }
  } catch (error) {
    const fallback = await saved();
    if (fallback) return fallback;
    throw error;
  }
  // CDN edges can return an earlier index.html after the new worker has installed.
  return await saved() || response;
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || event.request.headers.has('Authorization')) return;
  const navigation = event.request.mode === 'navigate';
  if (navigation && (url.pathname === APP_ROOT || url.pathname === APP_ROOT + 'index.html')) {
    event.respondWith(loadHome(event.request));
    return;
  }
  const cacheName = !navigation && OCR_PATHS.has(url.pathname) ? OCR_CACHE : CACHE;
  const cached = async () => {
    const cache = await caches.open(cacheName);
    return await cache.match(event.request) || (navigation ? cache.match(SHELL_PAGE) : undefined);
  };
  const network = async () => {
    const response = await fetch(event.request, navigation ? { cache: 'no-store' } : undefined);
    if (response.ok) {
      try { await (await caches.open(cacheName)).put(event.request, response.clone()); } catch {}
    }
    return response;
  };
  event.respondWith(navigation ? network().catch(cached) : cached().then(hit => hit || network()));
});
