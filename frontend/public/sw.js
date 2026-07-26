// Umbra PWA service worker.
//
// Deliberately minimal: it exists so the dashboard is INSTALLABLE (a service
// worker is required for the browser install prompt), but it caches NOTHING and
// intercepts NOTHING. Every request — HTML, static assets, and especially /api —
// goes straight to the network, exactly as it would with no service worker at
// all. This guarantees a page or a governed response (receipts, passports,
// scores) can never be served stale: there is no cache to go stale.
//
// (An earlier version cached the static shell; that was removed to eliminate any
// possibility of a returning visitor seeing a pre-deploy page. Installability is
// preserved; freshness is absolute.)
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Claim clients and proactively drop any cache a previous SW version created,
  // so an upgrade from the old caching worker clears itself on first activation.
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// No 'fetch' handler → the browser handles every request normally (network).
