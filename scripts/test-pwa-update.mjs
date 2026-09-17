import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

async function runInstall({ failRequiredAsset }) {
  class ServiceWorkerRequest {
    constructor(input, options = {}) {
      this.url = new URL(typeof input === "string" ? input : input.url, "https://example.com").href;
      this.cache = options.cache;
    }
  }
  const listeners = new Map();
  let installPromise;
  let skipWaitingCalls = 0;
  const cached = [];
  const cache = {
    put: async request => cached.push(typeof request === "string" ? request : request.url),
    add: async request => {
      const url = typeof request === "string" ? request : request.url;
      if (failRequiredAsset && url.endsWith("/assets/app.js")) throw new Error("simulated asset failure");
      cached.push(url);
    },
  };
  const context = {
    URL,
    Request: ServiceWorkerRequest,
    Response,
    console,
    caches: {
      open: async () => cache,
    },
    fetch: async request => {
      const url = typeof request === "string" ? request : request.url;
      if (!url.endsWith("/")) throw new Error(`Unexpected fetch: ${url}`);
      return new Response('<link href="/assets/app.css"><script src="/assets/app.js"></script>', {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });
    },
    self: {
      location: { origin: "https://example.com" },
      registration: {},
      clients: {},
      addEventListener: (type, listener) => listeners.set(type, listener),
      skipWaiting: async () => {
        skipWaitingCalls += 1;
      },
    },
  };
  vm.runInNewContext(source, context);
  listeners.get("install")({
    waitUntil: promise => {
      installPromise = promise;
    },
  });
  let error = null;
  try {
    await installPromise;
  } catch (caught) {
    error = caught;
  }
  return { error, skipWaitingCalls, cached };
}

const failedInstall = await runInstall({ failRequiredAsset: true });
assert(failedInstall.error, "A failed required asset must reject service-worker installation.");
assert.equal(failedInstall.skipWaitingCalls, 0, "A worker with an incomplete app shell must not activate.");

const successfulInstall = await runInstall({ failRequiredAsset: false });
assert.equal(successfulInstall.error, null);
assert.equal(successfulInstall.skipWaitingCalls, 1);
assert(successfulInstall.cached.some(url => url.endsWith("/assets/app.js")));
assert(successfulInstall.cached.some(url => url.endsWith("/assets/app.css")));

console.log("PWA service-worker lifecycle checks passed.");