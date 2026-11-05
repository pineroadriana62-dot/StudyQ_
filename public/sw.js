const CACHE_NAME = 'studyq-cache-v14';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    await Promise.all(STATIC_ASSETS.map(async (asset) => {
      try {
        const response = await fetch(asset, { cache: 'reload' });
        if (response.ok) await cache.put(asset, response.clone());
      } catch (_error) {
        // Se intenta nuevamente desde la estrategia Cache First.
      }
    }));

    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => new Response(JSON.stringify({
        authenticated: false,
        offline: true,
        error: 'Sin conexión a internet'
      }), {
        status: 200,
        statusText: 'OK - Modo sin conexión',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      }))
    );
    return;
  }

  if (event.request.method !== 'GET') return;

  const isStaticAsset = STATIC_ASSETS.includes(url.pathname);
  if (!isStaticAsset && event.request.mode !== 'navigate') return;

  event.respondWith((async () => {
    try {
      const networkResponse = await fetch(event.request);
      if (networkResponse && networkResponse.status === 200) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, networkResponse.clone());
      }
      return networkResponse;
    } catch (_error) {
      const cachedResponse = await caches.match(event.request);
      if (cachedResponse) return cachedResponse;
      if (event.request.mode === 'navigate') {
        const indexCache = await caches.match('/index.html');
        if (indexCache) return indexCache;
        return new Response('<!doctype html><html><head><meta charset="utf-8"><title>StudyQ</title></head><body><main><h1>StudyQ</h1><p>Estás sin conexión.</p></main></body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
      return new Response('', { status: 503, statusText: 'Sin conexión' });
    }
  })());
});