import { DRIVER_FLIGHT_FRESH_MS, type DriverFlightUpdate, type FlightInfo } from "../shared/flight.js";
import { bookingFlightDistance, normalizeFlightNumber } from "./utils/flightTracker.js";

type BookingContext = {
  flightNumber: string | null;
  flightScheduledAt: Date | null;
  airportCode: string | null;
  isPrivateFBO: boolean;
  flightDetails: unknown;
};
const unavailable = (): DriverFlightUpdate => ({
  state: "unavailable", fetchedAt: null, validUntil: null, source: null, airportRole: null,
  status: null, scheduledTime: null, estimatedTime: null, actualTime: null, terminal: null, gate: null, baggageBelt: null,
});
const instant = (value: unknown): string | null => {
  if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
};
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
function localDate(time: string, timezone: string | null) {
  if (!timezone) return null;
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(time)); }
  catch { return null; }
}

/** Pure projection of persisted staff-validated records; never requests provider data. */
export function driverFlightUpdate(booking: BookingContext, now = Date.now()): DriverFlightUpdate {
  const result = unavailable();
  if (booking.isPrivateFBO || !booking.flightNumber || !booking.flightScheduledAt || !booking.airportCode ||
      !booking.flightDetails || typeof booking.flightDetails !== "object") return result;
  const flight = booking.flightDetails as FlightInfo;
  const context = flight.verifiedBookingContext;
  try {
    if (!context || flight.source !== "AviationStack" ||
        normalizeFlightNumber(booking.flightNumber) !== flight.flightNumber ||
        context.flightNumber !== flight.flightNumber ||
        context.scheduledAt !== booking.flightScheduledAt.toISOString() ||
        context.airportCode !== booking.airportCode.trim().toUpperCase()) return result;
  } catch { return result; }
  // Pin both ends and scheduled occurrence, not just the recurring flight number.
  for (const field of ["flightDate", "departureAirportCode", "arrivalAirportCode", "scheduledDepartureTime", "scheduledArrivalTime"] as const) {
    if (!flight[field] || flight[field] !== context[field]) return result;
  }
  if (!/^[A-Z]{3}$/.test(flight.departureAirportCode!) || !/^[A-Z]{3}$/.test(flight.arrivalAirportCode!) ||
      flight.departureAirportCode === flight.arrivalAirportCode) return result;
  const role = context.airportCode === flight.arrivalAirportCode ? "arrival"
    : context.airportCode === flight.departureAirportCode ? "departure" : null;
  if (!role) return result;
  const scheduled = instant(role === "arrival" ? flight.scheduledArrivalTime : flight.scheduledDepartureTime);
  const departure = instant(flight.scheduledDepartureTime);
  const timezone = role === "arrival" ? flight.arrivalTimezone : flight.departureTimezone;
  const booked = booking.flightScheduledAt.toISOString();
  // Staff lookup's nearest-time ranking alone cannot prove a recurring occurrence.
  // A driver snapshot must match the booked schedule exactly at the relevant airport.
  if (!scheduled || scheduled !== booked || !departure || localDate(departure, flight.departureTimezone) !== flight.flightDate ||
      !localDate(scheduled, timezone) || localDate(scheduled, timezone) !== localDate(booked, timezone) ||
      !Number.isFinite(bookingFlightDistance(flight, { scheduledAt: booked, airportCode: context.airportCode }))) return result;
  const fetchedAt = instant(flight.fetchedAt);
  if (!fetchedAt || Date.parse(fetchedAt) > now) return result;
  const validUntil = new Date(Date.parse(fetchedAt) + DRIVER_FLIGHT_FRESH_MS).toISOString();
  if (now >= Date.parse(validUntil)) return { ...result, state: "stale", source: "AviationStack", fetchedAt, validUntil };
  return {
    state: "current", source: "AviationStack", fetchedAt, validUntil, airportRole: role,
    status: text(flight.flightStatus), scheduledTime: scheduled,
    estimatedTime: instant(role === "arrival" ? flight.estimatedArrivalTime : flight.estimatedDepartureTime),
    actualTime: instant(role === "arrival" ? flight.actualArrivalTime : flight.actualDepartureTime),
    terminal: text(role === "arrival" ? flight.arrivalTerminal : flight.departureTerminal),
    gate: text(role === "arrival" ? flight.arrivalGate : flight.departureGate),
    baggageBelt: role === "arrival" ? text(flight.baggageBelt) : null,
  };
}
