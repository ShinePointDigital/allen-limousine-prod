---
name: PWA cache recovery
description: Reliability constraints for service-worker updates, media range requests, and recovery from a broken active worker.
---

Never put HTTP range requests or `206 Partial Content` responses into Cache Storage. A service-worker fetch handler must always resolve to a valid `Response`, including when navigation preload resolves without one.

**Why:** Media range requests are common on mobile and desktop. Cache Storage rejects partial responses, and a rejected worker response can block refreshed JavaScript and manifest requests. Cleanup placed only in the application bundle cannot run when that bundle is already blocked.

**How to apply:** Bypass the cache for requests with a `Range` header, exclude status `206` from cache writes, catch background cache-write failures, and place versioned one-time unregister/cache cleanup inline in the HTML before module scripts.

Each production build must stamp the service worker with a unique build ID. Cache the HTML-discovered hashed JS/CSS files atomically before calling `skipWaiting`; do not delete the previous complete shell if any required asset fails.

**Why:** Activating a partially cached worker can replace a working offline shell with HTML that references unavailable assets. Stable worker bytes also prevent already-open installed apps from detecting a new deployment.

**How to apply:** Serve HTML and the worker with `no-store`, check for worker updates when the app returns to the foreground, activate only after required assets cache successfully, and reload controlled windows after a successful version change.