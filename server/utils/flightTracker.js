import axios from "axios";

const CACHE_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 300;
export class FlightTrackerError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = "FlightTrackerError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeFlightNumber(value) {
  const normalized = String(value || "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4}[A-Z]?)$/.test(normalized)) {
    throw new FlightTrackerError("INVALID_FLIGHT", "Enter a flight number such as AA123 or UAL123.", 400);
  }
  return normalized;
}

const text = value => typeof value === "string" && value.trim() ? value.trim().slice(0, 200) : null;
const instant = value => {
  // Never interpret an unzoned provider timestamp using the server's local timezone.
  if (!text(value) || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const delay = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

export function mapFlight(record, flightNumber, fetchedAt) {
  const departure = record.departure || {};
  const arrival = record.arrival || {};
  const scheduledDepartureTime = instant(departure.scheduled);
  const estimatedDepartureTime = instant(departure.estimated);
  const actualDepartureTime = instant(departure.actual);
  const scheduledArrivalTime = instant(arrival.scheduled);
  const estimatedArrivalTime = instant(arrival.estimated);
  const actualArrivalTime = instant(arrival.actual);
  return {
    source: "AviationStack",
    flightNumber,
    flightDate: text(record.flight_date),
    airlineName: text(record.airline?.name),
    flightStatus: text(record.flight_status),
    departureAirport: text(departure.airport),
    departureAirportCode: text(departure.iata),
    departureTimezone: text(departure.timezone),
    arrivalAirport: text(arrival.airport),
    arrivalAirportCode: text(arrival.iata),
    arrivalTimezone: text(arrival.timezone),
    scheduledDepartureTime, estimatedDepartureTime, actualDepartureTime,
    scheduledArrivalTime, estimatedArrivalTime, actualArrivalTime,
    departureTime: actualDepartureTime || estimatedDepartureTime || scheduledDepartureTime,
    arrivalTime: actualArrivalTime || estimatedArrivalTime || scheduledArrivalTime,
    departureTerminal: text(departure.terminal),
    arrivalTerminal: text(arrival.terminal),
    departureGate: text(departure.gate),
    arrivalGate: text(arrival.gate),
    baggageBelt: text(arrival.baggage),
    departureDelayMinutes: delay(departure.delay),
    arrivalDelayMinutes: delay(arrival.delay),
    fetchedAt,
  };
}

function providerError(code) {
  if (/access_key|inactive_user|authentication|unauthorized/.test(code)) {
    return new FlightTrackerError("PROVIDER_AUTH", "Flight tracking is unavailable: the AviationStack key needs attention.", 503);
  }
  if (/limit|quota|usage/.test(code)) {
    return new FlightTrackerError("PROVIDER_LIMIT", "AviationStack's request allowance has been reached. Try again later.", 503);
  }
  if (/function_access|https_access|subscription|plan/.test(code)) {
    return new FlightTrackerError("PROVIDER_PLAN", "The AviationStack plan does not support this request over HTTPS.", 503);
  }
  return new FlightTrackerError("PROVIDER_ERROR", "AviationStack could not supply flight information. Try again later.");
}

export function createFlightTracker({ client = axios, getApiKey = () => process.env.AVIATIONSTACK_API_KEY, now = () => Date.now() } = {}) {
  const cache = new Map();
  const pending = new Map();
  async function fetchRecords(flightNumber) {
    if (!getApiKey()) throw new FlightTrackerError("NOT_CONFIGURED", "Flight tracking is not configured. Add AVIATIONSTACK_API_KEY to server secrets.", 503);
    const cached = cache.get(flightNumber);
    if (cached?.expiresAt > now()) {
      if (cached.error) throw cached.error;
      return cached.result;
    }
    if (pending.has(flightNumber)) return pending.get(flightNumber);
    const work = (async () => {
      try {
        const code = flightNumber.match(/^([A-Z]{3}|[A-Z][A-Z0-9]|[0-9][A-Z])/)[1];
        const response = await client.get("https://api.aviationstack.com/v1/flights", {
          params: { access_key: getApiKey(), [code.length === 3 ? "flight_icao" : "flight_iata"]: flightNumber, limit: 100 },
          timeout: 8000,
          maxRedirects: 0,
          maxContentLength: 2 * 1024 * 1024,
        });
        if (response.data?.error) throw providerError(String(response.data.error.code || ""));
        if (!Array.isArray(response.data?.data)) throw new FlightTrackerError("INVALID_RESPONSE", "AviationStack returned an invalid flight response.");
        const fetchedAt = new Date(now()).toISOString();
        const records = response.data.data
          .filter(record => record && (record.flight?.iata?.toUpperCase() === flightNumber || record.flight?.icao?.toUpperCase() === flightNumber))
          .map(record => mapFlight(record, flightNumber, fetchedAt));
        const result = { records, truncated: Number(response.data.pagination?.total || 0) > response.data.data.length };
        cache.delete(flightNumber);
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        cache.set(flightNumber, { result, expiresAt: now() + CACHE_MS });
        return result;
      } catch (error) {
        // Axios errors contain request URLs/configuration (including the key). Never propagate or log them.
        const safeError = error instanceof FlightTrackerError ? error
          : error?.response?.data?.error ? providerError(String(error.response.data.error.code || ""))
          : error?.response?.status === 401 || error?.response?.status === 403 ? providerError("access_key")
          : error?.response?.status === 429 ? providerError("limit")
          : new FlightTrackerError("PROVIDER_UNAVAILABLE", "AviationStack is temporarily unavailable. Try again shortly.");
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
        cache.set(flightNumber, { error: safeError, expiresAt: now() + 30_000 });
        throw safeError;
      }
    })();
    pending.set(flightNumber, work);
    try { return await work; } finally { pending.delete(flightNumber); }
  }
  return async function trackFlight(value, { scheduledAt, airportCode } = {}) {
    const flightNumber = normalizeFlightNumber(value);
    if (scheduledAt && !Number.isFinite(Date.parse(scheduledAt))) throw new FlightTrackerError("INVALID_DATE", "The booking flight time is invalid.", 400);
    const { records, truncated } = await fetchRecords(flightNumber);
    if (truncated) throw new FlightTrackerError("AMBIGUOUS_FLIGHT", "AviationStack returned too many matching flights to identify this trip safely.", 409);
    const airport = airportCode?.toUpperCase();
    const candidates = airport ? records.filter(f => f.arrivalAirportCode === airport || f.departureAirportCode === airport) : records;
    if (!candidates.length) throw new FlightTrackerError("NOT_FOUND", "No flight information is available for this flight and airport yet.", 404);
    if (!scheduledAt) {
      if (candidates.length !== 1) throw new FlightTrackerError("AMBIGUOUS_FLIGHT", "Provide a booking to identify the correct flight date and airport.", 409);
      return candidates[0];
    }
    const reference = Date.parse(scheduledAt);
    const ranked = candidates.map(flight => {
      const times = airport === flight.arrivalAirportCode ? [flight.scheduledArrivalTime]
        : airport === flight.departureAirportCode ? [flight.scheduledDepartureTime]
        : [flight.scheduledArrivalTime, flight.scheduledDepartureTime];
      const distances = times.filter(Boolean).map(value => Math.abs(Date.parse(value) - reference));
      return { flight, distance: distances.length ? Math.min(...distances) : Infinity };
    }).filter(item => item.distance <= 12 * 60 * 60_000).sort((a, b) => a.distance - b.distance);
    if (!ranked.length) throw new FlightTrackerError("NOT_FOUND", "Flight data is not available for the booking's flight date. Future flights may not be published yet.", 404);
    if (ranked.length > 1 && ranked[0].distance === ranked[1].distance) throw new FlightTrackerError("AMBIGUOUS_FLIGHT", "The provider returned multiple matching flights. Verify the booking flight details.", 409);
    return ranked[0].flight;
  };
}

export const trackFlight = createFlightTracker();
