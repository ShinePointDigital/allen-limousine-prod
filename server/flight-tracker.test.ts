import assert from "node:assert/strict";
import test from "node:test";
import { createFlightTracker, normalizeFlightNumber, FlightTrackerError } from "./utils/flightTracker.js";

const at = Date.parse("2026-10-06T14:00:00Z");
const record = {
  flight_date: "2026-10-06", flight_status: "active",
  flight: { iata: "AA123", icao: "AAL123" }, airline: { name: "American Airlines" },
  departure: { airport: "JFK", iata: "JFK", timezone: "America/New_York", scheduled: "2026-10-06T10:00:00-04:00", estimated: null, actual: "2026-10-06T10:10:00-04:00", terminal: "8", gate: "12" },
  arrival: { airport: "O'Hare", iata: "ORD", timezone: "America/Chicago", scheduled: "2026-10-06T11:00:00-05:00", estimated: "2026-10-06T11:20:00-05:00", actual: null, terminal: "3", gate: "H4", baggage: "6", delay: 20 },
};
const errorCode = (code: string) => (error: unknown) => error instanceof FlightTrackerError && error.code === code;
const options = { scheduledAt: "2026-10-06T16:00:00Z", airportCode: "ORD" };

test("normalizes IATA / ICAO flight numbers and rejects unsafe input", () => {
  assert.equal(normalizeFlightNumber(" aa - 123 "), "AA123");
  assert.equal(normalizeFlightNumber("UAL1234"), "UAL1234");
  assert.equal(normalizeFlightNumber("6E123"), "6E123");
  assert.equal(normalizeFlightNumber("U2123"), "U2123");
  for (const value of ["", "123", "AA", "AA123?access_key=bad", "../AA123"]) assert.throws(() => normalizeFlightNumber(value), errorCode("INVALID_FLIGHT"));
});
test("maps status, scheduled / estimated / actual timestamps, terminal and baggage correctly", async () => {
  let config: any;
  const tracker = createFlightTracker({ now: () => at, getApiKey: () => "test-only-key", client: { get: async (_url, input) => { config = input; return { data: { data: [record] } }; } } });
  const flight = await tracker("AA 123", options);
  assert.equal(config.params.flight_iata, "AA123");
  assert.equal(config.timeout, 8000);
  assert.equal(config.maxRedirects, 0);
  assert.equal(flight.airlineName, "American Airlines");
  assert.equal(flight.flightStatus, "active");
  assert.equal(flight.scheduledArrivalTime, "2026-10-06T16:00:00.000Z");
  assert.equal(flight.estimatedArrivalTime, "2026-10-06T16:20:00.000Z");
  assert.equal(flight.arrivalTime, flight.estimatedArrivalTime);
  assert.equal(flight.actualArrivalTime, null);
  assert.equal(flight.departureTime, "2026-10-06T14:10:00.000Z");
  assert.equal(flight.arrivalTerminal, "3");
  assert.equal(flight.baggageBelt, "6");
  assert.equal(flight.arrivalDelayMinutes, 20);
});
test("ICAO queries and null metadata never invent operational details", async () => {
  let config: any;
  const tracker = createFlightTracker({ getApiKey: () => "test-only-key", client: { get: async (_url, input) => { config = input; return { data: { data: [{ flight: { icao: "AAL123" } }] } }; } } });
  const flight = await tracker("AAL123");
  assert.equal(config.params.flight_icao, "AAL123");
  assert.equal(flight.arrivalTerminal, null);
  assert.equal(flight.baggageBelt, null);
  assert.equal(flight.flightStatus, null);
});
test("deduplicates concurrent requests and expires successful cache", async () => {
  let calls = 0, now = at;
  const tracker = createFlightTracker({ now: () => now, getApiKey: () => "test-only-key", client: { get: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 10)); return { data: { data: [record] } }; } } });
  await Promise.all([tracker("AA123", options), tracker("AA123", options)]);
  await tracker("AA123", options);
  assert.equal(calls, 1);
  now += 301_000;
  await tracker("AA123", options);
  assert.equal(calls, 2);
});
test("rejects wrong dates, airports, ambiguous matches and truncated provider pages", async () => {
  const tracker = createFlightTracker({ getApiKey: () => "test-only-key", client: { get: async () => ({ data: { data: [record, { ...record, flight_date: "2026-10-07", departure: { ...record.departure, scheduled: "2026-10-07T14:00:00Z" }, arrival: { ...record.arrival, scheduled: "2026-10-07T16:00:00Z" } }] } }) } });
  assert.equal((await tracker("AA123", options)).flightDate, "2026-10-06");
  await assert.rejects(tracker("AA123"), errorCode("AMBIGUOUS_FLIGHT"));
  await assert.rejects(tracker("AA123", { ...options, scheduledAt: "2026-12-01T16:00:00Z" }), errorCode("NOT_FOUND"));
  await assert.rejects(tracker("AA123", { ...options, airportCode: "DFW" }), errorCode("NOT_FOUND"));
  const truncated = createFlightTracker({ getApiKey: () => "test-only-key", client: { get: async () => ({ data: { pagination: { total: 500 }, data: [record] } }) } });
  await assert.rejects(truncated("AA123", options), errorCode("AMBIGUOUS_FLIGHT"));
});
test("reports missing key, empty / malformed responses, provider errors without leaking secrets", async () => {
  const missing = createFlightTracker({ getApiKey: () => undefined });
  await assert.rejects(missing("AA123"), errorCode("NOT_CONFIGURED"));
  for (const [data, code] of [
    [{ data: [] }, "NOT_FOUND"],
    [{ unexpected: true }, "INVALID_RESPONSE"],
    [{ error: { code: "invalid_access_key", info: "secret-test-key" } }, "PROVIDER_AUTH"],
    [{ error: { code: "usage_limit_reached" } }, "PROVIDER_LIMIT"],
    [{ error: { code: "https_access_restricted" } }, "PROVIDER_PLAN"],
  ] as const) {
    const tracker = createFlightTracker({ getApiKey: () => "test-only-key", client: { get: async () => ({ data }) } });
    await assert.rejects(tracker("AA123"), error => errorCode(code)(error) && !(error as Error).message.includes("secret-test-key"));
  }
});
test("sanitizes transport errors and briefly caches failures", async () => {
  let calls = 0;
  const tracker = createFlightTracker({ getApiKey: () => "test-only-key", client: { get: async () => { calls++; throw new Error("URL contains secret-test-key"); } } });
  await assert.rejects(tracker("AA123"), errorCode("PROVIDER_UNAVAILABLE"));
  await assert.rejects(tracker("AA123"), error => errorCode("PROVIDER_UNAVAILABLE")(error) && !(error as Error).message.includes("secret-test-key"));
  assert.equal(calls, 1);
});
