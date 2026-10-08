import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import {
  AlertCircle, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronRight,
  Clock3, MapPin, MessageSquareText, RefreshCw, ShieldCheck, UserRound, X,
} from "lucide-react";
import type { DispatchWizardSnapshot, DispatchWizardStep, WizardSmsPreview } from "../../shared/dispatch-wizard";
import "./DispatchWizardModal.css";

type Props = {
  bookingId: string;
  onClose: () => void;
  onUpdated?: () => void;
  onManageRide?: (rideId: string) => void;
};

type ApiFailure = { error?: string; snapshot?: DispatchWizardSnapshot };

const stepTitles: Record<DispatchWizardStep, string> = {
  1: "Review",
  2: "Assign",
  3: "SMS",
  4: "Done",
};

const isSmsAttempt = (sms: WizardSmsPreview) => ["RESERVED", "PENDING", "SENT"].includes(sms.status);

function formatPickup(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "Not provided";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "long", day: "numeric", year: "numeric",
  }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

function StatusPill({ status }: { status: WizardSmsPreview["status"] }) {
  const readable = status.toLowerCase().replaceAll("_", " ");
  return <span className={`dw-status dw-status-${status.toLowerCase()}`}>{readable}</span>;
}

function SmsCard({
  label, sms, onReconcile, busy, reconciliationValue, onReconciliationValue,
}: {
  label: string;
  sms: WizardSmsPreview;
  onReconcile: () => void;
  busy: boolean;
  reconciliationValue: string;
  onReconciliationValue: (value: string) => void;
}) {
  const pending = sms.status === "PENDING";
  const accepted = sms.status === "SENT";
  const skipped = sms.status === "SKIPPED";
  return <article className="dw-sms-card">
    <header className="dw-sms-head">
      <div className="dw-sms-recipient"><span className="dw-sms-icon"><MessageSquareText aria-hidden="true" /></span>
        <div><span className="dw-overline">{label}</span><b>{sms.toPhone || "No number on file"}</b></div>
      </div>
      <StatusPill status={sms.status} />
    </header>
    <div className="dw-sms-body">{sms.body || "No message preview is available."}</div>
    {sms.deliveryStatus && <p className="dw-delivery-status">Provider status: {sms.deliveryStatus}</p>}
    {sms.providerMessageId && <p className="dw-provider-id">Provider SID <code>{sms.providerMessageId}</code></p>}
    {sms.errorMessage && <p className="dw-sms-error"><AlertCircle aria-hidden="true" />{sms.errorMessage}</p>}
    {accepted && <p className="dw-status-note">Accepted by the messaging provider. Delivery is not guaranteed.</p>}
    {skipped && <p className="dw-status-note">This notification was skipped. Customer messages may be skipped for consent or STOP preferences.</p>}
    {pending && <div className="dw-reconcile">
      <div className="dw-reconcile-copy"><strong>Delivery state is uncertain.</strong><span>Reconcile the existing attempt before taking any further action. This will not resend the message.</span></div>
      <label className="dw-field">Provider message SID <span className="dw-optional">optional</span>
        <input value={reconciliationValue} onChange={event => onReconciliationValue(event.target.value)} placeholder="SM…" autoComplete="off" />
      </label>
      <button type="button" className="dw-button dw-button-secondary" onClick={onReconcile} disabled={busy}>
        {busy ? <RefreshCw className="dw-spinning" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />} Reconcile attempt
      </button>
    </div>}
  </article>;
}

export default function DispatchWizardModal({ bookingId, onClose, onUpdated, onManageRide }: Props) {
  const [snapshot, setSnapshot] = useState<DispatchWizardSnapshot | null>(null);
  const [viewStep, setViewStep] = useState<DispatchWizardStep>(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [addDriverOpen, setAddDriverOpen] = useState(false);
  const [newDriver, setNewDriver] = useState({ name: "", phone: "" });
  const [newDriverError, setNewDriverError] = useState("");
  const [reconcileValues, setReconcileValues] = useState<Record<string, string>>({});
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const hasNotifications = useMemo(() => Boolean(snapshot &&
    (isSmsAttempt(snapshot.messages.driver) || isSmsAttempt(snapshot.messages.customer))), [snapshot]);
  const completed = snapshot?.completed || snapshot?.step === 4;

  const loadSnapshot = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/dispatch`, {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error((data as ApiFailure).error || "Unable to load this dispatch.");
      const next = data as DispatchWizardSnapshot;
      setSnapshot(next);
      setViewStep(next.step);
      setDriverId(next.assignment.driverId || "");
      setVehicleId(next.assignment.vehicleId || "");
      setLoading(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load this dispatch.");
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusFirst = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
    });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter(element => !element.hasAttribute("hidden") && element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFirst);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, []);

  const postSnapshot = async (url: string, body: Record<string, unknown>, successMessage?: string) => {
    if (saving) return;
    setSaving(true);
    setError("");
    setFieldError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({})) as ApiFailure | DispatchWizardSnapshot;
      if (!response.ok) {
        if ("snapshot" in data && data.snapshot) setSnapshot(data.snapshot);
        throw new Error(("error" in data && data.error) || "The dispatch could not be updated.");
      }
      const next = data as DispatchWizardSnapshot;
      setSnapshot(next);
      setViewStep(next.step);
      setDriverId(next.assignment.driverId || "");
      setVehicleId(next.assignment.vehicleId || "");
      if (successMessage) setError("");
      onUpdated?.();
      setSaving(false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The dispatch could not be updated.";
      setError(message);
      setSaving(false);
      // The server may have persisted a version change despite a failed response; always reconcile state.
      await loadSnapshot(false);
      setError(message);
    }
  };

  const runReview = () => {
    if (!snapshot || snapshot.step !== 1 || saving) return;
    void postSnapshot(`/api/admin/bookings/${encodeURIComponent(bookingId)}/review`, { version: snapshot.version });
  };

  const saveAssignment = () => {
    if (!snapshot || ![2, 3].includes(snapshot.step) || hasNotifications || saving) return;
    if (!driverId || !vehicleId) {
      setFieldError("Choose an available chauffeur and vehicle to continue.");
      return;
    }
    const driver = snapshot.drivers.find(item => item.id === driverId);
    const vehicle = snapshot.vehicles.find(item => item.id === vehicleId);
    if (!driver?.available || !vehicle?.available) {
      setFieldError("One of those selections is no longer available. Refresh the dispatch and choose again.");
      return;
    }
    void postSnapshot(`/api/admin/bookings/${encodeURIComponent(bookingId)}/assign`, {
      action: "save", version: snapshot.version, driverId, vehicleId,
    });
  };

  const dispatch = () => {
    if (!snapshot || snapshot.step !== 3 || snapshot.blocked || completed || saving) return;
    if (snapshot.messages.driver.status === "PENDING" || snapshot.messages.customer.status === "PENDING") return;
    void postSnapshot(`/api/admin/bookings/${encodeURIComponent(bookingId)}/assign`, {
      action: "dispatch", version: snapshot.version,
    });
  };

  const createDriver = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const name = newDriver.name.trim();
    const phone = newDriver.phone.trim();
    if (!name || !phone) {
      setNewDriverError("Enter the chauffeur’s name and phone number.");
      return;
    }
    setSaving(true);
    setNewDriverError("");
    setError("");
    try {
      const response = await fetch("/api/admin/chauffeurs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const data = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(data.error || "Unable to add this chauffeur.");
      setAddDriverOpen(false);
      setNewDriver({ name: "", phone: "" });
      await loadSnapshot(false);
      onUpdated?.();
      setSaving(false);
    } catch (reason) {
      setNewDriverError(reason instanceof Error ? reason.message : "Unable to add this chauffeur.");
      setSaving(false);
      await loadSnapshot(false);
    }
  };

  const reconcile = async (sms: WizardSmsPreview) => {
    if (!snapshot?.assignment.rideId || !sms.attemptId || saving) return;
    const key = sms.attemptId;
    const providerMessageId = (reconcileValues[key] || "").trim();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/rides/${encodeURIComponent(snapshot.assignment.rideId)}/dispatch/${encodeURIComponent(key)}/reconcile`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(providerMessageId ? { providerMessageId } : {}),
      });
      const data = await response.json().catch(() => ({})) as ApiFailure;
      if (!response.ok) throw new Error(data.error || "Unable to reconcile this notification.");
      await loadSnapshot(false);
      setSaving(false);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Unable to reconcile this notification.";
      await loadSnapshot(false);
      setError(message);
      setSaving(false);
    }
  };

  const clickBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  const stepNavigation = (step: DispatchWizardStep) => setViewStep(step);

  if (loading) return <div className="dw-backdrop" onMouseDown={clickBackdrop}>
    <section className="dw-dialog dw-loading-dialog" role="dialog" aria-modal="true" aria-labelledby="dw-loading-title" ref={dialogRef} tabIndex={-1}>
      <header className="dw-topline"><div><span className="dw-overline">Allan Limousine · Operations</span><h2 id="dw-loading-title">Dispatching a reservation</h2></div><button className="dw-close" onClick={onClose} aria-label="Close dispatch dialog" data-dialog-initial-focus><X /></button></header>
      <div className="dw-skeleton" aria-label="Loading dispatch details"><i /><i /><i /><i /></div>
      <p className="dw-loading-copy">Retrieving the latest booking and assignment status…</p>
    </section>
  </div>;

  if (!snapshot) return <div className="dw-backdrop" onMouseDown={clickBackdrop}>
    <section className="dw-dialog dw-load-error" role="dialog" aria-modal="true" aria-labelledby="dw-error-title" ref={dialogRef} tabIndex={-1}>
      <header className="dw-topline"><div><span className="dw-overline">Allan Limousine · Operations</span><h2 id="dw-error-title">Dispatch unavailable</h2></div><button className="dw-close" onClick={onClose} aria-label="Close dispatch dialog" data-dialog-initial-focus><X /></button></header>
      <div className="dw-alert" role="alert"><AlertCircle aria-hidden="true" /><span>{error || "We couldn’t retrieve this reservation."}</span></div>
      <div className="dw-footer"><button className="dw-button dw-button-secondary" onClick={() => void loadSnapshot()}><RefreshCw aria-hidden="true" /> Try again</button><button className="dw-text-button" onClick={onClose}>Close</button></div>
    </section>
  </div>;

  const driver = snapshot.drivers.find(item => item.id === (snapshot.assignment.driverId || driverId));
  const vehicle = snapshot.vehicles.find(item => item.id === (snapshot.assignment.vehicleId || vehicleId));
  const pendingNotification = snapshot.messages.driver.status === "PENDING" || snapshot.messages.customer.status === "PENDING";
  const blockedDispatch = Boolean(snapshot.blocked) || pendingNotification || completed;
  const sendLabel = snapshot.messages.driver.status === "FAILED" || snapshot.messages.customer.status === "FAILED"
    ? "Retry unsent notifications" : "Confirm & dispatch";
  const isReadOnlyAssignment = hasNotifications || completed;

  return <div className="dw-backdrop" onMouseDown={clickBackdrop}>
    <section className="dw-dialog" role="dialog" aria-modal="true" aria-labelledby="dw-title" aria-describedby="dw-description" ref={dialogRef} tabIndex={-1}>
      <header className="dw-topline">
        <div><span className="dw-overline">Allan Limousine <span className="dw-overline-sep">/</span> Operations</span><h2 id="dw-title">Dispatch <em>reservation</em></h2><p id="dw-description">Review the booking, confirm the assignment, then authorize notifications.</p></div>
        <button type="button" className="dw-close" onClick={onClose} aria-label="Close dispatch dialog" data-dialog-initial-focus><X /></button>
      </header>

      <nav className="dw-steps" aria-label="Dispatch steps">
        {([1, 2, 3, 4] as DispatchWizardStep[]).map((step, index) => {
          const isPast = step < snapshot.step;
          const active = viewStep === step;
          return <button key={step} type="button" className={`dw-step ${active ? "is-active" : ""} ${isPast ? "is-persisted" : ""}`} aria-current={active ? "step" : undefined} aria-disabled={step > snapshot.step} disabled={step > snapshot.step} onClick={() => stepNavigation(step)}>
            <span className="dw-step-number">{isPast ? <Check aria-hidden="true" /> : `0${step}`}</span><span className="dw-step-label">{stepTitles[step]}</span>
            {index < 3 && <ChevronRight className="dw-step-chevron" aria-hidden="true" />}
          </button>;
        })}
      </nav>

      {error && <div className="dw-alert dw-inline-alert" role="alert"><AlertCircle aria-hidden="true" /><span>{error}</span></div>}

      <div className="dw-content" key={viewStep}>
        {viewStep === 1 && <section className="dw-step-panel" aria-labelledby="dw-review-heading">
          <div className="dw-section-heading"><div><span className="dw-overline">01 / Verify details</span><h3 id="dw-review-heading">Reservation review</h3></div><span className={`dw-booking-state ${snapshot.booking.status.toLowerCase().replaceAll("_", "-")}`}>{snapshot.booking.status.replaceAll("_", " ")}</span></div>
          <div className="dw-customer-band"><span className="dw-avatar"><UserRound aria-hidden="true" /></span><div><strong>{snapshot.booking.fullName || "Name not provided"}</strong><a href={`tel:${snapshot.booking.phone.replace(/[^\d+]/g, "")}`}>{snapshot.booking.phone || "No phone on file"}</a></div><span className="dw-class-tag">{snapshot.booking.vehicleClass || "Vehicle class not specified"}</span></div>
          <div className="dw-route-card">
            <div className="dw-route-line" aria-hidden="true"><i /><span /><i /></div>
            <div className="dw-route-point"><span className="dw-overline">Pickup</span><b>{snapshot.booking.pickup || "Not provided"}</b></div>
            <div className="dw-route-point"><span className="dw-overline">Destination</span><b>{snapshot.booking.destination || "Not provided"}</b></div>
          </div>
          <div className="dw-detail-row">
            <div><span className="dw-detail-icon"><Clock3 aria-hidden="true" /></span><span><small>Pickup date</small><b>{formatPickup(snapshot.booking.pickupAt)}</b></span></div>
            <div><span className="dw-detail-icon"><Clock3 aria-hidden="true" /></span><span><small>Pickup time</small><b>{formatTime(snapshot.booking.pickupAt) || "Not provided"}</b></span></div>
          </div>
          {snapshot.booking.reviewedAt && <p className="dw-review-note"><ShieldCheck aria-hidden="true" /> Reservation details already reviewed.</p>}
          {snapshot.blocked && <p className="dw-blocked-note"><AlertCircle aria-hidden="true" />{snapshot.blocked}</p>}
        </section>}

        {viewStep === 2 && <section className="dw-step-panel" aria-labelledby="dw-assignment-heading">
          <div className="dw-section-heading"><div><span className="dw-overline">02 / Select resources</span><h3 id="dw-assignment-heading">Chauffeur & vehicle</h3></div><span className="dw-roster-count">{snapshot.drivers.filter(item => item.available).length} chauffeurs · {snapshot.vehicles.filter(item => item.available).length} vehicles available</span></div>
          {isReadOnlyAssignment && <p className="dw-lock-note"><ShieldCheck aria-hidden="true" /> Notifications have been reserved or attempted. Assignment is locked to protect the recorded dispatch.</p>}
          <div className="dw-select-grid">
            <label className="dw-field">Available chauffeur
              <select value={driverId} onChange={event => { setDriverId(event.target.value); setFieldError(""); }} disabled={isReadOnlyAssignment || saving}>
                <option value="">Choose a chauffeur</option>
                {snapshot.drivers.map(item => <option value={item.id} key={item.id} disabled={!item.available}>{item.name} · {item.phone}{item.available ? "" : " · Unavailable"}</option>)}
              </select>
            </label>
            <label className="dw-field">Available vehicle
              <select value={vehicleId} onChange={event => { setVehicleId(event.target.value); setFieldError(""); }} disabled={isReadOnlyAssignment || saving}>
                <option value="">Choose a vehicle</option>
                {snapshot.vehicles.map(item => <option value={item.id} key={item.id} disabled={!item.available}>{item.name} · {item.category}{item.available ? "" : " · Unavailable"}</option>)}
              </select>
            </label>
          </div>
          {!snapshot.drivers.length && !isReadOnlyAssignment && <div className="dw-empty-roster">
            {!addDriverOpen ? <><div><strong>No chauffeurs in the roster.</strong><span>Add a real roster entry to make an assignment.</span></div><button type="button" className="dw-button dw-button-secondary" onClick={() => { setAddDriverOpen(true); setNewDriverError(""); }}>Add chauffeur</button></> :
              <form className="dw-add-driver" onSubmit={createDriver}>
                <div className="dw-add-driver-heading"><strong>Add chauffeur to roster</strong><button type="button" className="dw-icon-button" aria-label="Cancel adding chauffeur" onClick={() => setAddDriverOpen(false)}><X /></button></div>
                <label className="dw-field">Full name<input autoFocus value={newDriver.name} onChange={event => setNewDriver(current => ({ ...current, name: event.target.value }))} maxLength={120} required /></label>
                <label className="dw-field">Phone number<input type="tel" value={newDriver.phone} onChange={event => setNewDriver(current => ({ ...current, phone: event.target.value }))} autoComplete="tel" required /></label>
                {newDriverError && <p className="dw-field-error" role="alert">{newDriverError}</p>}
                <div className="dw-add-actions"><button type="button" className="dw-text-button" onClick={() => setAddDriverOpen(false)}>Cancel</button><button type="submit" className="dw-button dw-button-primary" disabled={saving}>{saving ? "Adding…" : "Add to roster"}</button></div>
              </form>}
          </div>}
          {!snapshot.vehicles.length && <p className="dw-no-vehicles">No vehicles are currently listed in the dispatch roster.</p>}
          {fieldError && <p className="dw-field-error" role="alert">{fieldError}</p>}
          {(driver || vehicle) && <div className="dw-assignment-summary">
            {driver && <span><UserRound aria-hidden="true" /><span><small>Chauffeur</small><b>{driver.name}</b><em>{driver.phone}</em></span></span>}
            {vehicle && <span><MapPin aria-hidden="true" /><span><small>Vehicle</small><b>{vehicle.name}</b><em>{vehicle.category}</em></span></span>}
          </div>}
        </section>}

        {viewStep === 3 && <section className="dw-step-panel" aria-labelledby="dw-notifications-heading">
          <div className="dw-section-heading"><div><span className="dw-overline">03 / Final confirmation</span><h3 id="dw-notifications-heading">Notification preview</h3></div><span className="dw-persisted-label"><ShieldCheck aria-hidden="true" /> Persisted preview</span></div>
          <p className="dw-preview-intro">Review the messages saved for this assignment. Confirming dispatch submits these notifications exactly as shown.</p>
          <div className="dw-assigned-strip"><span>{snapshot.assignment.driverName || driver?.name || "Chauffeur not assigned"}</span><i aria-hidden="true">·</i><span>{snapshot.assignment.vehicleName || vehicle?.name || "Vehicle not assigned"}</span></div>
          <div className="dw-sms-list">
            <SmsCard label="Chauffeur notification" sms={snapshot.messages.driver} onReconcile={() => void reconcile(snapshot.messages.driver)} busy={saving} reconciliationValue={reconcileValues[snapshot.messages.driver.attemptId || ""] || ""} onReconciliationValue={value => setReconcileValues(current => ({ ...current, [snapshot.messages.driver.attemptId || ""]: value }))} />
            <SmsCard label="Client notification" sms={snapshot.messages.customer} onReconcile={() => void reconcile(snapshot.messages.customer)} busy={saving} reconciliationValue={reconcileValues[snapshot.messages.customer.attemptId || ""] || ""} onReconciliationValue={value => setReconcileValues(current => ({ ...current, [snapshot.messages.customer.attemptId || ""]: value }))} />
          </div>
          {pendingNotification && <p className="dw-blocked-note"><Clock3 aria-hidden="true" /> A notification is still PENDING. Reconcile it first; do not resend.</p>}
          {snapshot.blocked && <p className="dw-blocked-note"><AlertCircle aria-hidden="true" />{snapshot.blocked}</p>}
          {completed && <p className="dw-complete-note"><CheckCircle2 aria-hidden="true" />Dispatch is complete. Previously accepted messages remain untouched.</p>}
          {(snapshot.messages.driver.status === "FAILED" || snapshot.messages.customer.status === "FAILED") && !completed && !pendingNotification && <p className="dw-retry-note">Only unsent notifications are eligible for retry. Messages already accepted by the provider remain untouched.</p>}
          {snapshot.messages.customer.status === "SKIPPED" && <p className="dw-retry-note">Client notification is skipped; this can reflect consent settings or a STOP request.</p>}
        </section>}

        {viewStep === 4 && <section className="dw-step-panel dw-complete-panel" aria-labelledby="dw-complete-heading">
          <span className="dw-complete-mark"><CheckCircle2 aria-hidden="true" /></span><span className="dw-overline">Dispatch record · {snapshot.booking.id}</span>
          <h3 id="dw-complete-heading">Dispatch <em>recorded.</em></h3>
          <p>Assignment and notification statuses are recorded below. Provider acceptance does not confirm message delivery.</p>
          <div className="dw-complete-summary"><div><small>Chauffeur</small><b>{snapshot.assignment.driverName || "Not assigned"}</b></div><div><small>Vehicle</small><b>{snapshot.assignment.vehicleName || "Not assigned"}</b></div></div>
          <div className="dw-complete-statuses"><span>Chauffeur SMS <StatusPill status={snapshot.messages.driver.status} /></span><span>Client SMS <StatusPill status={snapshot.messages.customer.status} /></span></div>
          {snapshot.blocked && <p className="dw-blocked-note">{snapshot.blocked}</p>}
        </section>}
      </div>

      <footer className="dw-footer">
        <div className="dw-footer-left">
          {viewStep > 1 && <button type="button" className="dw-text-button" onClick={() => setViewStep((viewStep - 1) as DispatchWizardStep)}><ArrowLeft aria-hidden="true" /> Back</button>}
          {snapshot.step > viewStep && <span className="dw-history-note">Viewing an earlier step · persisted progress is unchanged</span>}
        </div>
        <div className="dw-footer-actions">
          {viewStep < 3 && viewStep !== 4 && <button type="button" className="dw-button dw-button-primary" onClick={viewStep === 1 ? runReview : saveAssignment} disabled={saving || (viewStep === 1 ? snapshot.step !== 1 : snapshot.step < 2 || isReadOnlyAssignment)}>
            {saving ? "Saving…" : viewStep === 1 ? "Confirm review" : "Save assignment"} {saving ? null : <ArrowRight aria-hidden="true" />}
          </button>}
          {viewStep === 3 && !completed && <button type="button" className="dw-button dw-button-primary" onClick={dispatch} disabled={saving || snapshot.step !== 3 || blockedDispatch}>
            {saving ? "Dispatching…" : sendLabel} {saving ? null : <ArrowRight aria-hidden="true" />}
          </button>}
          {(viewStep === 4 || completed) && <button type="button" className="dw-button dw-button-primary" onClick={onClose}>Done <Check aria-hidden="true" /></button>}
          {onManageRide && snapshot.assignment.rideId && <button type="button" className="dw-button dw-button-secondary" disabled={saving} onClick={() => onManageRide(snapshot.assignment.rideId!)}>Trip controls</button>}
          {viewStep !== 4 && !completed && <button type="button" className="dw-text-button dw-close-text" onClick={onClose}>Close</button>}
        </div>
      </footer>
    </section>
  </div>;
}
