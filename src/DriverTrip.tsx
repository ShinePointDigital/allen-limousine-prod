import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Clock3, MapPin, Navigation, RefreshCw, ShieldCheck, UserRound, Users, CarFront } from "lucide-react";
import { driverNavigationUrls, nextDriverTripStatus, type DriverTripNextStatus } from "./driver-trip-logic";
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
  paymentStatus: string | null;
  hasCardAuthorization: boolean;
  fareCents: number | null;
  gratuityCents: number;
  authorizedTotalCents: number | null;
};

type PageState = "loading" | "ready" | "expired" | "error";
const money = (cents: number | null) => cents == null ? "Not available" : new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(cents / 100);

const statusText: Record<string, string> = {
  ASSIGNED: "Assigned",
  CONFIRMED: "Confirmed",
  EN_ROUTE: "En route",
  IN_PROGRESS: "Picked up",
  COMPLETED: "Completed",
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

export default function DriverTrip({ token }: { token: string }) {
  const [trip, setTrip] = useState<DriverTripRecord | null>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedStop, setSelectedStop] = useState<"pickup" | "dropoff">("pickup");
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
        setMessage("Payment capture could not be confirmed from this response. The latest trip and payment status are shown. Retry completion if still in progress, or ask dispatch to capture.");
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
            <span>{trip.status === "COMPLETED" ? "Trip closed. The payment status below reflects the trip record." : "Follow each step in order. Updates are shared with dispatch."}</span>
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
            <nav className="driver-trip-nav-links" aria-label="Choose a navigation app">
              {navigationLinks.map(link => <a href={link.href} key={link.label} target="_blank" rel="noopener noreferrer">
                {link.icon}<span>{link.label}</span>
              </a>)}
            </nav>
            <p className="driver-trip-note">Choose an app to open directions. Navigation never starts automatically.</p>
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

        <section className="driver-trip-panel" aria-labelledby="driver-trip-payment-heading">
          <div className="driver-trip-panel-heading"><ShieldCheck /><h2 id="driver-trip-payment-heading">Payment status</h2></div>
          <div className="driver-trip-details">
            <div className="driver-trip-detail"><small>Card total</small><b>{money(trip.authorizedTotalCents)}</b></div>
            <div className="driver-trip-detail"><small>Capture</small><b>{trip.paymentStatus === "succeeded" ? "Captured" : trip.paymentStatus === "requires_capture" ? "Authorized — awaiting capture" : trip.paymentStatus?.replaceAll("_", " ") || "No card authorization recorded"}</b></div>
          </div>
          <p className="driver-trip-note" style={{ padding: "0 17px 16px", marginTop: "-4px" }}>{trip.hasCardAuthorization ? "Includes the authorized gratuity. No card details or separate payment controls are available on this page." : "No card authorization is recorded for this trip. Contact dispatch for payment handling."}</p>
        </section>

        {message && <p className="driver-trip-error" role="alert">{message}</p>}
        {nextStatus && <button className="driver-trip-action" type="button" disabled={saving} onClick={() => void transition(nextStatus)}>
          {saving ? "Confirming with dispatch…" : actionLabel[nextStatus]}
        </button>}
        {trip.status === "COMPLETED" && <p className="driver-trip-note" role="status">This trip is complete and no further status changes are available.</p>}
        {trip.status === "IN_PROGRESS" && <p className="driver-trip-note">{trip.hasCardAuthorization ? <>Confirming completion captures the authorized card total of <strong>{money(trip.authorizedTotalCents)}</strong>, including gratuity. Already captured payments are not charged again.</> : "Completion updates this trip only. No card authorization is recorded; contact dispatch for payment handling."}</p>}
        {!nextStatus && trip.status !== "COMPLETED" && <p className="driver-trip-note">This trip is not currently available for a driver status update. Contact dispatch if you believe this is incorrect.</p>}
        <p className="driver-trip-note"><UserRound aria-hidden="true" style={{ width: 14, verticalAlign: "middle", marginRight: 4 }} />Updates reflect the trip record confirmed by dispatch.</p>
      </main>}
      {confirmComplete && trip?.status === "IN_PROGRESS" && <div className="driver-trip-confirm-backdrop">
        <section className="driver-trip-confirm" role="dialog" aria-modal="true" aria-labelledby="driver-trip-confirm-title">
          <p className="driver-trip-eyebrow">Final step</p>
          <h2 id="driver-trip-confirm-title">{actionTitle.COMPLETED}</h2>
          <p>{trip.hasCardAuthorization ? "Confirm the passenger has been dropped off. This will mark the trip complete and capture the authorized card amount once." : "Confirm the passenger has been dropped off. This marks the trip complete only; no card authorization is recorded. Contact dispatch for payment handling."}</p>
          <dl className="driver-trip-confirm-amounts">
            <div><dt>Fare</dt><dd>{money(trip.fareCents)}</dd></div>
            <div><dt>Gratuity</dt><dd>{money(trip.gratuityCents)}</dd></div>
            <div className="driver-trip-confirm-total"><dt>Authorized total</dt><dd>{money(trip.authorizedTotalCents)}</dd></div>
          </dl>
          <p className="driver-trip-note">{trip.hasCardAuthorization ? "The total shown is the existing card authorization. Completing the trip submits capture and completion together." : "The amounts above are booking records, not proof of a card authorization or payment."}</p>
          <div className="driver-trip-confirm-actions">
            <button type="button" onClick={() => setConfirmComplete(false)} disabled={saving}>Not yet</button>
            <button type="button" onClick={() => void transition("COMPLETED")} disabled={saving}>{saving ? "Confirming…" : "Confirm drop-off"}</button>
          </div>
        </section>
      </div>}
    </div>
  </div>;
}
