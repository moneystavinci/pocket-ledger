// Pocket Ledger service worker
//
// Goal: the app shell (index.html + everything it needs to render and let
// you enter data) must load with ZERO network dependency, every time,
// instantly. All actual ledger data lives in IndexedDB — untouched by this
// file and already fully offline-capable on its own. This worker's only job
// is making sure the *page itself* is available offline too.
//
// Strategy: cache-first for the app shell. We don't wait on a network
// round-trip before deciding whether to serve the cached copy — that would
// mean a slow or flaky connection (weak signal, captive portal, airplane
// mode toggling) delays or blocks opening the app. Instead: serve from
// cache immediately if present, and separately refresh the cache in the
// background from the network when available, so the next offline launch
// always has the most recent successfully-fetched version.

const CACHE_NAME = "pocket-ledger-shell-v3";
const APP_SHELL = [
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const isSameOrigin = event.request.url.startsWith(self.location.origin);

  event.respondWith(
    (async () => {
      // Cache-first for anything we own (the app shell). This is what makes
      // the app open instantly offline, with no network wait at all.
      const cached = await caches.match(event.request);
      if (cached) {
        // Refresh the cache in the background for next time, but don't make
        // this request wait on it — the person already has their answer.
        if (isSameOrigin) {
          fetch(event.request)
            .then((response) => {
              if (response && response.status === 200) {
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response));
              }
            })
            .catch(() => { /* offline — nothing to refresh with, that's fine */ });
        }
        return cached;
      }

      // Not cached yet — try the network (e.g. Google Fonts, the AdSense
      // script, or a first-ever visit to a new page in this app).
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200 && isSameOrigin) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        // Truly nothing available. For navigations (opening the app itself)
        // fall back to the cached shell so the app still opens rather than
        // showing a browser error page.
        if (event.request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }
        // Absolute last resort: always a real Response, never undefined —
        // handing back nothing is exactly what produces a browser ERR_FAILED.
        return new Response(
          "Offline and this resource isn't cached yet.",
          { status: 503, statusText: "Service Unavailable", headers: { "Content-Type": "text/plain" } }
        );
      }
    })()
  );
});
