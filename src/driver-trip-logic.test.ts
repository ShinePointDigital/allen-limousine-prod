import assert from "node:assert/strict";
import test from "node:test";
import { driverNavigationUrls, nextDriverTripStatus } from "./driver-trip-logic";

test("driver trip progression only offers the next sequential status", () => {
  assert.equal(nextDriverTripStatus("ASSIGNED"), "EN_ROUTE");
  assert.equal(nextDriverTripStatus("CONFIRMED"), "EN_ROUTE");
  assert.equal(nextDriverTripStatus("EN_ROUTE"), "IN_PROGRESS");
  assert.equal(nextDriverTripStatus("IN_PROGRESS"), "COMPLETED");
  assert.equal(nextDriverTripStatus("COMPLETED"), null);
  assert.equal(nextDriverTripStatus("CANCELLED"), null);
});

test("navigation providers receive the chosen stop as an encoded destination", () => {
  const urls = driverNavigationUrls("O’Hare Airport, Chicago, IL & Terminal 5");
  assert.match(urls.google, /destination=O%E2%80%99Hare%20Airport%2C%20Chicago%2C%20IL%20%26%20Terminal%205/);
  assert.match(urls.apple, /daddr=O%E2%80%99Hare%20Airport%2C%20Chicago%2C%20IL%20%26%20Terminal%205/);
  assert.match(urls.waze, /q=O%E2%80%99Hare%20Airport%2C%20Chicago%2C%20IL%20%26%20Terminal%205&navigate=yes/);
});
