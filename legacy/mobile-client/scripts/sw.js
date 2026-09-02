const OFFLINE_URL = '/server-down.html';

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open('crane-offline-v1').then(cache => cache.add(OFFLINE_URL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', e => {
    // Только навигационные запросы (переход на страницу)
    if (e.request.mode !== 'navigate') return;

    e.respondWith(
        fetch(e.request).catch(() =>
            caches.match(OFFLINE_URL)
        )
    );
});
