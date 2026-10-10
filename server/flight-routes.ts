import { Router, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import { staffGuard } from "./account-routes.js";
import { hasAccess } from "../shared/access.js";
import { getRideById, saveBookingFlightMetadata } from "./store.js";
import { FlightTrackerError, normalizeFlightNumber, trackFlight } from "./utils/flightTracker.js";

export function createFlightRouter({
  guard = staffGuard,
  lookup = trackFlight,
  getRide = getRideById,
  saveMetadata = saveBookingFlightMetadata,
}: {
  guard?: RequestHandler;
  lookup?: (...args: Parameters<typeof trackFlight>) => ReturnType<typeof trackFlight>;
  getRide?: typeof getRideById;
  saveMetadata?: typeof saveBookingFlightMetadata;
} = {}) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false,
    message: { code: "RATE_LIMIT", error: "Too many flight requests. Please try again shortly." },
  });
  router.get("/:flightNumber", guard, (req, res, next) => {
    if (!hasAccess(res.locals.user, "rides")) return res.status(403).json({ error: "Rides access is required to track flights.", code: "FORBIDDEN" });
    next();
  }, limiter, async (req, res) => {
    res.set("Cache-Control", "no-store");
    let previous = null;
    try {
      const flightNumber = normalizeFlightNumber(String(req.params.flightNumber));
      const rideId = req.query.rideId;
      if (rideId !== undefined && (typeof rideId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(rideId))) {
        return res.status(400).json({ code: "INVALID_BOOKING", error: "Invalid ride reference." });
      }
      const ride = typeof rideId === "string" ? await getRide(rideId) : null;
      if (rideId && !ride) return res.status(404).json({ code: "BOOKING_NOT_FOUND", error: "Ride not found." });
      if (ride && (!ride.inquiry.flightNumber || normalizeFlightNumber(ride.inquiry.flightNumber) !== flightNumber)) {
        return res.status(400).json({ code: "FLIGHT_MISMATCH", error: "This flight number is not attached to the selected booking." });
      }
      previous = ride?.inquiry.flightDetails?.flightNumber === flightNumber ? ride.inquiry.flightDetails : null;
      const flight = await lookup(flightNumber, ride ? {
        scheduledAt: ride.inquiry.flightScheduledAt || ride.inquiry.pickupAt,
        airportCode: ride.inquiry.airportCode || undefined,
      } : {});
      if (ride) {
        const bookingContext = {
          flightNumber: ride.inquiry.flightNumber!,
          flightScheduledAt: ride.inquiry.flightScheduledAt,
          pickupAt: ride.inquiry.pickupAt,
          airportCode: ride.inquiry.airportCode,
        };
        const saved = await saveMetadata(ride.inquiryId, ride.inquiry.flightNumber!, flight, bookingContext);
        if (!saved) return res.status(409).json({ code: "BOOKING_CHANGED", error: "The booking changed while retrieving its flight. Reopen the ride." });
      }
      res.json({ flight, stale: false, cached: Date.now() - Date.parse(flight.fetchedAt) > 1000 });
    } catch (error) {
      if (error instanceof FlightTrackerError) {
        return res.status(error.status).json({ error: error.message, code: error.code, flight: previous, stale: Boolean(previous) });
      }
      // Do not expose database errors, provider request configuration, or secrets.
      res.status(500).json({ error: "Flight information could not be saved. Please try again.", code: "FLIGHT_STORAGE_ERROR", flight: previous, stale: Boolean(previous) });
    }
  });
  return router;
}
