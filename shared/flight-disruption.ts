import { driverFlightUpdate } from "./driver-flight-update.js";

export type FlightDisruption = {
  key: string; status: "cancelled" | "diverted"; message: string; fetchedAt: string; validUntil: string;
};
export function flightDisruption(booking: {
  flightNumber?: string | null; flightScheduledAt?: string | Date | null; airportCode?: string | null;
  isPrivateFBO?: boolean; flightDetails?: unknown;
}, now = Date.now()): FlightDisruption | null {
  const scheduled = booking.flightScheduledAt ? new Date(booking.flightScheduledAt) : null;
  if (!scheduled || !Number.isFinite(scheduled.getTime())) return null;
  const update = driverFlightUpdate({
    flightNumber: booking.flightNumber || null, flightScheduledAt: scheduled,
    airportCode: booking.airportCode || null, isPrivateFBO: !!booking.isPrivateFBO,
    flightDetails: booking.flightDetails,
  }, now);
  const status = update.status?.toLowerCase();
  if (update.state !== "current" || !update.fetchedAt || !update.validUntil ||
      !["cancelled", "canceled", "diverted"].includes(status || "")) return null;
  const disruption = status === "diverted" ? "diverted" : "cancelled";
  return {
    key: `${booking.flightNumber}:${scheduled.toISOString()}:${booking.airportCode}:${disruption}`,
    status: disruption, fetchedAt: update.fetchedAt, validUntil: update.validUntil,
    message: `Flight ${booking.flightNumber} is reported ${disruption}. Review the booking with dispatch; the booked pickup time is unchanged.`,
  };
}
