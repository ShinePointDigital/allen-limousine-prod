import "dotenv/config";
import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import type { PrismaClient } from "@prisma/client";
import { prisma, authenticate, createFleet, updateRide } from "./store.js";
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
  const extraDriverIds: string[] = [];
  const extraVehicleIds: string[] = [];
  t.after(async () => {
    await prisma.inquiry.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.chauffeur.deleteMany({ where: { id: { in: extraDriverIds } } });
    if (driverId) await prisma.chauffeur.delete({ where: { id: driverId } });
    await prisma.fleetVehicle.deleteMany({ where: { id: { in: extraVehicleIds } } });
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
  await prisma.chauffeur.update({ where: { id: driver.id }, data: { fleetVehicleId: vehicle.id } });
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
    return using.assign(booking.id, reviewed.version, driver.id, actor);
  };
  const unpairedVehicle = async () => {
    const item = await prisma.fleetVehicle.create({ data: {
      name: `Test unpaired ${crypto.randomUUID()}`, category: "Sedan", description: "Isolated pairing test",
      imageUrl: "https://example.invalid/car.jpg", passengers: "3", luggage: "2",
    } });
    extraVehicleIds.push(item.id);
    return item;
  };
  const unpairedDriver = async () => {
    const item = await prisma.chauffeur.create({ data: {
      name: "Test unpaired chauffeur", phone: `+1312${crypto.randomInt(1000000, 4999999)}`,
    } });
    extraDriverIds.push(item.id);
    return item;
  };
  return { actor, driver, vehicle, booking, service, sent, sender, assign, createBooking, unpairedVehicle, unpairedDriver, extraDriverIds, extraVehicleIds };
}

async function adminApi(t: TestContext, f: Awaited<ReturnType<typeof fixture>>) {
  const session = await authenticate(f.actor.email, "wizard-test-only-password");
  assert.ok(session);
  const app = express();
  app.use(express.json(), cookieParser(), createDispatchWizardRouter({ admin: staffGuard, sendSms: f.sender, service: f.service }));
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return (path: string, body?: unknown, signed = true) => fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(signed ? { Cookie: `allan_session=${session.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("review and assignment persist across service restarts without sending SMS", async t => {
  const f = await fixture(t);
  assert.equal((await f.service.snapshot(f.booking.id)).step, 1);
  const reviewed = await f.service.review(f.booking.id, 0, f.actor);
  assert.equal(reviewed.step, 2);
  const restarted = new DispatchWizardService(f.sender, prisma, async () => false);
  assert.equal((await restarted.snapshot(f.booking.id)).step, 2);
  const assigned = await restarted.assign(f.booking.id, reviewed.version, f.driver.id, f.actor);
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
  await assert.rejects(f.service.assign(f.booking.id, pending.version, f.driver.id, f.actor), /cannot be changed/i);
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
  await assert.rejects(f.service.assign(f.booking.id, assigned.version - 1, f.driver.id, f.actor), /Another dispatcher/);
  const second = await f.createBooking();
  const reviewed = await f.service.review(second.id, 0, f.actor);
  assert.equal(reviewed.drivers.find(item => item.id === f.driver.id)?.available, false);
  assert.equal(reviewed.vehicles.find(item => item.id === f.vehicle.id)?.available, false);
  await assert.rejects(f.service.assign(second.id, reviewed.version, f.driver.id, f.actor), /already assigned/);
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
  assert.equal((await request(`${path}/assign`, { action: "save", version: reviewed.version, driverId: f.driver.id, vehicleId: "not-the-paired-vehicle" })).status, 409);
  const assignedResponse = await request(`${path}/assign`, { action: "save", version: reviewed.version, driverId: f.driver.id });
  assert.equal(assignedResponse.status, 200);
  const assigned = await assignedResponse.json();
  assert.equal(assigned.step, 3);
  assert.equal(f.sent.length, 0);
  const response = await request(`${path}/assign`, { action: "dispatch", version: assigned.version });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).step, 4);
  assert.equal(f.sent.length, 2);
});

test("unpaired, inactive, undersized and busy paired vehicles cannot be dispatched", async t => {
  const f = await fixture(t);
  const legacyDriver = await f.unpairedDriver();
  const reviewed = await f.service.review(f.booking.id, 0, f.actor);
  const legacy = reviewed.drivers.find(item => item.id === legacyDriver.id)!;
  assert.equal(legacy.fleetVehicleId, null);
  assert.equal(legacy.available, false);
  assert.equal(legacy.pairable, true);
  await assert.rejects(f.service.assign(f.booking.id, reviewed.version, legacyDriver.id, f.actor), /paired vehicle/);

  await prisma.inquiry.update({ where: { id: f.booking.id }, data: { passengers: 4 } });
  await assert.rejects(f.service.assign(f.booking.id, reviewed.version, f.driver.id, f.actor), /passenger seats/);
  await prisma.inquiry.update({ where: { id: f.booking.id }, data: { passengers: 1 } });
  await prisma.fleetVehicle.update({ where: { id: f.vehicle.id }, data: { active: false } });
  assert.equal((await f.service.snapshot(f.booking.id)).drivers.find(item => item.id === f.driver.id)?.available, false);
  await assert.rejects(f.service.assign(f.booking.id, reviewed.version, f.driver.id, f.actor), /active paired vehicle/);
  await prisma.fleetVehicle.update({ where: { id: f.vehicle.id }, data: { active: true } });

  const second = await f.createBooking();
  await prisma.ride.create({ data: {
    inquiryId: second.id, vehicleId: f.vehicle.id, status: "ASSIGNED",
    driverName: "Legacy different chauffeur", driverPhone: "+13125550001",
  } });
  assert.equal((await f.service.snapshot(f.booking.id)).drivers.find(item => item.id === f.driver.id)?.available, false);
  await assert.rejects(f.service.assign(f.booking.id, reviewed.version, f.driver.id, f.actor), /already assigned/);
  assert.equal((await prisma.inquiry.findUniqueOrThrow({ where: { id: f.booking.id } })).dispatchVersion, reviewed.version);
  assert.equal(f.sent.length, 0);
});

test("chauffeur setup creates or links exactly one vehicle atomically and enforces access", async t => {
  const f = await fixture(t);
  const request = await adminApi(t, f);
  const vehicle = await f.unpairedVehicle();
  const payload = { name: "New paired chauffeur", phone: `+1312${crypto.randomInt(1000000, 4999999)}`, vehicleId: vehicle.id };
  assert.equal((await request("/api/admin/chauffeurs", payload, false)).status, 401);
  await prisma.adminUser.update({ where: { id: f.actor.id }, data: { permissions: ["inquiries"] } });
  assert.equal((await request("/api/admin/chauffeurs", payload)).status, 403);
  await prisma.adminUser.update({ where: { id: f.actor.id }, data: { permissions: ["rides"] } });
  assert.equal((await request("/api/admin/chauffeurs", { name: payload.name, phone: payload.phone })).status, 400);

  const linkedResponse = await request("/api/admin/chauffeurs", payload);
  assert.equal(linkedResponse.status, 201);
  const { chauffeur: linked } = await linkedResponse.json();
  f.extraDriverIds.push(linked.id);
  assert.equal(linked.fleetVehicleId, vehicle.id);
  assert.equal(linked.fleetVehicle.defaultDriverName, payload.name);
  assert.equal(linked.fleetVehicle.defaultDriverPhone, payload.phone);
  const roster = await f.service.snapshot(f.booking.id);
  assert.equal(roster.drivers.find(item => item.id === linked.id)?.vehicleName, vehicle.name);
  assert.equal(roster.vehicles.find(item => item.id === vehicle.id)?.pairedToDriverId, linked.id);
  assert.equal(roster.vehicles.find(item => item.id === vehicle.id)?.pairable, false);
  assert.equal((await request("/api/admin/chauffeurs", { ...payload, phone: `+1312${crypto.randomInt(1000000, 4999999)}` })).status, 409);

  const newVehicle = {
    name: `Atomic new vehicle ${crypto.randomUUID()}`, category: "SUV", description: "Test vehicle creation",
    imageUrl: "https://example.invalid/new-car.jpg", passengers: "1–6", luggage: "4 large",
  };
  assert.equal((await request("/api/admin/chauffeurs", { ...payload, newVehicle })).status, 400);
  assert.equal((await request("/api/admin/chauffeurs", { name: payload.name, phone: payload.phone, newVehicle: { ...newVehicle, passengers: "invalid 6 seats" } })).status, 400);
  const newResponse = await request("/api/admin/chauffeurs", {
    name: "Chauffeur with new vehicle", phone: `+1312${crypto.randomInt(1000000, 4999999)}`, newVehicle,
  });
  assert.equal(newResponse.status, 201);
  const { chauffeur: created } = await newResponse.json();
  f.extraDriverIds.push(created.id);
  f.extraVehicleIds.push(created.fleetVehicleId);
  assert.equal(created.fleetVehicle.name, newVehicle.name);
  assert.equal(created.fleetVehicleId, created.fleetVehicle.id);

  const rolledBackName = `Rolled back vehicle ${crypto.randomUUID()}`;
  assert.equal((await request("/api/admin/chauffeurs", {
    name: "Duplicate phone chauffeur", phone: f.driver.phone,
    newVehicle: { ...newVehicle, name: rolledBackName },
  })).status, 409);
  assert.equal(await prisma.fleetVehicle.count({ where: { name: rolledBackName } }), 0);
  assert.equal(f.sent.length, 0);
});

test("fleet creation with chauffeur details saves a permanent pairing atomically", async t => {
  const f = await fixture(t);
  const details = {
    name: `Paired fleet ${crypto.randomUUID()}`, category: "Sedan", description: "Fleet pairing regression",
    imageUrl: "https://example.invalid/car.jpg", passengers: "3", luggage: "2", active: true,
    defaultDriverName: "Fleet-created Chauffeur", defaultDriverPhone: `+1312${crypto.randomInt(1000000, 4999999)}`,
  };
  await assert.rejects(createFleet({ ...details, defaultDriverPhone: null }), /both/);
  await assert.rejects(createFleet({ ...details, defaultDriverName: null }), /both/);
  assert.equal(await prisma.fleetVehicle.count({ where: { name: details.name } }), 0);
  const vehicle = await createFleet(details);
  f.extraVehicleIds.push(vehicle.id);
  const driver = await prisma.chauffeur.findUniqueOrThrow({ where: { phone: details.defaultDriverPhone } });
  f.extraDriverIds.push(driver.id);
  assert.equal(driver.fleetVehicleId, vehicle.id);
  const snapshot = await f.service.snapshot(f.booking.id);
  assert.equal(snapshot.drivers.find(item => item.id === driver.id)?.available, true);
  const duplicateName = `Rejected duplicate ${crypto.randomUUID()}`;
  await assert.rejects(createFleet({ ...details, name: duplicateName }), /already exists/);
  assert.equal(await prisma.fleetVehicle.count({ where: { name: duplicateName } }), 0);
  const vehicleOnly = await createFleet({ ...details, name: `Vehicle only ${crypto.randomUUID()}`, defaultDriverName: null, defaultDriverPhone: null });
  f.extraVehicleIds.push(vehicleOnly.id);
  assert.equal(await prisma.chauffeur.count({ where: { fleetVehicleId: vehicleOnly.id } }), 0);
});

test("completion immediately frees the chauffeur and vehicle without removing their fixed pairing or history", async t => {
  const f = await fixture(t);
  await f.assign();
  const nextBooking = await f.createBooking();
  const before = await f.service.snapshot(nextBooking.id);
  assert.equal(before.drivers.find(item => item.id === f.driver.id)?.available, false);
  const ride = await prisma.ride.findUniqueOrThrow({ where: { inquiryId: f.booking.id } });
  await updateRide(ride.id, { status: "EN_ROUTE" });
  await updateRide(ride.id, { status: "IN_PROGRESS" });
  await updateRide(ride.id, { status: "COMPLETED" });
  const after = await f.service.snapshot(nextBooking.id);
  assert.equal(after.drivers.find(item => item.id === f.driver.id)?.available, true);
  assert.equal(after.vehicles.find(item => item.id === f.vehicle.id)?.available, true);
  assert.equal((await prisma.chauffeur.findUniqueOrThrow({ where: { id: f.driver.id } })).fleetVehicleId, f.vehicle.id);
  const history = await prisma.ride.findUniqueOrThrow({ where: { id: ride.id } });
  assert.equal(history.driverId, f.driver.id);
  assert.equal(history.vehicleId, f.vehicle.id);
  const reviewed = await f.service.review(nextBooking.id, after.version, f.actor);
  const assigned = await f.service.assign(nextBooking.id, reviewed.version, f.driver.id, f.actor);
  assert.equal(assigned.assignment.driverId, f.driver.id);
  assert.equal(assigned.assignment.vehicleId, f.vehicle.id);
  assert.equal(f.sent.length, 0);
});

test("legacy resources are paired explicitly without altering saved rides or allowing conflicting links", async t => {
  const f = await fixture(t);
  const request = await adminApi(t, f);
  const driver = await f.unpairedDriver();
  const vehicle = await f.unpairedVehicle();
  await prisma.fleetVehicle.update({ where: { id: vehicle.id }, data: { defaultDriverName: driver.name, defaultDriverPhone: driver.phone } });
  const before = await f.service.snapshot(f.booking.id);
  assert.equal(before.drivers.find(item => item.id === driver.id)?.fleetVehicleId, null);
  assert.equal(before.vehicles.find(item => item.id === vehicle.id)?.pairedToDriverId, null);
  assert.equal((await request(`/api/admin/chauffeurs/${driver.id}/vehicle`, { vehicleId: f.vehicle.id })).status, 409);

  const legacyBooking = await f.createBooking();
  const legacyRide = await prisma.ride.create({ data: {
    inquiryId: legacyBooking.id, vehicleId: f.vehicle.id, status: "ASSIGNED",
    driverName: driver.name, driverPhone: `${driver.phone.slice(0, 2)} (${driver.phone.slice(2, 5)}) ${driver.phone.slice(5, 8)}-${driver.phone.slice(8)}`,
  } });
  assert.equal((await f.service.snapshot(legacyBooking.id)).drivers.find(item => item.id === driver.id)?.pairable, false);
  assert.equal((await request(`/api/admin/chauffeurs/${driver.id}/vehicle`, { vehicleId: vehicle.id })).status, 409);
  await prisma.ride.update({ where: { id: legacyRide.id }, data: { status: "COMPLETED" } });
  await prisma.inquiry.update({ where: { id: legacyBooking.id }, data: { status: "COMPLETED", dispatchStep: 4, dispatchStatus: "DISPATCHED" } });
  const response = await request(`/api/admin/chauffeurs/${driver.id}/vehicle`, { vehicleId: vehicle.id });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).chauffeur.fleetVehicleId, vehicle.id);
  const savedRide = await prisma.ride.findUniqueOrThrow({ where: { id: legacyRide.id } });
  assert.equal(savedRide.vehicleId, f.vehicle.id);
  assert.equal(savedRide.driverPhone, legacyRide.driverPhone);
  const historical = await f.service.snapshot(legacyBooking.id);
  assert.equal(historical.completed, true);
  assert.equal(historical.assignment.vehicleId, f.vehicle.id);
  assert.equal((await request(`/api/admin/chauffeurs/${driver.id}/vehicle`, { vehicleId: vehicle.id })).status, 409);
  await assert.rejects(prisma.fleetVehicle.delete({ where: { id: vehicle.id } }), (error: any) => error.code === "P2003");
  assert.equal((await prisma.chauffeur.findUniqueOrThrow({ where: { id: driver.id } })).fleetVehicleId, vehicle.id);
  assert.equal(f.sent.length, 0);
});

test("pairing rejects inactive and occupied resources and supports a new vehicle for an existing chauffeur", async t => {
  const f = await fixture(t);
  const request = await adminApi(t, f);
  const driver = await f.unpairedDriver();
  const vehicle = await f.unpairedVehicle();
  await prisma.fleetVehicle.update({ where: { id: vehicle.id }, data: { active: false } });
  assert.equal((await request(`/api/admin/chauffeurs/${driver.id}/vehicle`, { vehicleId: vehicle.id })).status, 409);
  await prisma.fleetVehicle.update({ where: { id: vehicle.id }, data: { active: true } });
  const busyBooking = await f.createBooking();
  await prisma.ride.create({ data: { inquiryId: busyBooking.id, vehicleId: vehicle.id, status: "ASSIGNED", driverPhone: "+13125550123" } });
  assert.equal((await request(`/api/admin/chauffeurs/${driver.id}/vehicle`, { vehicleId: vehicle.id })).status, 409);
  await prisma.chauffeur.update({ where: { id: driver.id }, data: { active: false } });
  assert.equal((await request(`/api/admin/chauffeurs/${driver.id}/vehicle`, { vehicleId: vehicle.id })).status, 404);
  await prisma.chauffeur.update({ where: { id: driver.id }, data: { active: true } });
  const response = await request(`/api/admin/chauffeurs/${driver.id}/vehicle`, { newVehicle: {
    name: `Existing chauffeur new car ${crypto.randomUUID()}`, category: "Sedan", description: "New test fleet unit",
    imageUrl: "https://example.invalid/vehicle.jpg", passengers: "3", luggage: "2",
  } });
  assert.equal(response.status, 200);
  const { chauffeur } = await response.json();
  f.extraVehicleIds.push(chauffeur.fleetVehicleId);
  assert.equal(chauffeur.id, driver.id);
  assert.equal(chauffeur.fleetVehicle.defaultDriverPhone, driver.phone);
});

test("concurrent pair creation cannot claim one vehicle for two chauffeurs", async t => {
  const f = await fixture(t);
  const request = await adminApi(t, f);
  const vehicle = await f.unpairedVehicle();
  const responses = await Promise.all([1, 2].map(() => request("/api/admin/chauffeurs", {
    name: "Concurrent pair test", phone: `+1312${crypto.randomInt(1000000, 4999999)}`, vehicleId: vehicle.id,
  })));
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 409]);
  for (const response of responses) {
    if (response.status === 201) f.extraDriverIds.push((await response.json()).chauffeur.id);
  }
  assert.equal(await prisma.chauffeur.count({ where: { fleetVehicleId: vehicle.id } }), 1);
});

test("concurrent bookings cannot both assign the same chauffeur and fixed vehicle", async t => {
  const f = await fixture(t);
  const second = await f.createBooking();
  const firstReview = await f.service.review(f.booking.id, 0, f.actor);
  const secondReview = await f.service.review(second.id, 0, f.actor);
  const results = await Promise.allSettled([
    f.service.assign(f.booking.id, firstReview.version, f.driver.id, f.actor),
    f.service.assign(second.id, secondReview.version, f.driver.id, f.actor),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await prisma.ride.count({ where: { driverId: f.driver.id, status: "ASSIGNED" } }), 1);
  assert.equal(f.sent.length, 0);
});

test("a saved legacy assignment remains dispatchable without inferring a fixed pairing", async t => {
  const f = await fixture(t);
  const assigned = await f.assign();
  // Represents a pre-migration saved ride, whose chauffeur has no explicit fixed pairing.
  await prisma.chauffeur.update({ where: { id: f.driver.id }, data: { fleetVehicleId: null } });
  const legacy = await f.service.snapshot(f.booking.id);
  assert.equal(legacy.assignment.vehicleId, f.vehicle.id);
  assert.equal(legacy.drivers.find(item => item.id === f.driver.id)?.fleetVehicleId, null);
  assert.equal(legacy.drivers.find(item => item.id === f.driver.id)?.pairable, false);
  assert.equal(legacy.step, 3);
  const completed = await f.service.dispatch(f.booking.id, assigned.version, f.actor);
  assert.equal(completed.completed, true);
  assert.equal(f.sent.length, 2);
  assert.ok(f.sent.every(message => message.body.includes(f.vehicle.name)));
  assert.equal((await prisma.chauffeur.findUniqueOrThrow({ where: { id: f.driver.id } })).fleetVehicleId, null);
});
