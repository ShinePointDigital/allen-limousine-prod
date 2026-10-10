import type { FlightInfo } from "./flight.js";

export function normalizeFlightNumber(value: string) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4}[A-Z]?)$/.test(normalized)) throw new Error("Invalid flight number.");
  return normalized;
}
export function bookingFlightDistance(flight: FlightInfo, { scheduledAt, airportCode }: { scheduledAt: string; airportCode?: string }) {
  const airport = airportCode?.trim().toUpperCase();
  if (airport && airport !== flight.arrivalAirportCode && airport !== flight.departureAirportCode) return Infinity;
  const times = airport === flight.arrivalAirportCode ? [flight.scheduledArrivalTime]
    : airport === flight.departureAirportCode ? [flight.scheduledDepartureTime]
    : [flight.scheduledArrivalTime, flight.scheduledDepartureTime];
  const distances = times.filter(Boolean).map(v => Math.abs(Date.parse(v!) - Date.parse(scheduledAt))).filter(Number.isFinite);
  const distance = distances.length ? Math.min(...distances) : Infinity;
  return distance <= 12 * 60 * 60_000 ? distance : Infinity;
}
