// Underworld Engine Service Worker: built for pubs with bad internet.
//
// HTML (navigations, '/', '/index.html', /admin, /screen): NETWORK-FIRST with a short timeout, falling back to the
//   cached copy when the network is slow or offline. A deploy therefore reaches every online phone and the admin
//   page on the next load; the old page is only ever used when there is no network at all.
// /assets/* (Vite output, file names contain a content hash): CACHE-FIRST. A hash never changes its content, so a
//   cached file is always correct for the HTML that references it.
// Everything else (manifest, icons, fonts): stale-while-revalidate, as before.
// API, health, config and the projector feed are never touched.
//
// Why a cached old index.html cannot point at missing assets: whenever a fresh index.html is stored, the hashed files
// it references are fetched into the cache too, and every asset an old page loads is cached the first time it loads.
// A new deploy's index.html is only ever served from the network, together with network-fetched assets.
//
// Bump CACHE_NAME to drop every older cache on the next activate.
const CACHE_NAME = 'underworld-cache-v3';
const HTML_KEY = '/index.html';
const NAV_TIMEOUT_MS = 3500;

// Only small static files are precached. HTML is never precached, so install cannot freeze an old page.
const STATIC_ASSETS = ['/manifest.json', '/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {}));
  self.skipWaiting();
});

// Activate: drop every cache that is not the current one, then take over open pages.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => (key !== CACHE_NAME ? caches.delete(key) : undefined))))
      .then(() => self.clients.claim())
  );
});

function isHtmlRequest(request, url) {
  if (request.mode === 'navigate') return true;
  if (url.pathname === '/' || url.pathname === '/index.html') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

// Fetch the hashed files an index.html references so they are available offline together with that HTML.
async function warmAssets(cache, html) {
  const urls = new Set(html.match(/\/assets\/[A-Za-z0-9._-]+/g) || []);
  await Promise.all(
    [...urls].map(async (u) => {
      if (await cache.match(u)) return;
      try {
        const res = await fetch(u);
        if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) await cache.put(u, res);
      } catch {
        /* best effort */
      }
    })
  );
}

async function storeHtml(response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const copy = response.clone();
    const text = await response.clone().text();
    await cache.put(HTML_KEY, copy);
    await warmAssets(cache, text);
  } catch {
    /* storing is best effort */
  }
}

async function htmlNetworkFirst(event) {
  const cache = await caches.open(CACHE_NAME);
  const net = fetch(event.request).then((res) => {
    if (res && res.ok && res.type === 'basic' && (res.headers.get('content-type') || '').includes('text/html')) {
      event.waitUntil(storeHtml(res.clone()));
    }
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NAV_TIMEOUT_MS));
  const first = await Promise.race([net.catch(() => null), timeout]);
  if (first && first.ok) return first;
  const cached = (await cache.match(HTML_KEY)) || (await cache.match('/'));
  if (cached) {
    // Slow or failing network: show the cached page now; the request keeps running and refreshes the cache.
    event.waitUntil(net.catch(() => {}));
    return cached;
  }
  if (first) return first;
  return net; // nothing cached: wait for the network (the browser shows its own error if it fails)
}

async function assetCacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok && res.type === 'basic' && !(res.headers.get('content-type') || '').includes('text/html')) {
    cache.put(request, res.clone());
  }
  return res;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The game API (views, streams, commands), health, config and the projector feed always go to the network untouched.
  if (url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname === '/config.json' || url.pathname === '/screen-view') {
    return;
  }

  if (isHtmlRequest(request, url)) {
    event.respondWith(htmlNetworkFirst(event));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(assetCacheFirst(request));
    return;
  }

  // Everything else: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const refresh = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse || Response.error());
      return cachedResponse || refresh;
    })
  );
});
