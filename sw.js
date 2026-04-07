// JA Agro Campo · Service Worker · v1.0.0
// Estratégia: Cache-First para assets, Network-First para API

const CACHE_NAME = 'ja-campo-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// INSTALL — cacheia assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ACTIVATE — remove caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// FETCH — cache-first para assets, network-first para API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Requisições de API: network-first, falha silenciosa
  if (url.pathname.includes('script.google.com') || url.searchParams.has('action')) {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Assets: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200 || response.type !== 'basic') return response;
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
        return response;
      }).catch(() => caches.match('/index.html')); // fallback offline
    })
  );
});

// BACKGROUND SYNC (quando disponível)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-movimentacoes') {
    event.waitUntil(syncPendentes());
  }
});

async function syncPendentes() {
  // Notifica o cliente para sincronizar
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_REQUEST' }));
}
