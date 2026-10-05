import assert from "node:assert/strict";
import test from "node:test";
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
