import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = "test";
process.env.VERCEL = "1";
process.env.DATABASE_URL = "";
process.env.ALLOW_IN_MEMORY_DEMO = "true";
process.env.ADMIN_EMAIL = "sms-root@example.test";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "sms-test-password";
process.env.TWILIO_AUTH_TOKEN = "test-only-signing-token";
process.env.TWILIO_ACCOUNT_SID = `AC${"0".repeat(32)}`;
process.env.TWILIO_FROM_NUMBER = "+13125550999";
process.env.TWILIO_STATUS_CALLBACK_URL = "https://sms.example.test/api/webhooks/twilio/status";
process.env.TWILIO_INBOUND_CALLBACK_URL = "https://sms.example.test/api/webhooks/twilio/inbound";
const store = await import("./store.js");
const inbox = await import("./sms-inbox-store.js");
const { staffGuard } = await import("./account-routes.js");
const { createSmsInboxRouter } = await import("./sms-inbox-routes.js");
const { TwilioRequestError } = await import("./twilio.js");
const sid = (digit: string) => `SM${digit.repeat(32)}`;

test("two-way inbox validates signatures, permissions, duplicates, opt-outs and safe reply reconciliation without sending SMS", async () => {
  await store.initializeStore();
  const root = (await store.authenticate("sms-root@example.test", "sms-test-password"))!;
  await store.createAdmin({ name: "SMS staff", email: "sms-staff@example.test", password: "sms-test-password", role: "ADMIN", permissions: ["sms"] }, root.user);
  await store.createAdmin({ name: "Other staff", email: "sms-other@example.test", password: "sms-test-password", role: "ADMIN", permissions: ["rides"] }, root.user);
  await store.createAdmin({ name: "SMS customer", email: "sms-customer@example.test", password: "sms-test-password", role: "USER" }, root.user);
  const staff = (await store.authenticate("sms-staff@example.test", "sms-test-password"))!;
  const other = (await store.authenticate("sms-other@example.test", "sms-test-password"))!;
  const customer = (await store.authenticate("sms-customer@example.test", "sms-test-password", "customer"))!;
  let mode = "sent";
  let sends = 0;
  let found = true;
  let provider = {
    providerMessageId: sid("b"), providerStatus: "queued", accountSid: process.env.TWILIO_ACCOUNT_SID!,
    fromPhone: process.env.TWILIO_FROM_NUMBER!, toPhone: "+13125550114", body: "Second reply",
    errorCode: null as string | null, errorMessage: null as string | null, createdAt: new Date().toISOString(),
  };
  const app = express();
  app.use(express.json(), express.urlencoded({ extended: false }), cookieParser());
  app.use(createSmsInboxRouter({
    admin: staffGuard, publicOrigin: () => "https://sms.example.test",
    sendReply: async () => {
      sends++;
      if (mode === "uncertain") throw new TwilioRequestError("Mock timeout after submission.", false);
      if (mode === "rejected") throw new TwilioRequestError("Mock provider rejection.", true);
      return { providerMessageId: sid("a"), providerStatus: "queued" };
    },
    getProviderMessage: async () => provider,
    findProviderMessage: async () => found ? provider : null,
  }));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, token?: string, body?: unknown) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", ...(token ? { Cookie: `allan_session=${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const inbound = (fields: Record<string, string>, signed = true) => {
    const payload = Object.keys(fields).sort().reduce((value, key) => value + key + fields[key], process.env.TWILIO_INBOUND_CALLBACK_URL!);
    const signature = crypto.createHmac("sha1", process.env.TWILIO_AUTH_TOKEN!).update(payload).digest("base64");
    return fetch(base + "/api/webhooks/twilio/inbound", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(signed ? { "x-twilio-signature": signature } : {}) }, body: new URLSearchParams(fields) });
  };
  const fields = { MessageSid: sid("1"), From: "+13125550114", To: process.env.TWILIO_FROM_NUMBER!, Body: "Please confirm pickup — thank you.", AccountSid: process.env.TWILIO_ACCOUNT_SID! };
  try {
    assert.equal((await request("/api/admin/sms/inbox")).status, 401);
    assert.equal((await request("/api/admin/sms/inbox", other.token)).status, 403);
    assert.equal((await request("/api/admin/sms/inbox", customer.token)).status, 403);
    assert.equal((await inbound(fields, false)).status, 401);
    assert.equal((await inbound({ ...fields, AccountSid: `AC${"9".repeat(32)}` })).status, 403);
    assert.equal((await inbound({ ...fields, To: "+13125550888" })).status, 403);
    assert.equal((await inbound(fields)).status, 200);
    assert.equal((await inbound(fields)).status, 200);
    const listing = await request("/api/admin/sms/inbox", staff.token);
    assert.equal(listing.status, 200);
    assert.equal(listing.headers.get("cache-control"), "no-store");
    const conversation = (await listing.json()).conversations[0];
    assert.equal(conversation.contactType, "CUSTOMER");
    assert.equal(conversation.contactName, "Sofia Mercer");
    assert.equal(conversation.unreadCount, 1);
    const path = `/api/admin/sms/inbox/${conversation.id}`;
    assert.equal((await (await request(path, staff.token)).json()).messages.length, 1);
    assert.equal((await request(path + "/messages", staff.token, { body: "" })).status, 400);
    assert.equal((await request(path + "/messages", staff.token, { body: "Reply", phone: "+13125550100" })).status, 400);
    assert.equal(sends, 0);
    const sent = await request(path + "/messages", staff.token, { body: "First reply" });
    assert.equal(sent.status, 201);
    assert.equal((await sent.json()).message.status, "SENT");
    await inbox.updateSmsDeliveryStatus(sid("a"), "delivered");
    await inbox.updateSmsDeliveryStatus(sid("a"), "queued");
    assert.equal((await inbox.getSmsMessageByProviderId(sid("a")))!.deliveryStatus, "delivered");
    assert.equal((await inbound({ ...fields, MessageSid: sid("2"), Body: "STOP", OptOutType: "STOP" })).status, 200);
    assert.equal(await inbox.smsRecipientOptedOut("+1 (312) 555-0114"), true);
    assert.equal((await request(path + "/messages", staff.token, { body: "Blocked reply" })).status, 409);
    assert.equal(sends, 1);
    await inbound({ ...fields, MessageSid: sid("3"), Body: "START", OptOutType: "START" });
    assert.equal(await inbox.smsRecipientOptedOut(fields.From), false);
    const restarted = await inbox.getSmsThread(conversation.id);
    assert.equal((await inbound({ ...fields, MessageSid: sid("2"), Body: "STOP", OptOutType: "STOP" })).status, 200);
    assert.equal((await inbound({ ...fields, MessageSid: sid("3"), Body: "START", OptOutType: "START" })).status, 200);
    assert.equal(await inbox.smsRecipientOptedOut(fields.From), false);
    assert.equal((await inbox.getSmsThread(conversation.id))!.conversation.unreadCount, restarted!.conversation.unreadCount);
    assert.equal((await inbox.getSmsThread(conversation.id))!.messages.length, restarted!.messages.length);
    assert.equal((await request(path + "/read", staff.token, {})).status, 204);
    assert.equal((await inbox.getSmsThread(conversation.id))!.conversation.unreadCount, 0);
    const dispatch = (await store.createDispatchAttempt({ rideId: "ride-001", adminId: root.user.id, toPhone: fields.From, body: "Uncertain dispatch fixture" }))!;
    assert.equal((await request(path + "/messages", staff.token, { body: "Second reply" })).status, 409);
    assert.equal(sends, 1);
    await store.finishDispatchAttempt(dispatch.id, { status: "FAILED" });
    mode = "uncertain";
    assert.equal((await request(path + "/messages", staff.token, { body: "Second reply" })).status, 502);
    const pending = (await inbox.getSmsThread(conversation.id))!.messages.find(message => message.status === "PENDING")!;
    assert.ok(pending);
    assert.equal((await request(path + "/messages", staff.token, { body: "Duplicate reply" })).status, 409);
    assert.equal(sends, 2);
    const reconcile = path + `/messages/${pending.id}/reconcile`;
    found = false;
    assert.equal((await request(reconcile, staff.token, {})).status, 409);
    found = true;
    provider = { ...provider, body: "Wrong body" };
    assert.equal((await request(reconcile, staff.token, {})).status, 409);
    provider = { ...provider, body: "Second reply", createdAt: "2020-01-01T00:00:00Z" };
    assert.equal((await request(reconcile, staff.token, {})).status, 409);
    provider = { ...provider, createdAt: pending.createdAt };
    assert.equal((await request(reconcile, staff.token, {})).status, 200);
    assert.equal((await inbox.getSmsReplyAttempt(conversation.id, pending.id))!.status, "SENT");
    mode = "rejected";
    const failed = await request(path + "/messages", staff.token, { body: "Third reply" });
    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).message.status, "FAILED");
    assert.equal(sends, 3);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test("the application's signed delivery webhook updates inbox replies and ignores stale statuses", async () => {
  const inbound = await inbox.recordInboundSms({ providerMessageId: sid("4"), fromPhone: "+13125550444", toPhone: process.env.TWILIO_FROM_NUMBER!, body: "Delivery callback fixture" });
  const attempt = (await inbox.createSmsReplyAttempt({ conversationId: inbound.conversationId, fromPhone: process.env.TWILIO_FROM_NUMBER!, body: "Delivery reply fixture", adminId: "admin-001", adminName: "SMS test staff" }))!;
  await inbox.finishSmsReplyAttempt(attempt.id, { status: "SENT", providerMessageId: sid("e"), deliveryStatus: "queued" });
  const { app: application } = await import("./index.js");
  const server = application.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const callback = (status: string, signed = true) => {
    const fields = { MessageSid: sid("e"), MessageStatus: status, ErrorCode: status === "undelivered" ? "30003" : "" };
    const payload = Object.keys(fields).sort().reduce((value, key) => value + key + fields[key as keyof typeof fields], process.env.TWILIO_STATUS_CALLBACK_URL!);
    const signature = crypto.createHmac("sha1", process.env.TWILIO_AUTH_TOKEN!).update(payload).digest("base64");
    return fetch(base + "/api/webhooks/twilio/status", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...(signed ? { "x-twilio-signature": signature } : {}) }, body: new URLSearchParams(fields) });
  };
  try {
    assert.equal((await callback("undelivered", false)).status, 401);
    assert.equal((await callback("undelivered")).status, 204);
    assert.equal((await inbox.getSmsMessageByProviderId(sid("e")))!.status, "FAILED");
    assert.equal((await callback("queued")).status, 204);
    assert.equal((await inbox.getSmsMessageByProviderId(sid("e")))!.deliveryStatus, "undelivered");
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
