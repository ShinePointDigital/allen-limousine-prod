import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import { createFlightTracker, FlightTrackerError } from "./utils/flightTracker.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "";
process.env.ALLOW_IN_MEMORY_DEMO = "true";
process.env.ADMIN_EMAIL = "flight-root@example.test";
process.env.ADMIN_BOOTSTRAP_PASSWORD = "flight-route-test-password";
const store = await import("./store.js");
const { createFlightRouter } = await import("./flight-routes.js");

test("flight API enforces staff rides access, booking attachment, persistence and last-known failures", async () => {
  await store.initializeStore();
  const root = await store.authenticate("flight-root@example.test", "flight-route-test-password");
  assert.ok(root);
  const limited = await store.createAdmin({ name: "Flight restricted", email: "flight-restricted@example.test", password: "flight-route-test-password", role: "ADMIN", permissions: ["fleet"] }, root.user);
  const driver = await store.createAdmin({ name: "Flight rides staff", email: "flight-rides@example.test", password: "flight-route-test-password", role: "ADMIN", permissions: ["rides"] }, root.user);
  const customer = await store.createAdmin({ name: "Flight customer", email: "flight-customer@example.test", password: "flight-route-test-password", role: "USER" }, root.user);
  const restrictedLogin = await store.authenticate(limited.email, "flight-route-test-password");
  const driverLogin = await store.authenticate(driver.email, "flight-route-test-password");
  const customerLogin = await store.authenticate(customer.email, "flight-route-test-password", "customer");
  const { inquiry } = await store.addInquiry({ fullName: "Flight fixture", email: "flight-fixture@example.test", phone: "+13125550100", serviceType: "Airport", pickupAt: "2026-10-06T16:30:00Z", pickup: "ORD", destination: "Chicago", passengers: 1, flightNumber: "AA 123", flightScheduledAt: "2026-10-06T16:00:00Z", airportCode: "ORD", isPrivateFBO: true });
  const ride = await store.getRideByInquiryId(inquiry.id);
  assert.ok(ride);
  let calls = 0;
  const tracker = createFlightTracker({ getApiKey: () => "test-only-key", client: { get: async () => ({ data: { data: [{
    flight: { iata: "AA123" }, flight_status: "active", airline: { name: "American" },
    arrival: { iata: "ORD", scheduled: "2026-10-06T16:00:00Z", estimated: "2026-10-06T16:15:00Z", terminal: "3", baggage: "6" },
  }] } }) } });
  let fail = false;
  const app = express();
  app.use(cookieParser());
  app.use("/api/flights", createFlightRouter({ lookup: async (number, options) => {
    calls++;
    if (fail) throw new FlightTrackerError("PROVIDER_UNAVAILABLE", "Provider temporarily unavailable.");
    assert.equal(options?.airportCode, "ORD");
    assert.equal(options?.scheduledAt, "2026-10-06T16:00:00Z");
    return tracker(number, options);
  } }));
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/flights`;
  const request = (path: string, token?: string) => fetch(base + path, { headers: token ? { Cookie: `allan_session=${token}` } : {} });
  try {
    const path = `/AA123?rideId=${ride.id}`;
    assert.equal((await request(path)).status, 401);
    assert.equal((await request(path, restrictedLogin!.token)).status, 403);
    assert.equal((await request(path, customerLogin!.token)).status, 403);
    assert.equal((await request(`/AA123?rideId=nonexistent`, root.token)).status, 404);
    assert.equal((await request(`/UA123?rideId=${ride.id}`, root.token)).status, 400);
    assert.equal((await request(`/123?rideId=${ride.id}`, root.token)).status, 400);
    assert.equal(calls, 0);
    const response = await request(path, driverLogin!.token);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.flight.arrivalTerminal, "3");
    assert.equal(result.stale, false);
    const saved = await store.getRideById(ride.id);
    assert.equal(saved!.inquiry.airlineName, "American");
    assert.equal(saved!.inquiry.baggageBelt, "6");
    assert.equal(saved!.inquiry.arrivalTime, "2026-10-06T16:15:00.000Z");
    assert.equal(saved!.inquiry.flightScheduledAt, "2026-10-06T16:00:00Z");
    assert.ok(saved!.inquiry.flightUpdatedAt);
    assert.equal(saved!.inquiry.flightDetails!.verifiedBookingContext!.scheduledAt,"2026-10-06T16:00:00.000Z");
    assert.equal(saved!.inquiry.flightDetails!.verifiedBookingContext!.airportCode,"ORD");
    assert.equal(saved!.inquiry.flightDetails!.verifiedBookingContext!.arrivalAirportCode,"ORD");
    fail = true;
    const failure = await request(path, root.token);
    assert.equal(failure.status, 502);
    const failed = await failure.json();
    assert.equal(failed.stale, true);
    assert.equal(failed.flight.baggageBelt, "6");
    assert.equal((await store.getRideById(ride.id))!.inquiry.flightDetails!.baggageBelt, "6");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
