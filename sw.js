const CACHE_NAME = 'auna-cache-v1';

// The essential files to save to the phone's memory
const urlsToCache = [
    './',
    './admin.html',
    './admin.js',
    // Add './style.css' here if you have a separate CSS file!
];

// 1. Install the Service Worker and save the files
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('Opened cache');
            return cache.addAll(urlsToCache);
        })
    );
});

// 2. The "Network First, Cache Fallback" Strategy
self.addEventListener('fetch', event => {
    // Only intercept standard GET requests (ignore Firebase database syncing)
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                // If the network is fast and works, save a fresh copy to the cache!
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // If the mobile data stalls or drops, instantly load from the phone's memory!
                return caches.match(event.request);
            })
    );
});