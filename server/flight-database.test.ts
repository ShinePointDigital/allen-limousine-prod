import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { getRideById, saveBookingFlightMetadata } from "./store.js";
import { mapFlight } from "./utils/flightTracker.js";

test("verified flight metadata persists and never overwrites the passenger's scheduled time", { skip: process.env.RUN_DATABASE_FLIGHT_TESTS !== "true" }, async () => {
  const db = new PrismaClient();
  let inquiryId: string | undefined;
  try {
    const inquiry = await db.inquiry.create({ data: { fullName: "Temporary Flight Test", email: `flight-${crypto.randomUUID()}@example.test`, phone: "+13125550100", serviceType: "Airport", pickupAt: new Date("2026-10-06T16:30:00Z"), pickup: "ORD", destination: "Chicago", passengers: 1, flightNumber: "AA 123", flightScheduledAt: new Date("2026-10-06T16:00:00Z") } });
    inquiryId = inquiry.id;
    const ride = await db.ride.create({ data: { inquiryId } });
    const flight = mapFlight({ flight_status: "active", airline: { name: "American" }, arrival: { scheduled: "2026-10-06T16:00:00Z", estimated: "2026-10-06T16:15:00Z", terminal: "3", baggage: "6" } }, "AA123", new Date().toISOString());
    assert.equal(await saveBookingFlightMetadata(inquiryId, "AA 123", flight), true);
    const saved = await db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } });
    assert.equal(saved.airlineName, "American");
    assert.equal(saved.arrivalTime!.toISOString(), "2026-10-06T16:15:00.000Z");
    assert.equal(saved.baggageBelt, "6");
    assert.equal(saved.flightScheduledAt!.toISOString(), "2026-10-06T16:00:00.000Z");
    assert.deepEqual(saved.flightDetails, flight);
    const mapped = await getRideById(ride.id);
    assert.equal(mapped!.inquiry.flightNumber, "AA 123");
    assert.equal(mapped!.inquiry.arrivalTerminal, "3");
    assert.equal(mapped!.inquiry.flightDetails!.scheduledArrivalTime, flight.scheduledArrivalTime);
    await db.inquiry.update({ where: { id: inquiryId }, data: { flightNumber: "UA999" } });
    assert.equal(await saveBookingFlightMetadata(inquiryId, "AA 123", flight), false);
    assert.equal((await db.inquiry.findUniqueOrThrow({ where: { id: inquiryId } })).flightNumber, "UA999");
  } finally {
    if (inquiryId) await db.inquiry.delete({ where: { id: inquiryId } });
    await db.$disconnect();
  }
});
