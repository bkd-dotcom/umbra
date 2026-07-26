// Umbra PWA service worker.
//
// Deliberately conservative: it caches only the STATIC app shell so the
// dashboard is installable and loads offline-first. It NEVER caches API
// responses — governance data (passports, receipts, admissions) must always be
// fresh, and a stale cached authority/receipt would be dishonest. All /api/*
// and cross-origin requests go straight to the network.
const CACHE = "umbra-shell-v1";
const SHELL = ["/", "/start/", "/dashboard/", "/dashboard/overview/", "/icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never intercept API calls or cross-origin requests — always live.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;

  // Static shell: cache-first, revalidate in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
