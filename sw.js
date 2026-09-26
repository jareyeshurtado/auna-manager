// Bump this when the list of files below changes; old caches are deleted on activate.
const CACHE_NAME = 'auna-cache-v2';

// The admin app shell, so it opens instantly (and offline) on the doctor's phone.
const APP_SHELL = [
    './admin.html',
    './admin.js',
    './style.css',
    './texts.json',
    './manifest.json',
    './icon-192.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// Network first, cache fallback — ONLY for this site's own static files.
// Firestore, Firebase Auth and CDN requests go straight to the network: Firestore keeps
// long-lived streaming connections open, and copying those into the cache made memory grow.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    event.respondWith(
        fetch(request)
            .then((response) => {
                if (response.ok && response.type === 'basic') {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                }
                return response;
            })
            .catch(() => caches.match(request, { ignoreSearch: true }))
    );
});
