const CACHE_PREFIX = 'badminton-manager-';
const APP_CACHE = `${CACHE_PREFIX}app-v6`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-v6`;

const APP_SHELL = [
    './',
    './index.html',
    './manifest.webmanifest',
    './assets/icons/apple-touch-icon.png',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(APP_CACHE)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key.startsWith(CACHE_PREFIX) && key !== APP_CACHE && key !== RUNTIME_CACHE)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then(async response => {
                    if (response.ok) {
                        const cache = await caches.open(RUNTIME_CACHE);
                        await cache.put(request, response.clone());
                    }
                    return response;
                })
                .catch(async () => (
                    await caches.match(request) ||
                    await caches.match('./index.html') ||
                    new Response('오프라인 상태이며 저장된 화면을 찾을 수 없습니다.', {
                        status: 503,
                        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
                    })
                ))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(cachedResponse => {
            const networkResponse = fetch(request)
                .then(async response => {
                    if (response.ok || response.type === 'opaque') {
                        const cache = await caches.open(RUNTIME_CACHE);
                        await cache.put(request, response.clone());
                    }
                    return response;
                })
                .catch(error => {
                    if (cachedResponse) return cachedResponse;
                    throw error;
                });

            return cachedResponse || networkResponse;
        })
    );
});
