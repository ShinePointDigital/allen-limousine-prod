import "dotenv/config";
import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { prisma, authenticate } from "./store.js";
import { applicationDatabaseUrl } from "./database-config.js";
import { DispatchWizardService } from "./dispatch-wizard-service.js";
import { createDispatchWizardRouter } from "./dispatch-wizard-routes.js";
import { staffGuard } from "./account-routes.js";
import { TwilioRequestError } from "./twilio.js";
import { SMS_CONSENT_AUTHOR, smsConsentAuditBody } from "../shared/sms-consent.js";

assert.ok(process.env.NODE_TEST_CONTEXT, "Database dispatch tests must run in isolated Node test workers.");
assert.ok(applicationDatabaseUrl(), "An isolated development database is required.");
after(() => prisma.$disconnect());
const sid = () => `SM${crypto.randomUUID().replaceAll("-", "")}`;

async function fixture(t: TestContext, consent = true) {
  const bookingIds: string[] = [];
  let actorId: string | undefined;
  let driverId: string | undefined;
  let vehicleId: string | undefined;
  t.after(async () => {
    await prisma.inquiry.deleteMany({ where: { id: { in: bookingIds } } });
    if (driverId) await prisma.chauffeur.delete({ where: { id: driverId } });
    if (vehicleId) await prisma.fleetVehicle.delete({ where: { id: vehicleId } });
    if (actorId) await prisma.adminUser.delete({ where: { id: actorId } });
  });
  const actor = await prisma.adminUser.create({ data: {
    name: "Dispatch Wizard Test", email: `${crypto.randomUUID()}@example.invalid`,
    passwordHash: await bcrypt.hash("wizard-test-only-password", 4), role: "ADMIN", permissions: ["rides"],
  } });
  actorId = actor.id;
  const driver = await prisma.chauffeur.create({ data: {
    name: "Test Chauffeur", phone: `+1312${crypto.randomInt(5557000, 5559999)}`,
  } });
  driverId = driver.id;
  const vehicle = await prisma.fleetVehicle.create({ data: {
    name: "Test Vehicle Unit", category: "Sedan", description: "Isolated test fixture",
    imageUrl: "/test-fixture.jpg", passengers: "3", luggage: "2",
  } });
  vehicleId = vehicle.id;
  const createBooking = async () => {
    const booking = await prisma.inquiry.create({ data: {
      fullName: "Test Client", email: "wizard-client@example.invalid", phone: "+13125550189",
      serviceType: "Point-to-Point", pickupAt: new Date(Date.now() + 3600_000), pickup: "Test pickup", destination: "Test drop-off",
      passengers: 1, rateTier: "SEDAN", paymentStatus: "authorized", estimatedFareCents: 15000,
    } });
    bookingIds.push(booking.id);
    await prisma.inquiryNote.create({ data: {
      inquiryId: booking.id, authorId: null, authorName: SMS_CONSENT_AUTHOR, body: smsConsentAuditBody(consent, booking.phone),
    } });
    return booking;
  };
  const booking = await createBooking();
  const sent: { phone: string; body: string }[] = [];
  const sender = async (phone: string, body: string) => {
    sent.push({ phone, body });
    return { providerMessageId: sid(), providerStatus: "queued" };
  };
  const service = new DispatchWizardService(sender, prisma, async () => false);
  const assign = async (using = service) => {
    const reviewed = await using.review(booking.id, 0, actor);
    return using.assign(booking.id, reviewed.version, driver.id, vehicle.id, actor);
  };
  return { actor, driver, vehicle, booking, service, sent, sender, assign, createBooking };
}

test("review and assignment persist across service restarts without sending SMS", async t => {
  const f = await fixture(t);
  assert.equal((await f.service.snapshot(f.booking.id)).step, 1);
  const reviewed = await f.service.review(f.booking.id, 0, f.actor);
  assert.equal(reviewed.step, 2);
  const restarted = new DispatchWizardService(f.sender, prisma, async () => false);
  assert.equal((await restarted.snapshot(f.booking.id)).step, 2);
  const assigned = await restarted.assign(f.booking.id, reviewed.version, f.driver.id, f.vehicle.id, f.actor);
  assert.equal(assigned.step, 3);
  assert.equal(assigned.booking.status, "CONFIRMED");
  assert.equal(assigned.assignment.driverId, f.driver.id);
  assert.equal(assigned.assignment.vehicleId, f.vehicle.id);
  assert.equal((await f.service.snapshot(f.booking.id)).step, 3);
  assert.equal(f.sent.length, 0);
  const stored = await prisma.inquiry.findUniqueOrThrow({ where: { id: f.booking.id }, include: { ride: true } });
  assert.equal(stored.dispatchStep, 3);
  assert.ok(stored.dispatchReviewedAt);
  assert.equal(stored.ride?.status, "ASSIGNED");
});

test("concurrent dispatch and later retries cannot duplicate either accepted notification", async t => {
  const f = await fixture(t);
  const assigned = await f.assign();
  const results = await Promise.allSettled([
    f.service.dispatch(f.booking.id, assigned.version, f.actor),
    f.service.dispatch(f.booking.id, assigned.version, f.actor),
  ]);
  assert.ok(results.some(result => result.status === "fulfilled"));
  let state = await f.service.snapshot(f.booking.id);
  // A competing worker may safely supersede an unstarted reservation; resume its unsent work.
  if (!state.completed && !state.blocked) state = await f.service.dispatch(f.booking.id, state.version, f.actor);
  assert.equal(state.step, 4);
  assert.equal(state.completed, true);
  assert.equal(f.sent.length, 2);
  assert.equal(f.sent[0].phone, f.driver.phone);
  assert.equal(f.sent[1].phone, f.booking.phone);
  assert.ok(f.sent[0].body.includes(f.vehicle.name));
  await f.service.dispatch(f.booking.id, state.version, f.actor);
  await f.service.dispatch(f.booking.id, assigned.version, f.actor);
  assert.equal(f.sent.length, 2);
  assert.equal((await prisma.inquiry.findUniqueOrThrow({ where: { id: f.booking.id } })).dispatchStep, 4);
});

test("a definitively rejected client message retries only that recipient", async t => {
  const f = await fixture(t);
  let rejectClient = true;
  const service = new DispatchWizardService(async (phone, body) => {
    if (phone === f.booking.phone && rejectClient) { rejectClient = false; throw new TwilioRequestError("Confirmed provider rejection", true); }
    return f.sender(phone, body);
  }, prisma, async () => false);
  const assigned = await f.assign(service);
  const partial = await service.dispatch(f.booking.id, assigned.version, f.actor);
  assert.equal(partial.messages.driver.status, "SENT");
  assert.equal(partial.messages.customer.status, "FAILED");
  assert.equal(partial.step, 3);
  const resumed = await service.dispatch(f.booking.id, partial.version, f.actor);
  assert.equal(resumed.step, 4);
  assert.equal(f.sent.filter(message => message.phone === f.driver.phone).length, 1);
  assert.equal(f.sent.filter(message => message.phone === f.booking.phone).length, 1);
});

test("uncertain driver outcomes stay locked across restarts and reconcile before client sending", async t => {
  const f = await fixture(t);
  let calls = 0;
  const uncertain = new DispatchWizardService(async () => { calls++; throw new Error("Transport timeout"); }, prisma, async () => false);
  const assigned = await f.assign(uncertain);
  const pending = await uncertain.dispatch(f.booking.id, assigned.version, f.actor);
  assert.equal(pending.messages.driver.status, "PENDING");
  assert.equal(pending.messages.customer.status, "RESERVED");
  assert.ok(pending.blocked);
  await assert.rejects(f.service.dispatch(f.booking.id, pending.version, f.actor), /reconcile/i);
  await assert.rejects(f.service.assign(f.booking.id, pending.version, f.driver.id, f.vehicle.id, f.actor), /cannot be changed/i);
  assert.equal(calls, 1);
  // Simulate the existing reconciliation route's verified provider acceptance.
  await prisma.dispatchMessage.update({ where: { id: pending.messages.driver.attemptId! }, data: { status: "SENT", providerMessageId: sid() } });
  const reconciled = await f.service.snapshot(f.booking.id);
  const completed = await f.service.dispatch(f.booking.id, reconciled.version, f.actor);
  assert.equal(completed.step, 4);
  assert.equal(f.sent.length, 1);
  assert.equal(f.sent[0].phone, f.booking.phone);
});

test("unchecked consent and STOP skip the client without preventing authorized driver dispatch", async t => {
  for (const consent of [false, true]) {
    const f = await fixture(t, consent);
    const stopped = new DispatchWizardService(f.sender, prisma, async number => consent && number === f.booking.phone);
    const assigned = await f.assign(stopped);
    const completed = await stopped.dispatch(f.booking.id, assigned.version, f.actor);
    assert.equal(completed.step, 4);
    assert.equal(completed.messages.customer.status, "SKIPPED");
    assert.equal(f.sent.length, 1);
    assert.equal(f.sent[0].phone, f.driver.phone);
  }
});

test("a later STOP cannot hide an already uncertain client attempt or mark it complete", async t => {
  const f = await fixture(t);
  let stopped = false;
  const service = new DispatchWizardService(async (number, body) => {
    if (number === f.booking.phone) throw new Error("Client transport timeout");
    return f.sender(number, body);
  }, prisma, async number => stopped && number === f.booking.phone);
  const assigned = await f.assign(service);
  await service.dispatch(f.booking.id, assigned.version, f.actor);
  stopped = true;
  const pending = await service.snapshot(f.booking.id);
  assert.equal(pending.messages.driver.status, "SENT");
  assert.equal(pending.messages.customer.status, "PENDING");
  assert.equal(pending.step, 3);
  assert.equal(pending.completed, false);
  assert.ok(pending.blocked);
});

test("stale assignment edits and double-booked drivers or units are rejected", async t => {
  const f = await fixture(t);
  const assigned = await f.assign();
  await assert.rejects(f.service.assign(f.booking.id, assigned.version - 1, f.driver.id, f.vehicle.id, f.actor), /Another dispatcher/);
  const second = await f.createBooking();
  const reviewed = await f.service.review(second.id, 0, f.actor);
  assert.equal(reviewed.drivers.find(item => item.id === f.driver.id)?.available, false);
  assert.equal(reviewed.vehicles.find(item => item.id === f.vehicle.id)?.available, false);
  await assert.rejects(f.service.assign(second.id, reviewed.version, f.driver.id, f.vehicle.id, f.actor), /already assigned/);
  assert.equal(f.sent.length, 0);
});

test("completing the ride or deactivating its chauffeur does not reopen an already finished wizard", async t => {
  const f = await fixture(t);
  const assigned = await f.assign();
  await f.service.dispatch(f.booking.id, assigned.version, f.actor);
  await prisma.ride.update({ where: { inquiryId: f.booking.id }, data: { status: "COMPLETED" } });
  await prisma.chauffeur.update({ where: { id: f.driver.id }, data: { active: false } });
  const completed = await f.service.snapshot(f.booking.id);
  assert.equal(completed.step, 4);
  assert.equal(completed.completed, true);
  assert.equal(completed.blocked, null);
  await f.service.dispatch(f.booking.id, completed.version, f.actor);
  assert.equal(f.sent.length, 2);
});

test("an accepted SMS with a failed audit write remains pending and cannot be resent", async t => {
  const f = await fixture(t);
  const failingDb = prisma.$extends({
    query: { dispatchMessage: { async updateMany({ args, query }) {
      if (args.data.status === "SENT") throw new Error("Simulated audit failure");
      return query(args);
    } } },
  }) as unknown as PrismaClient;
  const service = new DispatchWizardService(f.sender, failingDb, async () => false);
  const assigned = await f.assign(service);
  await assert.rejects(service.dispatch(f.booking.id, assigned.version, f.actor), /audit write failed/);
  const pending = await f.service.snapshot(f.booking.id);
  assert.equal(pending.messages.driver.status, "PENDING");
  assert.equal(pending.completed, false);
  await assert.rejects(f.service.dispatch(f.booking.id, pending.version, f.actor), /reconcile/i);
  assert.equal(f.sent.length, 1);
});

test("assignment changes outside the wizard cannot cause obsolete instructions to be sent", async t => {
  const f = await fixture(t);
  const service = new DispatchWizardService(async (number, body) => {
    if (number === f.booking.phone) throw new TwilioRequestError("Confirmed rejection", true);
    return f.sender(number, body);
  }, prisma, async () => false);
  const assigned = await f.assign(service);
  const partial = await service.dispatch(f.booking.id, assigned.version, f.actor);
  await prisma.ride.update({ where: { id: partial.assignment.rideId! }, data: { driverName: "Changed elsewhere" } });
  const changed = await service.snapshot(f.booking.id);
  assert.equal(changed.completed, false);
  assert.match(changed.blocked || "", /changed after notifications/);
  await assert.rejects(service.dispatch(f.booking.id, changed.version, f.actor), /changed after notifications/);
  assert.equal(f.sent.length, 1);
});

test("the actual assign API requires dispatch access, validates versions and sends only on explicit dispatch", async t => {
  const f = await fixture(t);
  const session = await authenticate(f.actor.email, "wizard-test-only-password");
  assert.ok(session);
  const app = express();
  app.use(express.json(), cookieParser(), createDispatchWizardRouter({ admin: staffGuard, sendSms: f.sender, service: f.service }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body?: unknown, signed = true) => fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(signed ? { Cookie: `allan_session=${session.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const path = `/api/admin/bookings/${f.booking.id}`;
  assert.equal((await request(`${path}/dispatch`, undefined, false)).status, 401);
  await prisma.adminUser.update({ where: { id: f.actor.id }, data: { permissions: ["inquiries"] } });
  assert.equal((await request(`${path}/dispatch`)).status, 403);
  await prisma.adminUser.update({ where: { id: f.actor.id }, data: { permissions: ["rides"] } });
  assert.equal((await request(`${path}/assign`, { action: "save" })).status, 400);
  const reviewed = await (await request(`${path}/review`, { version: 0 })).json();
  const assignedResponse = await request(`${path}/assign`, { action: "save", version: reviewed.version, driverId: f.driver.id, vehicleId: f.vehicle.id });
  assert.equal(assignedResponse.status, 200);
  const assigned = await assignedResponse.json();
  assert.equal(assigned.step, 3);
  assert.equal(f.sent.length, 0);
  const response = await request(`${path}/assign`, { action: "dispatch", version: assigned.version });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).step, 4);
  assert.equal(f.sent.length, 2);
});
