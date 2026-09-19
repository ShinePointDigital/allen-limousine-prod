import assert from "node:assert/strict";
import test from "node:test";
import { findDriverDispatchSms, sendSms, twilioPhonesEqual } from "./twilio.js";

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromNumber: process.env.TWILIO_FROM_NUMBER,
};

function restoreEnvironment() {
  globalThis.fetch = originalFetch;
  if (originalEnvironment.accountSid === undefined) delete process.env.TWILIO_ACCOUNT_SID;
  else process.env.TWILIO_ACCOUNT_SID = originalEnvironment.accountSid;
  if (originalEnvironment.authToken === undefined) delete process.env.TWILIO_AUTH_TOKEN;
  else process.env.TWILIO_AUTH_TOKEN = originalEnvironment.authToken;
  if (originalEnvironment.fromNumber === undefined) delete process.env.TWILIO_FROM_NUMBER;
  else process.env.TWILIO_FROM_NUMBER = originalEnvironment.fromNumber;
}

test.afterEach(restoreEnvironment);

test("sends through Twilio REST with normalized phone numbers", async () => {
  process.env.TWILIO_ACCOUNT_SID = "AC11111111111111111111111111111111";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_FROM_NUMBER = "7088431292";
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ sid: "SM11111111111111111111111111111111", status: "queued" }), { status: 201 });
  };

  const result = await sendSms("7085275486", "Dispatch instructions");

  assert.equal(result.providerStatus, "queued");
  assert.match(request?.url || "", /api\.twilio\.com/);
  const body = request?.init?.body as URLSearchParams;
  assert.equal(body.get("To"), "+17085275486");
  assert.equal(body.get("From"), "+17088431292");
  assert.match(new Headers(request?.init?.headers).get("Authorization") || "", /^Basic /);
});

test("finds one matching SID-less dispatch attempt", async () => {
  process.env.TWILIO_ACCOUNT_SID = "AC11111111111111111111111111111111";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  globalThis.fetch = async () => new Response(JSON.stringify({
    messages: [{
      sid: "SM22222222222222222222222222222222",
      status: "delivered",
      account_sid: "AC11111111111111111111111111111111",
      to: "+17085275486",
      from: "+17088431292",
      body: "Dispatch instructions",
      date_created: "Sat, 19 Sep 2026 05:08:00 +0000",
      error_code: null,
      error_message: null,
    }],
  }), { status: 200 });

  const result = await findDriverDispatchSms("+17085275486", "Dispatch instructions", "2026-09-19T05:07:57.207Z");

  assert.equal(result?.providerMessageId, "SM22222222222222222222222222222222");
  assert.equal(result?.providerStatus, "delivered");
});

test("compares formatted and E.164 phone numbers canonically", () => {
  assert.equal(twilioPhonesEqual("(708) 527-5486", "+17085275486"), true);
  assert.equal(twilioPhonesEqual("+17085275486", "+13125550188"), false);
});

test("returns null when Twilio has no matching dispatch", async () => {
  process.env.TWILIO_ACCOUNT_SID = "AC11111111111111111111111111111111";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  globalThis.fetch = async () => new Response(JSON.stringify({ messages: [] }), { status: 200 });

  const result = await findDriverDispatchSms("+17085275486", "Dispatch instructions", "2026-09-19T05:07:57.207Z");

  assert.equal(result, null);
});