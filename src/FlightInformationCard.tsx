import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Clock3, Plane, RefreshCw } from "lucide-react";
import type { BookingFlightMetadata, FlightInfo } from "../shared/flight";
import "./flight-information-card.css";

type FlightSuccess = { flight: FlightInfo; stale: boolean; cached: boolean };
type FlightProblem = { error?: string; code?: string; flight?: FlightInfo | null; stale?: boolean };
type Props = { rideId: string; booking: BookingFlightMetadata };
type FlightState = {
  flight: FlightInfo | null;
  source: "live" | "cached" | "last-known" | null;
  updatedAt: string | null;
  error: string | null;
  loading: boolean;
};

const REFRESH_INTERVAL = 5 * 60 * 1000;
const NOT_PROVIDED = "Not provided";

function humanizeStatus(status: string | null | undefined) {
  if (!status || status.trim().toLowerCase() === "unknown") return "Status not confirmed";
  return status.replace(/[_-]+/g, " ").replace(/\b\w/g, character => character.toUpperCase());
}

function validTimezone(timezone: string | null | undefined) {
  if (!timezone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(0);
    return timezone;
  } catch {
    return "UTC";
  }
}

function parseFlightDate(value: string) {
  // Provider timestamps without an explicit offset are treated as UTC, never browser-local.
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00Z`
    : /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatFlightTime(value: string | null | undefined, timezone: string | null | undefined) {
  if (!value) return NOT_PROVIDED;
  const date = parseFlightDate(value);
  if (!date) return NOT_PROVIDED;
  const zone = validTimezone(timezone);
  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
    return `${formatted} · ${zone}`;
  } catch {
    return `${new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    }).format(date)} · UTC`;
  }
}

function formatAttribution(value: string | null) {
  if (!value) return null;
  const date = parseFlightDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="flight-detail"><dt>{label}</dt><dd>{value === null || value === undefined || value === "" ? NOT_PROVIDED : value}</dd></div>;
}

function errorMessage(problem: FlightProblem, status: number) {
  const code = (problem.code || "").toUpperCase();
  const description = (problem.error || "").toLowerCase();
  if (code.includes("API_KEY") || code.includes("KEY_MISSING") || code.includes("NOT_CONFIGURED") || /api key.{0,20}(missing|not configured|invalid)/.test(description)) {
    return "Live flight information is unavailable because the flight provider API key is missing or invalid.";
  }
  if (status === 404 || code.includes("NOT_FOUND")) return "No flight information was found for this flight.";
  if (status === 409 || code.includes("CONFLICT")) return "The flight information could not be matched to this ride.";
  if (status === 429 || code.includes("RATE")) return "Flight information is temporarily rate limited. Try again shortly.";
  if (status === 502 || status === 503 || code.includes("PROVIDER")) {
    return "Live flight information is currently unavailable from the provider.";
  }
  if (status === 400) return "The flight number or ride reference could not be accepted.";
  return problem.error || "Flight information could not be refreshed.";
}

export default function FlightInformationCard({ rideId, booking }: Props) {
  const flightNumber = booking.flightNumber?.trim() || "";
  const initialSnapshot = booking.flightDetails || null;
  const [state, setState] = useState<FlightState>({
    flight: initialSnapshot,
    source: initialSnapshot ? "last-known" : null,
    updatedAt: initialSnapshot?.fetchedAt || null,
    error: null,
    loading: true,
  });
  const inFlight = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const lastAttempt = useRef(0);
  const fetchRef = useRef<() => Promise<void>>(async () => undefined);

  const fetchFlight = useCallback(async () => {
    if (!flightNumber || inFlight.current || document.visibilityState !== "visible") return;
    inFlight.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    lastAttempt.current = Date.now();
    setState(current => ({ ...current, loading: !current.flight, error: null }));
    try {
      const response = await fetch(`/api/flights/${encodeURIComponent(flightNumber)}?rideId=${encodeURIComponent(rideId)}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({})) as FlightSuccess | FlightProblem;
      if (!response.ok) {
        const problem = body as FlightProblem;
        setState(current => ({
          ...current,
          flight: problem.flight || current.flight,
          source: problem.flight || current.flight ? "last-known" : current.source,
          updatedAt: problem.flight?.fetchedAt || current.updatedAt,
          error: errorMessage(problem, response.status),
          loading: false,
        }));
        return;
      }
      const result = body as FlightSuccess;
      if (!result.flight || typeof result.flight.flightNumber !== "string") {
        setState(current => ({ ...current, source: current.flight ? "last-known" : null, error: "The flight provider returned no usable flight information.", loading: false }));
        return;
      }
      setState({
        flight: result.flight,
        source: result.stale || result.cached ? "cached" : "live",
        updatedAt: result.flight.fetchedAt || null,
        error: null,
        loading: false,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState(current => ({
        ...current,
        source: current.flight ? "last-known" : null,
        error: "Live flight information could not be reached. The last-known snapshot is still shown when available.",
        loading: false,
      }));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        inFlight.current = false;
      }
    }
  }, [flightNumber, rideId]);

  fetchRef.current = fetchFlight;
  useEffect(() => {
    inFlight.current = false;
    lastAttempt.current = 0;
    setState({
      flight: initialSnapshot,
      source: initialSnapshot ? "last-known" : null,
      updatedAt: initialSnapshot?.fetchedAt || null,
      error: null,
      loading: true,
    });
    void fetchRef.current();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - lastAttempt.current >= REFRESH_INTERVAL) {
        void fetchRef.current();
      }
    }, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastAttempt.current >= REFRESH_INTERVAL) {
        void fetchRef.current();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibility);
      controllerRef.current?.abort();
      controllerRef.current = null;
      inFlight.current = false;
    };
  }, [flightNumber, rideId, initialSnapshot]);

  const flight = state.flight;
  const status = humanizeStatus(flight?.flightStatus);
  const statusKnown = Boolean(flight?.flightStatus && flight.flightStatus.trim().toLowerCase() !== "unknown");
  const fetchedAt = formatAttribution(state.updatedAt);
  const depZone = flight?.departureTimezone;
  const arrZone = flight?.arrivalTimezone;

  return (
    <section className="drawer-block flight-information-card" aria-labelledby="flight-card-title" aria-busy={state.loading}>
      <header className="flight-card-header">
        <div className="flight-card-title-wrap">
          <span className="flight-card-icon" aria-hidden="true"><Plane /></span>
          <div>
            <p className="drawer-label">Flight information</p>
            <h3 id="flight-card-title">{flight?.flightNumber || flightNumber || NOT_PROVIDED}</h3>
          </div>
        </div>
        <button className="flight-refresh-button" type="button" onClick={() => void fetchRef.current()} disabled={state.loading || inFlight.current} aria-label="Refresh flight information">
          <RefreshCw aria-hidden="true" />
          <span>{state.loading && !flight ? "Loading" : "Refresh"}</span>
        </button>
      </header>

      <div className="flight-card-meta">
        <span>{flight?.airlineName || booking.airlineName || NOT_PROVIDED}</span>
        <span className={`flight-status ${statusKnown ? "is-known" : "is-unknown"}`} aria-label={`Flight status: ${status}`}>
          <i aria-hidden="true" />{status}
        </span>
      </div>

      {!flight && state.loading && (
        <div className="flight-loading" role="status" aria-live="polite">
          <span className="flight-skeleton flight-skeleton-wide" />
          <span className="flight-skeleton" />
          <span className="flight-skeleton" />
          <span className="flight-skeleton flight-skeleton-wide" />
        </div>
      )}

      {(flight || (!state.loading && !flight)) && (
        <>
          <div className="flight-airports" aria-label="Flight route">
            <div className="flight-airport">
              <span className="flight-airport-label">Departure</span>
              <b>{flight?.departureAirportCode || NOT_PROVIDED}</b>
              <small>{flight?.departureAirport || NOT_PROVIDED}</small>
            </div>
            <span className="flight-route-line" aria-hidden="true" />
            <div className="flight-airport flight-airport-arrival">
              <span className="flight-airport-label">Arrival</span>
              <b>{flight?.arrivalAirportCode || NOT_PROVIDED}</b>
              <small>{flight?.arrivalAirport || NOT_PROVIDED}</small>
            </div>
          </div>

          <div className="flight-timings">
            <section className="flight-timing-group" aria-label="Departure times">
              <h4><Clock3 aria-hidden="true" />Departure</h4>
              <dl>
                <Detail label="Scheduled" value={formatFlightTime(flight?.scheduledDepartureTime, depZone)} />
                <Detail label="Estimated" value={formatFlightTime(flight?.estimatedDepartureTime, depZone)} />
                <Detail label="Actual" value={formatFlightTime(flight?.actualDepartureTime, depZone)} />
              </dl>
            </section>
            <section className="flight-timing-group" aria-label="Arrival times">
              <h4><Clock3 aria-hidden="true" />Arrival</h4>
              <dl>
                <Detail label="Scheduled" value={formatFlightTime(flight?.scheduledArrivalTime, arrZone)} />
                <Detail label="Estimated" value={formatFlightTime(flight?.estimatedArrivalTime, arrZone)} />
                <Detail label="Actual" value={formatFlightTime(flight?.actualArrivalTime, arrZone)} />
              </dl>
            </section>
          </div>

          <dl className="flight-logistics">
            <Detail label="Departure terminal" value={flight?.departureTerminal} />
            <Detail label="Departure gate" value={flight?.departureGate} />
            <Detail label="Arrival terminal" value={flight?.arrivalTerminal} />
            <Detail label="Arrival gate" value={flight?.arrivalGate} />
            <Detail label="Baggage claim belt" value={flight?.baggageBelt} />
            <Detail label="Departure delay" value={flight?.departureDelayMinutes == null ? null : `${flight?.departureDelayMinutes} min`} />
            <Detail label="Arrival delay" value={flight?.arrivalDelayMinutes == null ? null : `${flight?.arrivalDelayMinutes} min`} />
          </dl>
        </>
      )}

      {state.error && <p className="flight-card-message flight-card-error" role="alert"><AlertCircle aria-hidden="true" />{state.error}</p>}
      {!flight && !state.loading && !state.error && <p className="flight-card-message">No flight information is available yet.</p>}
      {flight && (
        <footer className={`flight-card-attribution ${state.source === "last-known" ? "is-last-known" : ""}`}>
          <span>{state.source === "live" ? "Live information · AviationStack" : state.source === "cached" ? "Cached provider information · AviationStack" : "Last-known snapshot · not live"}</span>
          <small>{fetchedAt ? `Fetched ${fetchedAt}` : "Fetch time not provided"}</small>
        </footer>
      )}
      {!flight && state.error && <p className="flight-card-empty-note">A live refresh will be attempted automatically while this ride is open.</p>}
      {!flight && !flightNumber && <p className="flight-card-message">No flight number is attached to this ride.</p>}
      <span className="sr-only" aria-live="polite">{state.loading && flight ? "Refreshing flight information" : ""}</span>
    </section>
  );
}
