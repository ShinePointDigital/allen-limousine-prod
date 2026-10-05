import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { isPwaPhoneDevice } from "./pwa-device.js";

test("recognizes iPhone and Android phone browsers", () => {
  assert.equal(isPwaPhoneDevice({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }), true);
  assert.equal(isPwaPhoneDevice({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36" }), true);
});

test("keeps iPads and Android tablets on the website", () => {
  assert.equal(isPwaPhoneDevice({ userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" }), false);
  assert.equal(isPwaPhoneDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15", platform: "MacIntel", maxTouchPoints: 5 }), false);
  assert.equal(isPwaPhoneDevice({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) Safari/537.36" }), false);
  assert.equal(isPwaPhoneDevice({ userAgent: "Mozilla/5.0 (Linux; Android 15; Tablet) Mobile Safari/537.36", userAgentDataMobile: false }), false);
});

test("keeps desktop browsers on the website", () => {
  assert.equal(isPwaPhoneDevice({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0", userAgentDataMobile: false }), false);
  assert.equal(isPwaPhoneDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15" }), false);
});

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const bootstrapScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrapScript, "The early device bootstrap must be present.");

function launchMetadata(signals: Parameters<typeof isPwaPhoneDevice>[0]) {
  let capable = html.match(/name="apple-mobile-web-app-capable" content="([^"]+)"/)?.[1];
  const links: { rel?: string; href?: string }[] = [];
  const listeners: string[] = [];
  vm.runInNewContext(bootstrapScript!, {
    navigator: {
      userAgent: signals.userAgent,
      platform: signals.platform || "",
      maxTouchPoints: signals.maxTouchPoints || 0,
      userAgentData: signals.userAgentDataMobile === undefined ? undefined : { mobile: signals.userAgentDataMobile },
    },
    document: {
      querySelector: () => ({ setAttribute: (_name: string, value: string) => { capable = value; } }),
      createElement: () => ({}),
      head: { appendChild: (link: { rel?: string; href?: string }) => links.push(link) },
    },
    window: { addEventListener: (name: string) => listeners.push(name) },
  });
  return { capable, manifests: links.filter(link => link.rel === "manifest"), installPromptCaptured: listeners.includes("beforeinstallprompt") };
}

test("saved-site metadata defaults to browser mode, not a standalone PWA", () => {
  assert.match(html, /name="apple-mobile-web-app-capable" content="no"/);
  assert.doesNotMatch(html, /<link\b[^>]*rel="manifest"/);
});

test("only phones receive standalone install metadata", () => {
  for (const userAgent of ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", "Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36"]) {
    const result = launchMetadata({ userAgent });
    assert.equal(result.capable, "yes");
    assert.equal(result.manifests.length, 1);
    assert.equal(result.manifests[0].href, "/manifest.json");
    assert.equal(result.installPromptCaptured, true);
  }
});

test("tablet and desktop bookmarks are not advertised as standalone apps", () => {
  const devices = [
    { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" },
    { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", platform: "MacIntel", maxTouchPoints: 5 },
    { userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel Tablet) Safari/537.36" },
    { userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile Safari/537.36", userAgentDataMobile: false },
    { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", userAgentDataMobile: false },
  ];
  for (const device of devices) {
    const result = launchMetadata(device);
    assert.equal(result.capable, "no", device.userAgent);
    assert.equal(result.manifests.length, 0, device.userAgent);
    assert.equal(result.installPromptCaptured, false, device.userAgent);
  }
});
