import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import bcrypt from "bcryptjs";
import express from "express";
import cookieParser from "cookie-parser";
import type Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";
import { CorporateService, capabilityHash, accountView, signCorporateQuote, readCorporateQuote } from "./corporate-service.js";
import { chargeCorporateBooking, validateIntent } from "./corporate-billing.js";
import { createCorporateRouter } from "./corporate-routes.js";
import { prisma, changeCustomerPassword, authenticate, validateRideUpdate } from "./store.js";
import { corporateApplicationSchema, corporateTripSchema } from "../shared/corporate.js";
import { flightDisruption } from "../shared/flight-disruption.js";
import { DRIVER_FLIGHT_FRESH_MS } from "../shared/flight.js";
import { SMS_BRAND, SMS_OPT_IN_CONFIRMATION, SMS_OPT_OUT_CONFIRMATION, inboundSmsResponse, smsHelpResponse } from "../shared/sms-program.js";
import { SMS_CONSENT_AUTHOR, bookingHasSmsConsent } from "../shared/sms-consent.js";
import { mapFlight } from "./utils/flightTracker.js";

const application = () => corporateApplicationSchema.parse({
  companyLegalName: "Corporate Test Company", contactName: "Fixture Contact",
  contactEmail: `corp-fixture-${crypto.randomUUID()}@example.invalid`, contactPhone: "+13125550199",
  monthlyRideVolume: 12, billingPreference: "ITEMIZED_PO_RECEIPTS", billingName: "Fixture Accounts",
  billingEmail: "corp-billing@example.invalid", billingAddress: "123 Fixture Street, Chicago IL",
  billingConsent: true, applicationToken: crypto.randomBytes(32).toString("hex"),
});
const trip = () => corporateTripSchema.parse({
  bookingRequestId: crypto.randomUUID(), fullName: "Fixture Passenger", phone: "+13125550198",
  pickup: "Chicago Test Pickup", destination: "Chicago Test Destination", pickupAt: new Date(Date.now() + 86400000).toISOString(),
  passengers: 2, rateTier: "EXECUTIVE_SEDAN", poNumber: "PO-FIXTURE", costCenterCode: "CC-FIXTURE", notes: "",
});
test("corporate inputs require consent, PO/cost center, and reject raw card details", () => {
  const a = application(); assert.ok(corporateApplicationSchema.safeParse(a).success);
  assert.equal(corporateApplicationSchema.safeParse({ ...a, billingConsent: false }).success, false);
  assert.equal(corporateApplicationSchema.safeParse({ ...a, cardNumber: "4242424242424242" }).success, false);
  for (const field of ["poNumber", "costCenterCode"]) assert.equal(corporateTripSchema.safeParse({ ...trip(), [field]: " " }).success, false);
});
test("quote signatures freeze company, trip, amount and identity", () => {
  const q = { accountId: "fixture", userId: "fixture-user", trip: trip(), fareCents: 12300, expiresAt: Date.now() + 60000 };
  const token = signCorporateQuote(q, "isolated-test-key");
  assert.deepEqual(readCorporateQuote(token, "isolated-test-key"), q);
  assert.throws(() => readCorporateQuote(token, "different-test-key"));
  assert.throws(() => readCorporateQuote(`${Buffer.from(JSON.stringify({ ...q, fareCents: 1 })).toString("base64url")}.${token.split(".")[1]}`, "isolated-test-key"));
});
test("official SMS templates and no duplicate provider-managed START/STOP replies", () => {
  for (const body of [SMS_OPT_IN_CONFIRMATION, SMS_OPT_OUT_CONFIRMATION, smsHelpResponse("+13125550199")]) assert.ok(body.startsWith(`${SMS_BRAND}:`));
  assert.equal(inboundSmsResponse("HELP", "+13125550199", "HELP"), null);
  assert.equal(inboundSmsResponse("STOP", "+13125550199"), null);
  assert.equal(inboundSmsResponse("START", "+13125550199"), null);
  assert.equal(inboundSmsResponse(" help ", "+13125550199"), smsHelpResponse("+13125550199"));
  const legacy = { version: "service-sms-v1", type: "transactional_sms_consent", consented: true, source: "website_booking_checkout", phone: "+13125550199", agreement: "I agree to receive service-related text messages, including automated texts, from Allan Limousine at the phone number I provided about reservation confirmations, pickup and ride-status updates, and chauffeur dispatch." };
  assert.ok(bookingHasSmsConsent([{ authorName: SMS_CONSENT_AUTHOR, body: `SMS consent record: ${JSON.stringify(legacy)}` }], legacy.phone));
});
function flightFixture() {
  const scheduled = "2026-10-15T16:00:00.000Z", now = Date.now();
  const flight = mapFlight({ flight_date: "2026-10-15", flight_status: "cancelled",
    departure: { iata: "LAX", timezone: "America/Los_Angeles", scheduled: "2026-10-15T14:00:00Z" },
    arrival: { iata: "ORD", timezone: "America/Chicago", scheduled: "2026-10-15T16:00:00Z" },
  }, "AA100", new Date(now).toISOString());
  flight.verifiedBookingContext = {
    flightNumber: "AA100", scheduledAt: scheduled, airportCode: "ORD", flightDate: flight.flightDate,
    departureAirportCode: flight.departureAirportCode, arrivalAirportCode: flight.arrivalAirportCode,
    scheduledDepartureTime: flight.scheduledDepartureTime, scheduledArrivalTime: flight.scheduledArrivalTime,
  };
  return { now, booking: { flightNumber: "AA100", airportCode: "ORD", flightScheduledAt: scheduled, flightDetails: flight } };
}
test("verified disruption warnings deduplicate and clear on resolved or stale data", () => {
  const { now, booking } = flightFixture();
  const warning = flightDisruption(booking, now); assert.equal(warning?.status, "cancelled");
  assert.equal(flightDisruption(booking, now)?.key, warning?.key);
  booking.flightDetails.flightStatus = "diverted"; assert.equal(flightDisruption(booking, now)?.status, "diverted");
  booking.flightDetails.flightStatus = "landed"; assert.equal(flightDisruption(booking, now), null);
  booking.flightDetails.flightStatus = "cancelled"; assert.equal(flightDisruption(booking, now + DRIVER_FLIGHT_FRESH_MS), null);
});
test("mismatched, future, private, or unavailable flight records never warn", () => {
  for (const mutate of [
    (b: any) => { b.flightScheduledAt = "2026-10-16T16:00:00.000Z"; },
    (b: any) => { b.airportCode = "MDW"; },
    (b: any) => { b.flightNumber = "AA101"; },
    (b: any) => { b.flightDetails.fetchedAt = new Date(Date.now() + 60000).toISOString(); },
    (b: any) => { b.isPrivateFBO = true; },
    (b: any) => { delete b.flightDetails.verifiedBookingContext; },
    (b: any) => { b.flightDetails = null; },
  ]) {
    const { now, booking } = flightFixture(); const originalPickup = booking.flightScheduledAt;
    mutate(booking); assert.equal(flightDisruption(booking, now), null);
    if (booking.flightScheduledAt === originalPickup) assert.equal(booking.flightScheduledAt, originalPickup);
  }
});
function billingFixture(status = "succeeded") {
  const booking: any = { id: "fixture-inquiry", bookingRequestId: "fixture-request", corporateAccountId: "fixture-account", status: "NEW",
    ride: { status: "IN_PROGRESS" }, corporateAccount: { status: "ACTIVE", billingEmail: "fixture@example.invalid", stripeCustomerId: "cus_fixture", stripePaymentMethodId: "pm_fixture" },
    authorizedTotalCents: 12300, estimatedFareCents: 12300, gratuityCents: 0, stripeCustomerId: "cus_fixture", stripePaymentMethodId: "pm_fixture",
    stripePaymentIntentId: null, paymentStatus: "corporate_ready", corporateChargeStartedAt: null, poNumber: "PO", costCenterCode: "CC",
  };
  const intent: any = { id: "pi_fixture", amount: 12300, amount_received: status === "succeeded" ? 12300 : 0, currency: "usd", customer: "cus_fixture", metadata: { inquiryId: booking.id }, status };
  const calls: { kind: string; params?: any; options?: any }[] = [];
  const db = {
    inquiry: {
      findUnique: async () => booking, findUniqueOrThrow: async () => booking,
      updateMany: async ({ data }: any) => { Object.assign(booking, data); return { count: 1 }; },
      update: async ({ data }: any) => { Object.assign(booking, data); return booking; },
    },
    ride: { update: async ({ data }: any) => { Object.assign(booking.ride, data); return booking.ride; } },
  } as unknown as PrismaClient;
  const stripe = {
    paymentIntents: {
      create: async (params: any, options: any) => { calls.push({ kind: "create", params, options }); return intent; },
      retrieve: async () => { calls.push({ kind: "retrieve" }); return intent; },
      confirm: async (_id: string, params: any, options: any) => { calls.push({ kind: "confirm", params, options }); intent.status = "succeeded"; intent.amount_received = 12300; return intent; },
    },
  } as unknown as Stripe;
  return { booking, intent, calls, db, stripe, deps: { db, stripe: async () => stripe } };
}
test("each completed ride charges exactly its approved fare and retry reuses its intent", async () => {
  const f = billingFixture(); await chargeCorporateBooking("fixture-request", f.deps); await chargeCorporateBooking("fixture-request", f.deps);
  assert.equal(f.calls.filter(c => c.kind === "create").length, 1);
  assert.equal(f.calls[0].params.amount, 12300); assert.equal(f.calls[0].params.off_session, true);
  assert.equal(f.calls[0].options.idempotencyKey, "corporate-ride-fixture-request");
  assert.equal(f.booking.ride.collectedCents, 12300);
});
test("declines/SCA are saved to the original intent and never complete or collect", async () => {
  for (const status of ["requires_action", "requires_payment_method", "processing"]) {
    const f = billingFixture(status); await assert.rejects(chargeCorporateBooking("fixture-request", f.deps));
    assert.equal(f.booking.stripePaymentIntentId, "pi_fixture"); assert.equal(f.booking.paymentStatus, status);
    assert.equal(f.booking.ride.collectedCents, undefined); assert.equal(f.booking.ride.status, "IN_PROGRESS");
  }
});
test("a replacement card re-confirms the same intent, not another charge", async () => {
  const f = billingFixture("requires_payment_method"); f.booking.stripePaymentIntentId = f.intent.id;
  f.booking.corporateAccount.stripePaymentMethodId = "pm_replacement";
  await chargeCorporateBooking("fixture-request", f.deps);
  assert.deepEqual(f.calls.map(c => c.kind), ["retrieve", "confirm"]);
  assert.equal(f.calls[1].params.payment_method, "pm_replacement");
});
test("unknown outcomes preserve the charge reservation; old unresolved attempts stop before Stripe", async () => {
  const f = billingFixture(); f.stripe.paymentIntents.create = async () => { throw Error("simulated transport uncertainty"); };
  await assert.rejects(chargeCorporateBooking("fixture-request", f.deps), /outcome is not confirmed/);
  assert.equal(f.booking.paymentStatus, "corporate_charging"); assert.ok(f.booking.corporateChargeStartedAt);
  f.booking.corporateChargeStartedAt = new Date(Date.now() - 23 * 3600000);
  await assert.rejects(chargeCorporateBooking("fixture-request", f.deps), /unresolved/);
});
test("cancelled, early, wrong amount/customer/trip, and partially-paid charges fail closed", async () => {
  for (const status of ["UNASSIGNED", "ASSIGNED", "EN_ROUTE", "CANCELLED"]) {
    const f = billingFixture(); f.booking.ride.status = status;
    await assert.rejects(chargeCorporateBooking("fixture-request", f.deps)); assert.equal(f.calls.length, 0);
  }
  const f = billingFixture();
  for (const bad of [{ amount: 1 }, { currency: "eur" }, { customer: "cus_other" }, { metadata: { inquiryId: "other" } }]) {
    assert.throws(() => validateIntent({ ...f.intent, ...bad }, "cus_fixture", 12300, "fixture-inquiry"));
  }
  f.intent.amount_received = 1;
  await assert.rejects(chargeCorporateBooking("fixture-request", f.deps)); assert.equal(f.booking.paymentStatus, "corporate_review");
  assert.equal(f.booking.ride.collectedCents, undefined);
});

test("development-only corporate application, approval, login, password, booking and access workflow", async t => {
  const data = application(); const emailCalls: { password: string | null; username: string }[] = [];
  const sessions = new Map<string, any>(); const methods = new Map<string, any>();
  const stripe = {
    customers: { create: async ({ metadata }: any) => ({ id: `cus_fixture_${metadata.corporateAccountId}` }) },
    checkout: { sessions: {
      create: async (params: any) => {
        const id = `cs_fixture_${crypto.randomUUID().replaceAll("-", "")}`, method = `pm_fixture_${id}`;
        methods.set(method, { id: method, customer: params.customer, type: "card" });
        const s = { id, url: `https://checkout.stripe.com/fixture/${id}`, ...params, status: "complete",
          setup_intent: { status: "succeeded", usage: "off_session", metadata: params.metadata, payment_method: method } };
        sessions.set(id, s); return s;
      },
      retrieve: async (id: string) => sessions.get(id),
    } },
    paymentMethods: { retrieve: async (id: string) => methods.get(id) },
  } as unknown as Stripe;
  const service = new CorporateService(prisma, async () => stripe, async (_to, username, password) => { emailCalls.push({ username, password }); }, () => {});
  const app = express(); app.use(express.json(), cookieParser());
  app.use(createCorporateRouter({ service, origin: () => "http://127.0.0.1", estimate: async () => ({ fareCents: 12300 } as any),
    admin: (req, res, next) => { if (req.header("x-fixture-admin") !== "true") return void res.status(403).json({ error: "Forbidden" }); res.locals.user = { id: "fixture-admin" }; next(); },
  }));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const port = (server.address() as { port: number }).port; let cookie = "", accountId = "", userId = "";
  const request = async (path: string, body?: any, admin = false) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(admin ? { "x-fixture-admin": "true" } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); return { response, data: text ? JSON.parse(text) : null };
  };
  try {
    await t.test("application capability hashed and repeat-safe; no card data exposed", async () => {
      const created = await request("/api/corporate/applications", data); assert.equal(created.response.status, 201);
      accountId = created.data.application.id;
      assert.equal((await request("/api/corporate/applications", data)).data.application.id, accountId);
      assert.equal((await prisma.corporateAccount.findUniqueOrThrow({ where: { id: accountId } })).applicationTokenHash, capabilityHash(data.applicationToken!));
      assert.equal((await request("/api/corporate/applications", { ...data, contactName: "Changed Contact" })).response.status, 409);
      assert.equal((await request(`/api/corporate/applications/${accountId}/payment-setup`, { applicationToken: "0".repeat(64) })).response.status, 404);
    });
    await t.test("admin approval is protected and requires verified saved-method setup", async () => {
      assert.equal((await request(`/api/admin/corporate/accounts/${accountId}/approve`, {})).response.status, 403);
      assert.equal((await request(`/api/admin/corporate/accounts/${accountId}/approve`, {}, true)).response.status, 409);
      assert.equal((await request(`/api/corporate/applications/${accountId}/payment-setup`, { applicationToken: data.applicationToken })).response.status, 200);
      const a = await prisma.corporateAccount.findUniqueOrThrow({ where: { id: accountId } });
      assert.equal((await request(`/api/corporate/applications/${accountId}/payment-confirm`, { applicationToken: data.applicationToken, sessionId: a.stripeSetupSessionId })).response.status, 200);
      const approved = await request(`/api/admin/corporate/accounts/${accountId}/approve`, {}, true); assert.equal(approved.response.status, 200);
      assert.ok(approved.data.account.mustChangePassword); assert.equal(approved.data.account.credentialsEmailStatus, "SENT");
      assert.equal(approved.data.password, undefined); assert.equal(approved.data.account.stripeCustomerId, undefined);
      assert.ok(emailCalls[0].password!.length >= 32);
      userId = (await prisma.corporateAccount.findUniqueOrThrow({ where: { id: accountId } })).userId!;
      assert.ok(await bcrypt.compare(emailCalls[0].password!, (await prisma.adminUser.findUniqueOrThrow({ where: { id: userId } })).passwordHash));
    });
    await t.test("temporary credentials block booking; resend revokes them; permanent change unlocks portal", async () => {
      const first = emailCalls[0].password!;
      let login = await request("/api/corporate/login", { email: data.contactEmail, password: first });
      assert.equal(login.response.status, 200); cookie = login.response.headers.get("set-cookie")!.split(";")[0];
      assert.equal((await request("/api/corporate/quotes", trip())).response.status, 403);
      await service.resend(accountId, "http://127.0.0.1"); assert.equal(await authenticate(data.contactEmail, first, "customer"), null);
      const current = emailCalls.at(-1)!.password!;
      login = await request("/api/corporate/login", { email: data.contactEmail, password: current });
      cookie = login.response.headers.get("set-cookie")!.split(";")[0];
      const changed = await request("/api/corporate/password", { currentPassword: current, password: "fixture-permanent-password-123" }); assert.equal(changed.response.status, 200);
      assert.equal((await request("/api/corporate/session")).response.status, 401);
      login = await request("/api/corporate/login", { email: data.contactEmail, password: "fixture-permanent-password-123" });
      assert.equal(login.response.status, 200); cookie = login.response.headers.get("set-cookie")!.split(";")[0];
      await service.resend(accountId, "http://127.0.0.1"); assert.equal(emailCalls.at(-1)!.password, null);
    });
    await t.test("PO/cost center and quote identity are mandatory; saved-method booking is repeat-safe and financially fixed", async () => {
      const input = trip();
      assert.equal((await request("/api/corporate/quotes", { ...input, poNumber: "" })).response.status, 400);
      const quoted = await request("/api/corporate/quotes", input); assert.equal(quoted.response.status, 200);
      const booked = await request("/api/corporate/bookings", { quoteToken: quoted.data.quoteToken }); assert.equal(booked.response.status, 201);
      const repeated = await request("/api/corporate/bookings", { quoteToken: quoted.data.quoteToken }); assert.equal(repeated.data.booking.id, booked.data.booking.id);
      const b = await prisma.inquiry.findUniqueOrThrow({ where: { id: booked.data.booking.id }, include: { ride: true } });
      assert.equal(b.paymentStatus, "corporate_ready"); assert.equal(b.stripePaymentIntentId, null); assert.equal(b.poNumber, input.poNumber); assert.equal(b.costCenterCode, input.costCenterCode);
      await assert.rejects(validateRideUpdate(b.ride!.id, { quoteCents: 1 }), /fare is fixed/);
      await assert.rejects(validateRideUpdate(b.ride!.id, { collectedCents: 1 }), /only after Stripe/);
      assert.equal((await request("/api/corporate/bookings")).data.bookings.length, 1);
      assert.equal((await request("/api/corporate/bookings/not-owned/payment-action", {})).response.status, 404);
      const bad = signCorporateQuote({ accountId: "different", userId, trip: input, fareCents: 12300, expiresAt: Date.now() + 60000 });
      assert.equal((await request("/api/corporate/bookings", { quoteToken: bad })).response.status, 403);
    });
    await t.test("temporary expiry and customer password changes remain consistent", async () => {
      await prisma.corporateAccount.update({ where: { id: accountId }, data: { mustChangePassword: true, credentialsExpiresAt: new Date(Date.now() - 1) } });
      assert.equal(await authenticate(data.contactEmail, "fixture-permanent-password-123", "customer"), null);
      assert.ok(await changeCustomerPassword(userId, "fixture-permanent-password-123", "fixture-permanent-password-456"));
      assert.equal((await service.account(userId)).mustChangePassword, false);
      const view = accountView(await prisma.corporateAccount.findUniqueOrThrow({ where: { id: accountId } }));
      assert.equal("applicationTokenHash" in view, false); assert.equal("stripePaymentMethodId" in view, false);
    });
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (accountId) { await prisma.inquiry.deleteMany({ where: { corporateAccountId: accountId } }); await prisma.corporateAccount.delete({ where: { id: accountId } }); }
    if (userId) await prisma.adminUser.delete({ where: { id: userId } });
    await prisma.$disconnect();
  }
});
