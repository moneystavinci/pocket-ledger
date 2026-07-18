// Pocket Ledger service worker
// Caches the static app shell so the app opens and works offline once
// installed. All actual data stays in IndexedDB (unaffected by this cache).

const CACHE_NAME = "pocket-ledger-shell-v2";
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

// Network-first, falling back to cache, and always resolving to a real
// Response — never `undefined` — since respondWith(undefined) is exactly
// what produces Chrome's ERR_FAILED. A network hiccup on a fresh install
// (nothing cached yet) previously fell through to nothing at all.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      try {
        const networkResponse = await fetch(event.request);
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          event.request.url.startsWith(self.location.origin)
        ) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkResponse.clone());
        }
        return networkResponse;
      } catch (err) {
        const cached = await caches.match(event.request);
        if (cached) return cached;

        // Navigations (opening the app itself) get the cached app shell as
        // a last resort so the app still opens offline instead of failing.
        if (event.request.mode === "navigate") {
          const shell = await caches.match("./index.html");
          if (shell) return shell;
        }

        // Absolute last resort: a real Response object, never undefined.
        return new Response(
          "Pocket Ledger is offline and this resource isn't cached yet.",
          { status: 503, statusText: "Service Unavailable", headers: { "Content-Type": "text/plain" } }
        );
      }
    })()
  );
});
