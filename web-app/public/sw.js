/* SmartRetailAI service worker (§6.8 offline mode).
 * - App-shell + static: cache-first with versioned cache.
 * - Navigations: network-first, cache fallback (offline still opens POS shell).
 * - /api: never cached here — mutations queue via the offline-queue lib and
 *   replay through /api/pos/checkout/sync on reconnect.
 */
const CACHE = "srai-shell-v2";
const SHELL = ["/login", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // API reads go to network; on failure fall back to cache, else a 503 JSON
  // (never leave respondWith empty — that surfaces as ERR_FAILED).
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(request)
          .then(
            (hit) =>
              hit ||
              new Response(JSON.stringify({ ok: false, error: "OFFLINE" }), {
                status: 503,
                headers: { "content-type": "application/json" },
              }),
          ),
      ),
    );
    return;
  }

  // Navigations: network-first (never serve a cached redirect), then cache,
  // then a plain offline page — respondWith must always resolve.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // Only cache usable document responses, never redirects.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then(
            (hit) =>
              hit ||
              new Response(
                "<h1>Offline</h1><p>SmartRetailAI is offline. Reconnect and reload.</p>",
                { status: 503, headers: { "content-type": "text/html" } },
              ),
          ),
        ),
    );
    return;
  }

  // Static + shell: cache-first.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        }),
    ),
  );
});
