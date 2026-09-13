const CACHE = "allen-limo-shell-v2";
const SHELL = ["/", "/manifest.json", "/allen-limousine-logo.png", "/pwa-icon-192.png", "/pwa-icon-512.png", "/pwa-icon-maskable-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(async cache => {
    await Promise.allSettled(SHELL.map(asset => cache.add(asset)));
    const html = await fetch("/");
    const text = await html.clone().text();
    const assets = [...text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
    await cache.put("/", html);
    await Promise.allSettled([...new Set(assets)].map(asset => cache.add(asset)));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key !== CACHE).map(key => caches.delete(key)));
    if ("navigationPreload" in self.registration) await self.registration.navigationPreload.enable();
  })());
  self.clients.claim();
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(
    (event.preloadResponse || fetch(request))
      .then(response => {
        if (response && response.ok && (response.type === "basic" || response.type === "default")) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("/");
        throw new Error("Offline asset not cached.");
      }),
  );
});