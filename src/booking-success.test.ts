import assert from "node:assert/strict";
import test from "node:test";
import { bookingSuccessTransition, isPwaLaunch } from "./booking-success.js";

const authorizedBooking = {
  trackingToken: "secure-tracking-capability",
  inquiryId: "inquiry_abc123",
  pickupAt: "2026-09-18T18:00:00.000Z",
  pickup: "DFW Airport",
  destination: "Downtown Dallas",
  fareCents: 12500,
  paymentNotice: "Authorization hold placed.",
  cardLast4: "4242",
  createdAt: "2026-09-18T12:00:00.000Z",
};

test("source=pwa opens live tracking after successful authorization", () => {
  const transition = bookingSuccessTransition(isPwaLaunch("?source=pwa", false, false), authorizedBooking);

  assert.equal(transition.view, "tracking");
  assert.equal(transition.reservation.trackingToken, authorizedBooking.trackingToken);
  assert.equal(transition.reservation.reference, "ABC123");
  assert.equal("driverName" in transition.reservation, false);
  assert.equal("driverPhone" in transition.reservation, false);
  assert.equal("vehicle" in transition.reservation, false);
});

test("an installed PWA opens live tracking after successful authorization", () => {
  const transition = bookingSuccessTransition(isPwaLaunch("", true, false), authorizedBooking);
  assert.equal(transition.view, "tracking");
});

test("an ordinary desktop browser keeps the request-received confirmation", () => {
  const transition = bookingSuccessTransition(isPwaLaunch("", false, false), authorizedBooking);

  assert.deepEqual(transition, { view: "request-received" });
  assert.equal("reservation" in transition, false);
});