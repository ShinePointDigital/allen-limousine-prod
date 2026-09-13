const CACHE = "allen-limo-shell-v4";
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
  if (request.headers.has("range")) {
    event.respondWith(fetch(request));
    return;
  }
  event.respondWith((async () => {
    try {
      const preload = await event.preloadResponse;
      const response = preload || await fetch(request);
      if (response.ok && response.status !== 206 && (response.type === "basic" || response.type === "default")) {
        const copy = response.clone();
        event.waitUntil(
          caches.open(CACHE)
            .then(cache => cache.put(request, copy))
            .catch(() => undefined),
        );
      }
      return response;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === "navigate") {
        const shell = await caches.match("/");
        if (shell) return shell;
      }
      return new Response("Offline", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});