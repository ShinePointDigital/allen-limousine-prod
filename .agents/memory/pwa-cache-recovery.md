---
name: PWA cache recovery
description: Reliability constraints for service-worker updates, media range requests, and recovery from a broken active worker.
---

Never put HTTP range requests or `206 Partial Content` responses into Cache Storage. A service-worker fetch handler must always resolve to a valid `Response`, including when navigation preload resolves without one.

**Why:** Media range requests are common on mobile and desktop. Cache Storage rejects partial responses, and a rejected worker response can block refreshed JavaScript and manifest requests. Cleanup placed only in the application bundle cannot run when that bundle is already blocked.

**How to apply:** Bypass the cache for requests with a `Range` header, exclude status `206` from cache writes, catch background cache-write failures, and place versioned one-time unregister/cache cleanup inline in the HTML before module scripts.