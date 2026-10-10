import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock3, MapPin, Navigation, Plane, RefreshCw, ShieldCheck, UserRound, Users, CarFront } from "lucide-react";
import { driverNavigationUrls, nextDriverTripStatus, type DriverTripNextStatus } from "./driver-trip-logic";
import type { DriverFlightUpdate } from "../shared/flight";
import "./driver-trip.css";

type DriverTripRecord = {
  reference: string;
  customerName: string;
  pickupAt: string;
  pickup: string;
  destination: string;
  serviceType: string;
  passengers: number;
  chauffeurName: string;
  vehicleName: string;
  status: string;
  airportCode: string | null;
  airportTerminal: string | null;
  flightNumber: string | null;
  flightScheduledAt: string | null;
  airlineName: string | null;
  pickupPreference: string | null;
  isPrivateFBO: boolean;
  specificTailNumber: string | null;
  principalName: string | null;
  fboName: string | null;
  tarmacInstructions: string | null;
  flightUpdate?: DriverFlightUpdate | null;
};

type PageState = "loading" | "ready" | "expired" | "error";

const statusText: Record<string, string> = {
  ASSIGNED: "Assigned",
  CONFIRMED: "Confirmed",
  EN_ROUTE: "En route",
  IN_PROGRESS: "Picked up",
  COMPLETED: "Completed",
};

const providerFlightStatusText: Record<string, string> = {
  active: "In flight",
  landed: "Landed",
  scheduled: "Scheduled",
  cancelled: "Canceled",
  canceled: "Canceled",
  diverted: "Diverted",
  delayed: "Delayed",
};

function DriverTripSkeleton() {
  return <main className="driver-trip-main" aria-label="Loading trip details" aria-busy="true">
    <div className="driver-trip-skeleton driver-trip-skeleton-line" style={{ width: "34%" }} />
    <div className="driver-trip-skeleton driver-trip-skeleton-large" />
    <div className="driver-trip-skeleton" style={{ height: 170, marginBottom: 14 }} />
    <div className="driver-trip-skeleton" style={{ height: 118 }} />
    <div className="driver-trip-skeleton driver-trip-skeleton-large" />
  </main>;
}

function DriverTripHeader({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) {
  return <header className="driver-trip-header">
    <div className="driver-trip-brand">
      <img src="/allan-limousine-logo.png" alt="Allan Limousine" />
      <small>Chauffeur trip</small>
    </div>
    <button className="driver-trip-refresh" type="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh trip details">
      <RefreshCw className={refreshing ? "driver-trip-refreshing" : ""} aria-hidden="true" /> Refresh
    </button>
  </header>;
}

function DriverTripState({ state, retry }: { state: "expired" | "error"; retry: () => void }) {
  const expired = state === "expired";
  return <main className="driver-trip-state" role={expired ? "status" : "alert"}>
    <div className="driver-trip-state-mark">{expired ? <ShieldCheck /> : <AlertTriangle />}</div>
    <p className="driver-trip-eyebrow">{expired ? "Secure trip access" : "Connection issue"}</p>
    <h1>{expired ? "This trip link is unavailable." : "Trip details could not load."}</h1>
    <p>{expired
      ? "This secure driver link may have expired, been reassigned, or been disabled. Contact dispatch for a current trip link."
      : "Check your connection and try again. Your trip status is always confirmed by dispatch, not this device."}</p>
    {!expired && <button className="driver-trip-retry" type="button" onClick={retry}>Try again</button>}
  </main>;
}

function formatProviderTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  });
}

function formatProviderFetchedAt(value: string | null) {
  if (!value) return "Not provided";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  });
}

export default function DriverTrip({ token }: { token: string }) {
  const [trip, setTrip] = useState<DriverTripRecord | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedStop, setSelectedStop] = useState<"pickup" | "dropoff">("pickup");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const requestRef = useRef(0);
  const tripRef = useRef<DriverTripRecord | null>(null);
  tripRef.current = trip;

  useLayoutEffect(() => {
    const prior = document.querySelector('meta[name="referrer"]');
    const previousContent = prior?.getAttribute("content") ?? null;
    const meta = prior || document.createElement("meta");
    meta.setAttribute("name", "referrer");
    meta.setAttribute("content", "no-referrer");
    if (!prior) document.head.appendChild(meta);
    return () => {
      if (previousContent === null) meta.remove();
      else meta.setAttribute("content", previousContent);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const loadTrip = useCallback(async (quiet = false) => {
    const requestId = ++requestRef.current;
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch(`/api/driver/trips/${encodeURIComponent(token)}`, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (requestId !== requestRef.current) return null;
      if (response.status === 404) {
        setTrip(null);
        setPageState("expired");
        setMessage("");
        return null;
      }
      if (!response.ok) throw new Error("Trip details could not be refreshed.");
      const data = await response.json() as { trip: DriverTripRecord };
      setTrip(data.trip);
      setPageState("ready");
      return data.trip;
    } catch {
      if (requestId === requestRef.current) {
        if (!tripRef.current) setPageState("error");
        else setMessage("Could not refresh the latest trip status. The last confirmed details remain visible.");
      }
      return null;
    } finally {
      if (requestId === requestRef.current) setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void loadTrip();
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadTrip(true);
    }, 25_000);
    const onFocus = () => { void loadTrip(true); };
    const onVisibility = () => { if (document.visibilityState === "visible") void loadTrip(true); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      requestRef.current += 1;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadTrip]);

  const nextStatus = useMemo(() => trip ? nextDriverTripStatus(trip.status) : null, [trip]);

  const progressIndex = trip?.status === "COMPLETED" ? 2
    : trip?.status === "IN_PROGRESS" ? 1
      : trip?.status === "EN_ROUTE" ? 0 : -1;
  const actionLabel: Record<DriverTripNextStatus, string> = {
    EN_ROUTE: "Confirm — en route to pickup",
    IN_PROGRESS: "Confirm passenger picked up",
    COMPLETED: "Complete trip",
  };
  const actionTitle: Record<DriverTripNextStatus, string> = {
    EN_ROUTE: "Confirm you are en route",
    IN_PROGRESS: "Confirm passenger pickup",
    COMPLETED: "Complete this trip?",
  };
  const transition = async (status: DriverTripNextStatus) => {
    if (!trip || saving) return;
    if (status === "COMPLETED" && !confirmComplete) {
      setConfirmComplete(true);
      return;
    }
    setSaving(true);
    setMessage("");
    setConfirmComplete(false);
    try {
      const response = await fetch(`/api/driver/trips/${encodeURIComponent(token)}/status`, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ status }),
      });
      if (response.ok) {
        const data = await response.json() as { trip: DriverTripRecord };
        setTrip(data.trip);
        setPageState("ready");
        return;
      }
      if (response.status === 404) {
        setTrip(null);
        setPageState("expired");
        return;
      }
      if (response.status === 409) {
        await loadTrip(true);
        setMessage("Trip status changed elsewhere. The latest confirmed status is shown; continue from there.");
        return;
      }
      if (response.status === 402) {
        await loadTrip(true);
        setMessage("Trip completion could not be confirmed. The latest trip status is shown. Retry completion if still in progress, or contact dispatch.");
        return;
      }
      // A server or network response can be uncertain; only a canonical GET may confirm completion.
      const latest = await loadTrip(true);
      setMessage(latest?.status === "COMPLETED"
        ? "The latest trip status confirms completion."
        : "We could not confirm that update. The latest trip status is shown; retry only when the trip is ready.");
    } catch {
      const latest = await loadTrip(true);
      setMessage(latest?.status === "COMPLETED"
        ? "The latest trip status confirms completion."
        : "Connection interrupted before the update could be confirmed. The latest trip status is shown; retry when ready.");
    } finally {
      setSaving(false);
    }
  };

  const targetAddress = trip ? (selectedStop === "pickup" ? trip.pickup : trip.destination) : "";
  const airportDetails = trip ? [
    { label: "Airport", value: trip.airportCode },
    { label: "Booked terminal", value: trip.airportTerminal },
    { label: "Flight number", value: trip.flightNumber },
    { label: "Airline", value: trip.airlineName },
    { label: "Booked flight time", value: trip.flightScheduledAt ? new Date(trip.flightScheduledAt).toLocaleString("en-US", {
      weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      timeZone: "America/Chicago", timeZoneName: "short",
    }) : null },
    { label: "Pickup instructions", value: trip.pickupPreference },
    { label: "Airport service", value: trip.isPrivateFBO ? "Private aviation" : null },
    { label: "FBO", value: trip.fboName },
    { label: "Aircraft tail number", value: trip.specificTailNumber },
    { label: "Principal passenger", value: trip.principalName },
    { label: "Tarmac / ramp instructions", value: trip.tarmacInstructions },
  ].filter(detail => detail.value?.trim()) : [];
  const hasCommercialFlight = !!trip?.flightNumber?.trim() && !trip.isPrivateFBO;
  const flightUpdate = hasCommercialFlight ? trip?.flightUpdate : null;
  const flightUpdateState: DriverFlightUpdate["state"] = !flightUpdate || flightUpdate.state === "unavailable"
    ? "unavailable"
    : flightUpdate.state === "stale" || !flightUpdate.validUntil
      || !Number.isFinite(Date.parse(flightUpdate.validUntil))
      || clockNow >= Date.parse(flightUpdate.validUntil)
      ? "stale"
      : "current";
  const providerSchedule = flightUpdate?.scheduledTime ?? null;
  const providerEstimated = flightUpdate?.estimatedTime ?? null;
  const providerActual = flightUpdate?.actualTime ?? null;
  const providerGateLabel = flightUpdate?.airportRole === "departure" ? "Departure gate" : "Arrival gate";
  const rawFlightStatus = flightUpdate?.status?.trim();
  const mappedFlightStatus = rawFlightStatus ? providerFlightStatusText[rawFlightStatus.toLowerCase()] : null;
  const providerFlightStatus = typeof mappedFlightStatus === "string" ? mappedFlightStatus : rawFlightStatus || "Not provided";
  const scheduleDifference = (candidate: string | null) => {
    if (!candidate || !providerSchedule) return false;
    const candidateMs = Date.parse(candidate);
    const scheduledMs = Date.parse(providerSchedule);
    return Number.isFinite(candidateMs) && Number.isFinite(scheduledMs) && candidateMs !== scheduledMs;
  };
  const bookedTerminalDiffers = !!flightUpdate?.terminal?.trim()
    && !!trip?.airportTerminal?.trim()
    && flightUpdate.terminal.trim().toLocaleLowerCase() !== trip.airportTerminal.trim().toLocaleLowerCase();
  const providerTimeLabel = flightUpdate?.airportRole === "departure" ? "Departure" : "Arrival";
  const navigationUrls = driverNavigationUrls(targetAddress);
  const navigationLinks = [
    { label: "Google Maps", href: navigationUrls.google, icon: <Navigation aria-hidden="true" /> },
    { label: "Apple Maps", href: navigationUrls.apple, icon: <MapPin aria-hidden="true" /> },
    { label: "Waze", href: navigationUrls.waze, icon: <Navigation aria-hidden="true" /> },
  ];

  return <div className="driver-trip-page">
    <div className="driver-trip-shell">
      <DriverTripHeader onRefresh={() => void loadTrip()} refreshing={refreshing} />
      {pageState === "loading" && <DriverTripSkeleton />}
      {(pageState === "expired" || pageState === "error") && <DriverTripState state={pageState} retry={() => void loadTrip()} />}
      {pageState === "ready" && trip && <main className="driver-trip-main">
        <section className="driver-trip-intro">
          <p className="driver-trip-eyebrow">Today’s assignment</p>
          <h1>Hello, {trip.chauffeurName || "Chauffeur"}.</h1>
          <p className="driver-trip-reference">TRIP {trip.reference}</p>
        </section>

        <section className="driver-trip-status-card" aria-live="polite">
          <span className="driver-trip-status-mark">{trip.status === "COMPLETED" ? <Check /> : <CarFront />}</span>
          <div className="driver-trip-status-copy">
            <b>{statusText[trip.status] || trip.status.replaceAll("_", " ")}</b>
            <span>{trip.status === "COMPLETED" ? "Trip closed. Completion has been confirmed with dispatch." : "Follow each step in order. Updates are shared with dispatch."}</span>
          </div>
          <span className="driver-trip-status-chip">{trip.status === "COMPLETED" ? "Closed" : "Current"}</span>
        </section>

        <ol className="driver-trip-progress" aria-label="Trip progress">
          {["En route", "Picked up", "Completed"].map((step, index) => {
            const isDone = progressIndex >= index;
            return <li className={isDone ? "done" : ""} key={step} aria-current={progressIndex === index ? "step" : undefined}>
              <i>{isDone && index < progressIndex ? <Check /> : index + 1}</i><span>{step}</span>
            </li>;
          })}
        </ol>

        <section className="driver-trip-panel" aria-labelledby="driver-trip-route-heading">
          <div className="driver-trip-panel-heading"><MapPin /><h2 id="driver-trip-route-heading">Trip route</h2></div>
          <div className="driver-trip-route">
            <div className="driver-trip-route-point">
              <MapPin aria-hidden="true" />
               <div><small>Pickup</small><b>{trip.pickup}</b><time dateTime={trip.pickupAt}>{new Date(trip.pickupAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" })}</time></div>
            </div>
            <div className="driver-trip-route-point">
              <MapPin aria-hidden="true" />
              <div><small>Drop-off</small><b>{trip.destination}</b></div>
            </div>
          </div>
          <div className="driver-trip-navigation">
            <label htmlFor="driver-navigation-stop">Open directions for</label>
            <select id="driver-navigation-stop" value={selectedStop} onChange={event => setSelectedStop(event.target.value as "pickup" | "dropoff")}>
              <option value="pickup">Pickup · {trip.pickup}</option>
              <option value="dropoff">Drop-off · {trip.destination}</option>
            </select>
            <nav className="driver-trip-nav-links" aria-label="Choose a navigation app" aria-describedby="driver-trip-return-reminder">
              {navigationLinks.map(link => <a href={link.href} key={link.label} target="_blank" rel="noopener noreferrer">
                {link.icon}<span>{link.label}</span>
              </a>)}
            </nav>
            <p className="driver-trip-note">Choose an app to open directions. Navigation never starts automatically.</p>
            <p className="driver-trip-note" id="driver-trip-return-reminder"><strong>After navigation, return to this trip page to confirm pickup or completion.</strong> Switch back to your browser’s original tab, or reopen your trip link from the SMS. Update your status only when safely parked.</p>
          </div>
        </section>

        <section className="driver-trip-panel" aria-labelledby="driver-trip-details-heading">
          <div className="driver-trip-panel-heading"><Clock3 /><h2 id="driver-trip-details-heading">Ride details</h2></div>
          <div className="driver-trip-details">
            <div className="driver-trip-detail"><small>Customer</small><b>{trip.customerName}</b></div>
            <div className="driver-trip-detail"><small>Service</small><b>{trip.serviceType}</b></div>
            <div className="driver-trip-detail"><small>Vehicle</small><b>{trip.vehicleName}</b></div>
            <div className="driver-trip-detail"><small>Passengers</small><b><Users aria-hidden="true" style={{ width: 14, verticalAlign: "middle", marginRight: 5 }} />{trip.passengers}</b></div>
          </div>
        </section>

        {airportDetails.length > 0 && <section className="driver-trip-panel" aria-labelledby="driver-trip-airport-heading">
          <div className="driver-trip-panel-heading"><Plane /><h2 id="driver-trip-airport-heading">Flight &amp; airport details</h2></div>
          <div className="driver-trip-details">
            {airportDetails.map(detail => <div className="driver-trip-detail" key={detail.label}>
              <small>{detail.label}</small><b style={{ whiteSpace: "pre-wrap" }}>{detail.value}</b>
            </div>)}
          </div>
          <p className="driver-trip-note" style={{ padding: "0 17px 16px" }}>Saved booking details. Follow the booked pickup time above; contact dispatch if flight or terminal details change.</p>
          {hasCommercialFlight && <div role="region" aria-label="Verified provider flight updates" aria-live="polite" style={{ borderTop: "1px solid var(--trip-line)" }}>
            <div className="driver-trip-panel-heading" style={{ paddingTop: 14 }}>
              <Plane aria-hidden="true" />
              <h2>Live flight updates</h2>
            </div>
            <p className="driver-trip-note" style={{ padding: "0 17px 12px" }}>
              Flight information is checked periodically. Provider data may be delayed or unavailable; follow the booked pickup and contact dispatch for changes.
            </p>
            <div className="driver-trip-details">
              <div className="driver-trip-detail">
                <small>Provider status</small>
                <b>{flightUpdateState === "current" ? "Current" : flightUpdateState === "stale" ? "Stale" : "Unavailable"}</b>
              </div>
              <div className="driver-trip-detail">
                <small>Source</small>
                <b>{flightUpdate?.source || "Unavailable"}</b>
              </div>
              <div className="driver-trip-detail" style={{ gridColumn: "1 / -1" }}>
                <small>Fetched at</small>
                <b>{formatProviderFetchedAt(flightUpdate?.fetchedAt ?? null)}</b>
              </div>
            </div>
            {flightUpdateState === "current" && flightUpdate && <div className="driver-trip-details" aria-label="Current provider flight details">
              <div className="driver-trip-detail">
                <small>Provider flight status</small>
                <b>{providerFlightStatus}</b>
              </div>
              <div className="driver-trip-detail">
                <small>Scheduled {providerTimeLabel.toLowerCase()}</small>
                <b>{formatProviderTime(providerSchedule) || "Not provided"}</b>
              </div>
              <div className="driver-trip-detail">
                <small>Estimated {providerTimeLabel.toLowerCase()}</small>
                <b>{formatProviderTime(providerEstimated) || "Not provided"}</b>
                {scheduleDifference(providerEstimated) && <small role="note">Estimated {providerTimeLabel.toLowerCase()} differs from scheduled time.</small>}
              </div>
              <div className="driver-trip-detail">
                <small>Actual {providerTimeLabel.toLowerCase()}</small>
                <b>{formatProviderTime(providerActual) || "Not provided"}</b>
                {scheduleDifference(providerActual) && <small role="note">Actual {providerTimeLabel.toLowerCase()} differs from scheduled time.</small>}
              </div>
              <div className="driver-trip-detail">
                <small>Provider terminal</small>
                <b>{flightUpdate.terminal?.trim() || "Not provided"}</b>
                {bookedTerminalDiffers && <small role="note">Provider terminal differs from booked terminal ({trip.airportTerminal}).</small>}
              </div>
              <div className="driver-trip-detail">
                <small>{providerGateLabel}</small>
                <b>{flightUpdate.gate?.trim() || "Not provided"}</b>
              </div>
              <div className="driver-trip-detail">
                <small>Baggage belt</small>
                <b>{flightUpdate.baggageBelt === null ? "Not provided" : flightUpdate.baggageBelt.trim() || "Not provided"}</b>
              </div>
            </div>}
            {flightUpdateState !== "current" && <p className="driver-trip-note" style={{ padding: "0 17px 16px" }}>
              {flightUpdateState === "stale"
                ? "Provider snapshot is stale. Do not use it for operational decisions; follow the booked pickup and contact dispatch."
                : "No current provider update is available. Follow the booked pickup and contact dispatch for changes."}
            </p>}
          </div>}
        </section>}

        {message && <p className="driver-trip-error" role="alert">{message}</p>}
        {nextStatus && <button className="driver-trip-action" type="button" disabled={saving} onClick={() => void transition(nextStatus)}>
          {saving ? "Confirming with dispatch…" : actionLabel[nextStatus]}
        </button>}
        {trip.status === "COMPLETED" && <p className="driver-trip-note" role="status">This trip is complete and no further status changes are available.</p>}
        {trip.status === "IN_PROGRESS" && <p className="driver-trip-note">Complete the trip only after the passenger has been dropped off.</p>}
        {!nextStatus && trip.status !== "COMPLETED" && <p className="driver-trip-note">This trip is not currently available for a driver status update. Contact dispatch if you believe this is incorrect.</p>}
        <p className="driver-trip-note"><UserRound aria-hidden="true" style={{ width: 14, verticalAlign: "middle", marginRight: 4 }} />Updates reflect the trip record confirmed by dispatch.</p>
      </main>}
      {confirmComplete && trip?.status === "IN_PROGRESS" && <div className="driver-trip-confirm-backdrop">
        <section className="driver-trip-confirm" role="dialog" aria-modal="true" aria-labelledby="driver-trip-confirm-title">
          <p className="driver-trip-eyebrow">Final step</p>
          <h2 id="driver-trip-confirm-title">{actionTitle.COMPLETED}</h2>
          <p>Confirm the passenger has been dropped off. This will mark the trip complete and notify dispatch.</p>
          <div className="driver-trip-confirm-actions">
            <button type="button" onClick={() => setConfirmComplete(false)} disabled={saving}>Not yet</button>
            <button type="button" onClick={() => void transition("COMPLETED")} disabled={saving}>{saving ? "Confirming…" : "Confirm drop-off"}</button>
          </div>
        </section>
      </div>}
    </div>
  </div>;
}
