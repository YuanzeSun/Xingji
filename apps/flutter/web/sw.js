// The original website already registered this URL at the shared Pages scope.
// Let the Flutter preview load without the original website's offline worker.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.registration.unregister()));
