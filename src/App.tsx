Scheduled and active work</small></span></div>
    </div>
    <div className="overview-grid operations-grid">
      <section className="panel rides-panel"><div className="panel-header"><div><p className="eyebrow brass">Dispatch queue</p><h2>Upcoming rides</h2></div><Link to="/admin/rides">View all <ArrowRight /></Link></div><div className="ride-table">{data.upcomingRides.map(ride => <RideRow key={ride.id} ride={ride} />)}{!data.upcomingRides.length && <div className="empty-state compact-empty"><CarFront /><p>No upcoming rides yet.</p></div>}</div></section>
      <NotificationsPanel notifications={data.notifications} onChange={load} />
    </div>
  </div>;
}
function NotificationsPanel({ notifications, onChange }: { notifications: AdminNotification[]; onChange: () => void }) {
  const navigate = useNavigate();
  const markRead = async (item: AdminNotification) => { if (!item.readAt) await api(`/api/admin/notifications/${item.id}/read`, { method: "PATCH" }); onChange(); if (item.inquiryId) navigate(`/admin/inquiries?inquiry=${item.inquiryId}`); };
  return <section className="panel notifications-panel"><div className="panel-header"><div><p className="eyebrow brass">Inbox</p><h2>New booking alerts</h2></div><span className="panel-icon"><Bell /></span></div><div className="notification-list">{notifications.map(item => <button key={item.id} className={item.readAt ? "notification-item" : "notification-item unread"} onClick={() => markRead(item)}><i /><span><b>{item.title}</b><small>{item.body}</small><time>{formatDateTime(item.createdAt)}</time></span></button>)}{!notifications.length && <div className="empty-state compact-empty"><Bell /><p>You’re all caught up.</p></div>}</div></section>;
}
function Stat({ label, value, delta, icon, tone = "" }: { label: string; value: string | number; delta: string; icon: React.ReactNode; tone?: string }) { return <div className={`stat-card ${tone}`}><div className="stat-top"><span>{label}</span><span className="stat-icon">{icon}</span></div><strong>{value}</strong><small>{delta}</small></div>; }
function statusClass(status: string) { return `status status-${status.toLowerCase()}`; }
function InquiryRow({ inquiry, onClick }: { inquiry: Inquiry; onClick?: () => void }) { return <div className="inquiry-row" onClick={onClick}><div className="inquiry-person"><span className="person-initials">{inquiry.fullName.split(" ").map(v => v[0]).join("").slice(0, 2)}</span><div><b>{inquiry.fullName}</b><small>{inquiry.serviceType}</small></div></div><div className="inquiry-location"><small>{inquiry.pickup}</small><ArrowRight /><small>{inquiry.destination}</small></div><div className="inquiry-date"><CalendarDays />{formatDate(inquiry.pickupAt)}</div><span className={statusClass(inquiry.status)}>{inquiry.status[0] + inquiry.status.slice(1).toLowerCase()}</span><ChevronLeft className="row-chevron" /></div>; }
function RideRow({ ride, onClick }: { ride: Ride; onClick?: () => void }) {
  return <button className="ride-row" onClick={onClick}><div className="ride-date"><b>{new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(new Date(ride.inquiry.pickupAt))}</b><span>{new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(ride.inquiry.pickupAt))}</span></div><div className="ride-client"><b>{ride.inquiry.fullName}</b><small>{formatDateTime(ride.inquiry.pickupAt)} · {ride.inquiry.serviceType}</small>{ride.inquiry.paymentStatus && <em className={`payment-chip payment-${ride.inquiry.paymentStatus}`}>{titleCaseStatus(ride.inquiry.paymentStatus)}</em>}</div><div className="ride-assignment"><b>{ride.vehicle?.name || "Vehicle unassigned"}</b><small>{ride.driverName || "Chauffeur unassigned"}</small></div><strong className="ride-value">{formatMoney(ride.quoteCents)}</strong><span className={statusClass(ride.status)}>{titleCaseStatus(ride.status)}</span><ChevronLeft className="row-chevron" /></button>;
}
function RidesManager() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [vehicles, setVehicles] = useState<Pick<Vehicle, "id" | "name" | "category" | "description" | "passengers" | "luggage" | "defaultDriverName" | "defaultDriverPhone">[]>([]);
  const [status, setStatus] = useState("ALL");
  const [date, setDate] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [selected, setSelected] = useState<Ride | null>(null);
  const [availableVehicle, setAvailableVehicle] = useState<Pick<Vehicle, "id" | "name" | "category" | "description" | "passengers" | "luggage" | "defaultDriverName" | "defaultDriverPhone"> | null>(null);
  const [deletingVehicleId, setDeletingVehicleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = () => {
    setLoading(true); setError("");
    const query = new URLSearchParams({ status });
    if (date) query.set("date", date);
    if (unassigned) query.set("unassigned", "true");
    api(`/api/admin/rides?${query}`).then(data => { setRides(data.rides); setVehicles(data.vehicles); }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  };
  const removeVehicle = async (event: React.MouseEvent, vehicle: typeof vehicles[number]) => {
    event.stopPropagation();
    if (!window.confirm(`Delete ${vehicle.name} from the available vehicles? The vehicle record will be removed, but its website image will not be deleted.`)) return;
    setDeletingVehicleId(vehicle.id); setError("");
    try { await api(`/api/admin/content/fleet/${vehicle.id}`, { method: "DELETE" }); load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to delete this vehicle."); } finally { setDeletingVehicleId(null); }
  };
  useEffect(() => { load(); }, [status, date, unassigned]);
  return <div className="admin-page">
    <AdminHeader eyebrow="Operations / live schedule" title="Rides & dispatch"><div className="header-actions"><Link className="outline-button dark small" to="/admin/fleet"><Plus /> Add vehicle</Link><Link className="outline-button dark small" to="/admin/inquiries"><Plus /> Review inquiries</Link></div></AdminHeader>
     <div className="dispatch-toolbar"><div className="filter-tabs">{["ALL", "UNASSIGNED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map(item => <button className={status === item ? "selected" : ""} key={item} onClick={() => setStatus(item)}>{item === "ALL" ? "All rides" : titleCaseStatus(item)}</button>)}</div><div className="dispatch-filters"><label>Service date<input type="date" value={date} onChange={event => setDate(event.target.value)} /></label><button className={unassigned ? "assignment-toggle selected" : "assignment-toggle"} onClick={() => setUnassigned(value => !value)}><CarFront /> Needs assignment</button></div></div>
     <section className="panel dispatch-panel"><div className="ride-list-head"><span>Date</span><span>Client & service</span><span>Assignment</span><span>Quote</span><span>Status</span></div>{loading ? <div className="admin-inline-loading"><span className="spinner" />Loading dispatch</div> : error ? <div className="empty-state"><Clock3 /><p>{error}</p><button onClick={load}>Try again</button></div> : <div className="ride-table">{rides.map(ride => <RideRow key={ride.id} ride={ride} onClick={() => setSelected(ride)} />)}{!rides.length && <div className="empty-state"><CarFront /><p>No rides match these filters.</p><small>Available vehicles are listed below and will appear in assignment selectors when a ride is booked.</small></div>}</div>}</section>
     <section className="panel dispatch-fleet-panel"><div className="panel-header"><div><p className="eyebrow brass">Dispatch fleet</p><h2>Available vehicles</h2></div><Link to="/admin/fleet" className="text-button">Manage fleet <ArrowRight /></Link></div><div className="dispatch-fleet-grid">{vehicles.map(vehicle => <article className="dispatch-fleet-card" key={vehicle.id} role="button" tabIndex={0} onClick={() => setAvailableVehicle(vehicle)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") setAvailableVehicle(vehicle); }}><div className="dispatch-fleet-card-top"><div><b>{vehicle.name}</b><small>{vehicle.category} · Up to {vehicle.passengers} guests · {vehicle.luggage}</small></div><div className="dispatch-fleet-card-tools"><span className="active-label"><i />Available</span><button type="button" className="dispatch-fleet-delete" disabled={deletingVehicleId === vehicle.id} aria-label={`Delete ${vehicle.name}`} title="Delete vehicle" onClick={event => removeVehicle(event, vehicle)}>{deletingVehicleId === vehicle.id ? <span className="spinner" /> : <Trash2 />}</button></div></div><div className="dispatch-driver"><span>Default driver</span>{vehicle.defaultDriverName ? <strong>{vehicle.defaultDriverName}<a href={`tel:${vehicle.defaultDriverPhone || ""}`} onClick={event => event.stopPropagation()}>{vehicle.defaultDriverPhone || "Phone not added"}</a></strong> : <strong className="missing-driver">Add driver details in Fleet</strong>}</div><span className="dispatch-fleet-action">View available rides <ArrowUpRight /></span></article>)}{!vehicles.length && <div className="empty-state compact-empty"><CarFront /><p>No active vehicles yet.</p><Link to="/admin/fleet" className="text-button">Add a vehicle <ArrowRight /></Link></div>}</div></section>
     {availableVehicle && <AvailableRidesModal vehicle={availableVehicle} close={() => setAvailableVehicle(null)} refresh={load} />}
    {selected && <RideDetail ride={selected} vehicles={vehicles} close={() => setSelected(null)} refresh={load} />}
  </div>;
}

function AvailableRidesModal({ vehicle, close, refresh }: { vehicle: Pick<Vehicle, "id" | "name" | "category" | "description" | "passengers" | "luggage" | "defaultDriverName" | "defaultDriverPhone">; close: () => void; refresh: () => void }) {
  const [rides, setRides] = useState<Ride[]>([]);
  const [selectedRide, setSelectedRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { api("/api/admin/rides?status=ALL&unassigned=true").then(data => setRides(data.rides)).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false)); }, []);
  const netFare = selectedRide ? Math.max(selectedRide.quoteCents - selectedRide.expenseCents, 0) : 0;
  const sendJob = async () => {
    if (!selectedRide || !vehicle.defaultDriverName || !vehicle.defaultDriverPhone) return;
    setSending(true); setError("");
    try {
      await api(`/api/admin/rides/${selectedRide.id}`, { method: "PATCH", body: JSON.stringify({ status: "ASSIGNED", vehicleId: vehicle.id, driverName: vehicle.defaultDriverName, driverPhone: vehicle.defaultDriverPhone }) });
      const brief = await api(`/api/admin/rides/${selectedRide.id}/dispatch-brief`);
      await api(`/api/admin/rides/${selectedRide.id}/dispatch`, { method: "POST", body: JSON.stringify({ message: brief.brief }) });
      setSent(true); refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "This job could not be sent."); } finally { setSending(false); }
  };
  return <div className="available-rides-backdrop" onClick={close}><section className="available-rides-modal" role="dialog" aria-modal="true" aria-label={`Available rides for ${vehicle.name}`} onClick={event => event.stopPropagation()}><div className="available-rides-top"><div><p className="eyebrow brass">Dispatch / available jobs</p><h2>{vehicle.name}</h2><p>{vehicle.category} · {vehicle.passengers} guests · {vehicle.luggage}</p></div><button type="button" onClick={close} aria-label="Close"><X /></button></div>{sent ? <div className="available-rides-success"><div className="success-icon"><Check /></div><p className="eyebrow brass">Assignment sent</p><h3>{selectedRide?.inquiry.fullName}<br /><em>is on the way.</em></h3><p>{vehicle.defaultDriverName} received the job at {vehicle.defaultDriverPhone}.</p><button type="button" className="solid-button small-button" onClick={close}>Done <ArrowUpRight /></button></div> : selectedRide ? <div className="job-confirmation"><button type="button" className="text-button job-back" onClick={() => { setSelectedRide(null); setError(""); }}><ArrowRight style={{ transform: "rotate(180deg)" }} /> Available rides</button><p className="eyebrow brass">Confirm before sending</p><h3>Send this job<br /><em>to {vehicle.defaultDriverName || "the driver"}.</em></h3><div className="confirm-assignment"><div><span>Vehicle</span><b>{vehicle.name}</b></div><div><span>Driver</span><b>{vehicle.defaultDriverName || "Missing driver"}</b><small>{vehicle.defaultDriverPhone || "Add a phone in Fleet"}</small></div></div><div className="confirm-trip"><span><CalendarDays />{formatDateTime(selectedRide.inquiry.pickupAt)}</span><b>{selectedRide.inquiry.pickup} <ArrowRight /> {selectedRide.inquiry.destination}</b><small>{selectedRide.inquiry.serviceType} · {selectedRide.inquiry.passengers} passenger{selectedRide.inquiry.passengers === 1 ? "" : "s"}</small></div><div className="confirm-fare"><span>Trip fare after admin deductions</span><strong>{formatMoney(netFare)}</strong><small>{formatMoney(selectedRide.quoteCents)} quoted · {formatMoney(selectedRide.expenseCents)} deductions</small></div>{error && <p className="form-error">{error}</p>}<p className="confirm-caption">The driver will receive the booking-derived dispatch brief by SMS after confirmation.</p><button type="button" className="solid-button dispatch-confirm" disabled={sending || !vehicle.defaultDriverName || !vehicle.defaultDriverPhone} onClick={sendJob}>{sending ? "Assigning and sending..." : !vehicle.defaultDriverPhone ? "Add driver phone in Fleet" : <>Confirm & send job <ArrowUpRight /></>}</button></div> : <><p className="available-rides-caption">Select an unassigned ride to send to {vehicle.defaultDriverName || "this vehicle’s driver"}.</p>{loading ? <div className="admin-inline-loading"><span className="spinner" />Loading available rides</div> : error ? <div className="empty-state"><Clock3 /><p>{error}</p></div> : <div className="available-rides-list">{rides.map(ride => <button type="button" className="available-ride-row" key={ride.id} onClick={() => setSelectedRide(ride)}><div className="available-ride-date"><b>{new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(new Date(ride.inquiry.pickupAt))}</b><span>{new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(ride.inquiry.pickupAt))}</span></div><div><b>{ride.inquiry.fullName}</b><small>{formatDateTime(ride.inquiry.pickupAt)} · {ride.inquiry.serviceType}</small><span>{ride.inquiry.pickup} <ArrowRight /> {ride.inquiry.destination}</span></div><strong>{formatMoney(Math.max(ride.quoteCents - ride.expenseCents, 0))}</strong><ArrowRight /></button>)}{!rides.length && <div className="empty-state compact-empty"><CarFront /><p>No available rides need assignment.</p><small>Confirmed rides will appear here when they are ready for dispatch.</small></div>}</div>}</>}</section></div>;
}
function RideDetail({ ride, vehicles, close, refresh }: { ride: Ride; vehicles: Pick<Vehicle, "id" | "name" | "category" | "description" | "passengers" | "luggage" | "defaultDriverName" | "defaultDriverPhone">[]; close: () => void; refresh: () => void }) {
  const [form, setForm] = useState({ status: ride.status, vehicleId: ride.vehicleId || "", driverName: ride.driverName || "", driverPhone: ride.driverPhone || "", driverLatitude: ride.driverLatitude == null ? "" : String(ride.driverLatitude), driverLongitude: ride.driverLongitude == null ? "" : String(ride.driverLongitude), driverHeading: ride.driverHeading == null ? "" : String(ride.driverHeading), quote: String(ride.quoteCents / 100), deposit: String(ride.depositCents / 100), collected: String(ride.collectedCents / 100), expense: String(ride.expenseCents / 100), dispatchNotes: ride.dispatchNotes || "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dispatchMessage, setDispatchMessage] = useState("");
  const [dispatchState, setDispatchState] = useState<"idle" | "sending" | "sent" | "failed" | "warning">("idle");
  const [dispatchError, setDispatchError] = useState("");
  const [dispatchHistory, setDispatchHistory] = useState<DispatchActivity[]>(ride.dispatchMessages || []);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reconcileSid, setReconcileSid] = useState(ride.dispatchMessages.find(item => item.status === "PENDING")?.providerMessageId || "");
  const [reconciling, setReconciling] = useState(false);
  const [showReconciliation, setShowReconciliation] = useState(ride.dispatchMessages.some(item => item.status === "PENDING" || item.reconciledAt));
  const [paymentState, setPaymentState] = useState<"idle" | "working" | "done">("idle");
  const [paymentStatus, setPaymentStatus] = useState(ride.inquiry.paymentStatus || "not_available");
  const update = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  useEffect(() => {
    api(`/api/admin/rides/${ride.id}/dispatch-brief`).then(data => {
      setDispatchMessage(data.brief);
      setDispatchHistory(data.recentMessages || []);
      const pending = (data.recentMessages || []).find((item: DispatchActivity) => item.status === "PENDING");
      if (pending?.providerMessageId) setReconcileSid(pending.providerMessageId);
      if (pending) setShowReconciliation(true);
    }).catch(() => setDispatchMessage(""));
  }, [ride.id]);
  const ridePayload = () => {
    const nextStatus = form.status === "UNASSIGNED" && form.vehicleId && form.driverName ? "ASSIGNED" : form.status;
    const hasLocation = form.driverLatitude.trim() !== "" && form.driverLongitude.trim() !== "";
    return { status: nextStatus, vehicleId: form.vehicleId || null, driverName: form.driverName || null, driverPhone: form.driverPhone || null, driverLatitude: hasLocation ? Number(form.driverLatitude) : null, driverLongitude: hasLocation ? Number(form.driverLongitude) : null, driverHeading: form.driverHeading.trim() ? Number(form.driverHeading) : null, quote: Number(form.quote || 0), deposit: Number(form.deposit || 0), collected: Number(form.collected || 0), expense: Number(form.expense || 0), dispatchNotes: form.dispatchNotes || null };
  };
  const persistRide = async () => {
    if ((form.driverLatitude.trim() === "") !== (form.driverLongitude.trim() === "")) throw new Error("Enter both driver latitude and longitude, or clear both.");
    await api(`/api/admin/rides/${ride.id}`, { method: "PATCH", body: JSON.stringify(ridePayload()) });
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError("");
    if ((form.driverLatitude.trim() === "") !== (form.driverLongitude.trim() === "")) { setError("Enter both driver latitude and longitude, or clear both."); setSaving(false); return; }
    if (form.status === "COMPLETED" && ride.status !== "COMPLETED" && !window.confirm("Mark this ride completed and capture the authorized Stripe payment now?")) { setSaving(false); return; }
    if (form.status === "CANCELLED" && ride.status !== "CANCELLED" && !window.confirm("Cancel this ride and release its uncaptured Stripe authorization hold?")) { setSaving(false); return; }
    try {
      await persistRide();
      refresh(); close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save this ride."); } finally { setSaving(false); }
  };
  const paymentAction = async (action: "capture" | "cancel") => {
    if (!ride.inquiry.bookingRequestId) return;
    const prompt = action === "capture" ? "Capture this authorization now? This charges the customer before ride completion." : "Cancel this booking and release its authorization hold?";
    if (!window.confirm(prompt)) return;
    setPaymentState("working"); setError("");
    try {
      const result = await api(`/api/admin/payments/${ride.inquiry.bookingRequestId}/${action}`, { method: "POST" });
      setPaymentStatus(result.status);
      if (action === "cancel") update("status", "CANCELLED");
      setPaymentState("done");
      refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The payment action failed."); setPaymentState("idle"); }
  };
  const sendDispatch = async () => {
    setDispatchState("sending"); setDispatchError(""); setError("");
    try {
      await persistRide();
      const result = await api(`/api/admin/rides/${ride.id}/dispatch`, { method: "POST", body: JSON.stringify({ message: dispatchMessage }) });
      setDispatchHistory(history => [result.activity, ...history.filter(item => item.id !== result.activity.id)]);
      setDispatchState("sent");
      refresh();
      return true;
    } catch (reason) {
      setDispatchState(reason instanceof ApiError && reason.data.status === "PENDING_RECONCILIATION" ? "warning" : "failed");
      setDispatchError(reason instanceof Error ? reason.message : "The dispatch text could not be sent.");
      if (reason instanceof ApiError && typeof reason.data.providerMessageId === "string") setReconcileSid(reason.data.providerMessageId);
      if (reason instanceof ApiError && reason.data.status === "PENDING_RECONCILIATION") {
        api(`/api/admin/rides/${ride.id}/dispatch-brief`).then(data => {
          setDispatchHistory(data.recentMessages || []);
          const pending = (data.recentMessages || []).find((item: DispatchActivity) => item.status === "PENDING");
          if (pending?.providerMessageId) setReconcileSid(pending.providerMessageId);
          if (pending) setShowReconciliation(true);
        }).catch(() => undefined);
      }
      return false;
    }
  };
  const reconcileDispatch = async (attempt: DispatchActivity) => {
    setReconciling(true); setDispatchError("");
    try {
      const result = await api(`/api/admin/rides/${ride.id}/dispatch/${attempt.id}/reconcile`, { method: "POST", body: JSON.stringify({ providerMessageId: reconcileSid.trim() || undefined }) });
      setDispatchHistory(history => [result.activity, ...history.filter(item => item.id !== result.activity.id)]);
      setDispatchState(result.status === "SENT" ? "sent" : "failed");
      setDispatchError(result.status === "FAILED" ? "Twilio confirmed that the original message failed. It is now safe to review and send a new dispatch." : "");
      refresh();
    } catch (reason) {
      if (reason instanceof ApiError && reason.data.activity) {
        const activity = reason.data.activity as DispatchActivity;
        setDispatchHistory(history => [activity, ...history.filter(item => item.id !== activity.id)]);
      }
      setDispatchState("warning");
      setDispatchError(reason instanceof Error ? reason.message : "Twilio could not reconcile this dispatch.");
    } finally { setReconciling(false); }
  };
  const phoneMissing = !form.driverPhone.trim();
  const pendingAttempt = dispatchHistory.find(item => item.status === "PENDING");
  const pendingDispatch = Boolean(pendingAttempt);
  const latestReconciliation = dispatchHistory.find(item => item.reconciledAt);
  const selectedVehicle = vehicles.find(vehicle => vehicle.id === form.vehicleId);
  const netTripFare = Math.max(Number(form.quote || 0) * 100 - Number(form.expense || 0) * 100, 0);
  const openReview = () => { setDispatchError(""); setReviewOpen(true); };
  useEffect(() => {
    if (!selectedVehicle) return;
    setForm(current => ({
      ...current,
      driverName: current.driverName || selectedVehicle.defaultDriverName || "",
      driverPhone: current.driverPhone || selectedVehicle.defaultDriverPhone || "",
    }));
  }, [form.vehicleId]);
  const paymentPanel = <div className="drawer-block payment-admin-block">
    <div className="payment-admin-heading"><div><p className="drawer-label">Stripe payment</p><h3>{titleCaseStatus(paymentStatus)}</h3></div><WalletCards /></div>
    <div className="payment-admin-summary">
      <span>Authorized fare <b>{formatMoney(ride.inquiry.estimatedFareCents || ride.quoteCents)}</b></span>
      <span>Customer <b>{ride.inquiry.email}</b></span>
      {ride.inquiry.stripePaymentIntentId && <span>Intent <b>{ride.inquiry.stripePaymentIntentId}</b></span>}
    </div>
    {paymentStatus === "requires_capture" && <div className="payment-admin-actions">
      <button type="button" className="outline-button dark" disabled={paymentState === "working"} onClick={() => paymentAction("capture")}><CircleDollarSign />Capture now</button>
      <button type="button" className="text-button danger-action" disabled={paymentState === "working"} onClick={() => paymentAction("cancel")}><X />Cancel booking & release hold</button>
    </div>}
    {paymentStatus === "succeeded" && <p className="dispatch-success"><Check /> Payment captured. Stripe prevents duplicate capture.</p>}
    {paymentStatus === "canceled" && <p className="dispatch-warning">Authorization released; this booking is cancelled.</p>}
    {paymentState === "done" && <p className="dispatch-success"><RefreshCw /> Payment status updated.</p>}
  </div>;
  const locationPanel = <div className="drawer-block live-location-block">
    <div className="payment-admin-heading"><div><p className="drawer-label">Customer live tracking</p><h3>Driver location</h3></div><Navigation /></div>
    <p className="sms-caption">Coordinates saved here appear on the customer tracking screen within about 20 seconds.</p>
    <div className="location-grid">
      <label>Latitude<input type="number" min="-90" max="90" step="0.000001" value={form.driverLatitude} onChange={event => update("driverLatitude", event.target.value)} placeholder="41.878100" /></label>
      <label>Longitude<input type="number" min="-180" max="180" step="0.000001" value={form.driverLongitude} onChange={event => update("driverLongitude", event.target.value)} placeholder="-87.629800" /></label>
      <label>Heading<input type="number" min="0" max="360" step="1" value={form.driverHeading} onChange={event => update("driverHeading", event.target.value)} placeholder="0–360°" /></label>
    </div>
    {ride.locationUpdatedAt && <small>Last location update: {formatDateTime(ride.locationUpdatedAt)}</small>}
  </div>;
  if (showReconciliation && (pendingAttempt || latestReconciliation)) {
    return <DispatchReconciliationView ride={ride} activity={pendingAttempt || latestReconciliation!} sid={reconcileSid} setSid={setReconcileSid} busy={reconciling} error={dispatchError} onReconcile={pendingAttempt ? () => reconcileDispatch(pendingAttempt) : undefined} onBack={() => setShowReconciliation(false)} close={close} />;
  }
  return <div className="detail-overlay" onClick={close}>
    <aside className="detail-drawer ride-drawer" onClick={event => event.stopPropagation()}>
      <div className="drawer-top"><div><p className="eyebrow brass">Dispatch / {ride.id.slice(-5).toUpperCase()}</p><h2>{ride.inquiry.fullName}</h2></div><button onClick={close}><X /></button></div>
      <div className="ride-route-summary"><span><CalendarDays />{formatDateTime(ride.inquiry.pickupAt)}</span><b>{ride.inquiry.pickup} <ArrowRight /> {ride.inquiry.destination}</b><small>{ride.inquiry.serviceType} · {ride.inquiry.passengers} passenger{ride.inquiry.passengers === 1 ? "" : "s"}</small></div>
      <form className="dispatch-form" onSubmit={save}>
        <div className="drawer-block"><p className="drawer-label">Ride progress</p><label>Status<select value={form.status} onChange={event => update("status", event.target.value)}>{["UNASSIGNED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map(value => <option key={value} value={value}>{titleCaseStatus(value)}</option>)}</select></label>{form.status === "COMPLETED" && ride.status !== "COMPLETED" && <p className="dispatch-warning">Saving captures the authorized Stripe payment.</p>}{form.status === "CANCELLED" && ride.status !== "CANCELLED" && <p className="dispatch-warning">Saving releases any uncaptured Stripe authorization.</p>}</div>
        {paymentPanel}
        <div className="drawer-block assignment-fields"><p className="drawer-label">Assignment</p><label>Vehicle<select value={form.vehicleId} onChange={event => update("vehicleId", event.target.value)}><option value="">Unassigned</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.category}</option>)}</select></label><label>Chauffeur name<input value={form.driverName} onChange={event => update("driverName", event.target.value)} placeholder="Assign chauffeur" /></label><label>Driver mobile<input type="tel" value={form.driverPhone} onChange={event => update("driverPhone", event.target.value)} placeholder="+1 312 555 0188" /></label></div>
        {locationPanel}
        <div className="drawer-block"><p className="drawer-label">Financials</p><div className="money-grid"><label>Quoted fare ($)<input required min="0" step="0.01" type="number" value={form.quote} onChange={event => update("quote", event.target.value)} /></label><label>Deposit ($)<input required min="0" step="0.01" type="number" value={form.deposit} onChange={event => update("deposit", event.target.value)} /></label><label>Collected ($)<input required min="0" step="0.01" type="number" value={form.collected} onChange={event => update("collected", event.target.value)} /></label><label>Ride expense ($)<input required min="0" step="0.01" type="number" value={form.expense} onChange={event => update("expense", event.target.value)} /></label></div><div className="finance-preview"><span>Balance due <b>{formatMoney(Math.max(Number(form.quote || 0) * 100 - Number(form.collected || 0) * 100, 0))}</b></span><span>Estimated profit <b>{formatMoney(netTripFare)}</b></span></div></div>
        <div className="drawer-block"><label>Dispatch notes<textarea rows={4} value={form.dispatchNotes} onChange={event => update("dispatchNotes", event.target.value)} placeholder="Flight tracking, pickup instructions, client preferences..." /></label></div>
        <section className="drawer-block sms-block">
          <div className="sms-heading"><div><p className="drawer-label">Driver dispatch</p><h3>Review and send</h3></div><MessageSquareText /></div>
          <p className="sms-caption">Review the booking-derived brief before sending it to the assigned chauffeur.</p>
          <textarea className="sms-preview" rows={9} value={dispatchMessage} onChange={event => setDispatchMessage(event.target.value)} placeholder="Loading trip brief..." />
          {phoneMissing ? <p className="dispatch-warning">Add the driver’s mobile number to enable SMS.</p> : !form.vehicleId || !form.driverName ? <p className="dispatch-warning">Assign a vehicle and chauffeur before sending.</p> : pendingDispatch ? <p className="dispatch-warning">A prior dispatch is pending reconciliation. Do not resend this ride.</p> : null}
          {dispatchError && <p className={dispatchState === "warning" ? "dispatch-warning" : "form-error"}>{dispatchError}</p>}
          {dispatchState === "sent" && <p className="dispatch-success"><Check /> Dispatch sent to {form.driverPhone}.</p>}
          <button type="button" className="outline-button dispatch-send" disabled={dispatchState === "sending" || pendingDispatch || phoneMissing || !form.vehicleId || !form.driverName || !dispatchMessage.trim()} onClick={async () => { if (window.confirm(`Send this job to ${form.driverName} at ${form.driverPhone}?`)) await sendDispatch(); }}>{dispatchState === "sending" ? "Sending SMS..." : <>Confirm & send job <ArrowUpRight /></>}</button>
          {dispatchHistory.length > 0 && <div className="dispatch-history"><p className="drawer-label">Recent activity</p>{dispatchHistory.slice(0, 4).map(item => <div className="dispatch-history-row" key={item.id}><span className={`dispatch-dot ${item.status.toLowerCase()}`} /><div><b>{item.status === "SENT" ? "Dispatch sent" : item.status === "PENDING" ? "Reconciliation required" : "Dispatch failed"}</b><small>{formatDateTime(item.createdAt)} · {item.toPhone}{item.errorMessage ? ` · ${item.errorMessage}` : ""}</small></div></div>)}</div>}
        </section>
        {error && <p className="form-error">{error}</p>}
        <button className="solid-button dispatch-save" disabled={saving}>{saving ? "Saving..." : <>Save ride <ArrowUpRight /></>}</button>
      </form>
    </aside>
  </div>;
  return <div className="detail-overlay" onClick={close}><aside className="detail-drawer ride-drawer" onClick={event => event.stopPropagation()}><div className="drawer-top"><div><p className="eyebrow brass">Dispatch / {ride.id.slice(-5).toUpperCase()}</p><h2>{ride.inquiry.fullName}</h2></div><button onClick={close}><X /></button></div><div className="ride-route-summary"><span><CalendarDays />{formatDateTime(ride.inquiry.pickupAt)}</span><b>{ride.inquiry.pickup} <ArrowRight /> {ride.inquiry.destination}</b><small>{ride.inquiry.serviceType} · {ride.inquiry.passengers} passenger{ride.inquiry.passengers === 1 ? "" : "s"}</small></div><form className="dispatch-form" onSubmit={save}><div className="drawer-block"><p className="drawer-label">Ride progress</p><label>Status<select value={form.status} onChange={event => update("status", event.target.value)}>{["UNASSIGNED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"].map(value => <option key={value} value={value}>{titleCaseStatus(value)}</option>)}</select></label></div><div className="drawer-block assignment-fields"><p className="drawer-label">Assignment</p><label>Vehicle<select value={form.vehicleId} onChange={event => update("vehicleId", event.target.value)}><option value="">Unassigned</option>{vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.name} · {vehicle.category}</option>)}</select></label><label>Chauffeur name<input value={form.driverName} onChange={event => update("driverName", event.target.value)} placeholder="Assign chauffeur" /></label><label>Driver mobile<input type="tel" value={form.driverPhone} onChange={event => update("driverPhone", event.target.value)} placeholder="+1 312 555 0188" /></label>{selectedVehicle && <button type="button" className="text-button assignment-review-link" onClick={openReview}><MessageSquareText /> Review assignment popup <ArrowUpRight /></button>}</div><div className="drawer-block"><p className="drawer-label">Financials</p><div className="money-grid"><label>Quoted fare ($)<input required min="0" step="0.01" type="number" value={form.quote} onChange={event => update("quote", event.target.value)} /></label><label>Deposit ($)<input required min="0" step="0.01" type="number" value={form.deposit} onChange={event => update("deposit", event.target.value)} /></label><label>Collected ($)<input required min="0" step="0.01" type="number" value={form.collected} onChange={event => update("collected", event.target.value)} /></label><label>Ride expense ($)<input required min="0" step="0.01" type="number" value={form.expense} onChange={event => update("expense", event.target.value)} /></label></div><div className="finance-preview"><span>Balance due <b>{formatMoney(Math.max(Number(form.quote || 0) * 100 - Number(form.collected || 0) * 100, 0))}</b></span><span>Estimated profit <b>{formatMoney(netTripFare)}</b></span></div></div><div className="drawer-block"><label>Dispatch notes<textarea rows={4} value={form.dispatchNotes} onChange={event => update("dispatchNotes", event.target.value)} placeholder="Flight tracking, pickup instructions, client preferences..." /></label></div><section className="drawer-block sms-block"><div className="sms-heading"><div><p className="drawer-label">Driver dispatch</p><h3>Review and send</h3></div><MessageSquareText /></div><p className="sms-caption">The brief starts with the linked booking ticket. Edit it if the driver needs extra context.</p><textarea className="sms-preview" rows={9} value={dispatchMessage} onChange={event => { setDispatchMessage(event.target.value); if (!pendingDispatch) setDispatchState("idle"); }} placeholder="Loading trip brief..." />{phoneMissing ? <p className="dispatch-warning">Add the driver’s mobile number to enable SMS.</p> : !form.vehicleId || !form.driverName ? <p className="dispatch-warning">Assign a vehicle and chauffeur before sending.</p> : pendingDispatch ? <p className="dispatch-warning">A prior dispatch is pending reconciliation. Do not resend this ride.</p> : null}{dispatchError && <p className={dispatchState === "warning" ? "dispatch-warning" : "form-error"}>{dispatchError}</p>}{dispatchState === "sent" && <p className="dispatch-success"><Check /> Dispatch sent to {form.driverPhone}.</p>}<button type="button" className="outline-button dispatch-send" disabled={dispatchState === "sending" || dispatchState === "warning" || pendingDispatch || phoneMissing || !form.vehicleId || !form.driverName || !dispatchMessage.trim()} onClick={openReview}>Review assignment & send SMS <ArrowUpRight /></button>{dispatchHistory.length > 0 && <div className="dispatch-history"><p className="drawer-label">Recent activity</p>{dispatchHistory.slice(0, 4).map(item => <div className="dispatch-history-row" key={item.id}><span className={`dispatch-dot ${item.status.toLowerCase()}`} /><div><b>{item.status === "SENT" ? "Dispatch sent" : item.status === "PENDING" ? "Reconciliation required" : "Dispatch failed"}</b><small>{formatDateTime(item.createdAt)} · {item.toPhone}{item.errorMessage ? ` · ${item.errorMessage}` : ""}</small></div></div>)}</div>}</section>{error && <p className="form-error">{error}</p>}<button className="solid-button dispatch-save" disabled={saving}>{saving ? "Saving..." : <>Save ride <ArrowUpRight /></>}</button></form>{reviewOpen && <div className="dispatch-review-backdrop" onClick={() => setReviewOpen(false)}><section className="dispatch-review-modal" role="dialog" aria-modal="true" aria-label="Review dispatch assignment" onClick={event => event.stopPropagation()}><div className="dispatch-review-top"><div><p className="eyebrow brass">Assignment ready</p><h2>Send this job<br /><em>with confidence.</em></h2></div><button type="button" onClick={() => setReviewOpen(false)} aria-label="Close review"><X /></button></div><div className="review-vehicle-card"><div className="review-vehicle-icon"><CarFront /></div><div><p className="drawer-label">Vehicle</p><h3>{selectedVehicle?.name}</h3><span>{selectedVehicle?.category} · Up to {selectedVehicle?.passengers} guests · {selectedVehicle?.luggage}</span></div></div><div className="review-driver-grid"><div><p className="drawer-label">Chauffeur</p><b>{form.driverName || "Not assigned"}</b></div><div><p className="drawer-label">Mobile</p><b>{form.driverPhone || "Missing phone"}</b></div></div><div className="review-trip"><p className="drawer-label">Trip details</p><div><span><CalendarDays />{formatDateTime(ride.inquiry.pickupAt)}</span><b>{ride.inquiry.pickup} <ArrowRight /> {ride.inquiry.destination}</b><small>{ride.inquiry.serviceType} · {ride.inquiry.passengers} passenger{ride.inquiry.passengers === 1 ? "" : "s"}</small></div></div><div className="review-fare"><span>Trip fare after admin deductions</span><strong>{formatMoney(netTripFare)}</strong><small>{formatMoney(Number(form.quote || 0) * 100)} quoted · {formatMoney(Number(form.expense || 0) * 100)} deductions</small></div><div className="review-actions">{(phoneMissing || !form.driverName || !selectedVehicle) && <p className="dispatch-warning">Assign a vehicle, driver name, and valid phone number before sending.</p>}{dispatchError && <p className={dispatchState === "warning" ? "dispatch-warning" : "form-error"}>{dispatchError}</p>}<button type="button" className="solid-button dispatch-confirm" disabled={dispatchState === "sending" || pendingDispatch || phoneMissing || !form.driverName || !selectedVehicle || !dispatchMessage.trim()} onClick={async () => { const sent = await sendDispatch(); if (sent) setReviewOpen(false); }}>{dispatchState === "sending" ? "Sending SMS..." : pendingDispatch ? "Reconciliation required" : <>Send job to driver <ArrowUpRight /></>}</button></div></section></div>}</aside></div>;
}

function DispatchReconciliationView({ ride, activity, sid, setSid, busy, error, onReconcile, onBack, close }: {
  ride: Ride; activity: DispatchActivity; sid: string; setSid: (value: string) => void; busy: boolean;
  error: string; onReconcile?: () => void; onBack: () => void; close: () => void;
}) {
  const pending = activity.status === "PENDING";
  const providerVisibility = activity.deliveryStatus || activity.providerStatus;
  return <div className="detail-overlay" onClick={close}>
    <aside className="detail-drawer ride-drawer reconciliation-drawer" onClick={event => event.stopPropagation()}>
      <div className="drawer-top"><div><p className="eyebrow brass">Dispatch / {ride.id.slice(-5).toUpperCase()}</p><h2>{pending ? "Reconciliation required" : "Reconciliation complete"}</h2></div><button onClick={close}><X /></button></div>
      <div className={`reconciliation-status ${pending ? "pending" : activity.status.toLowerCase()}`}>
        {pending ? <Clock3 /> : activity.status === "SENT" ? <Check /> : <X />}
        <div><b>{pending ? "Resending is safely blocked" : activity.status === "SENT" ? "Twilio confirmed the message" : "Twilio confirmed the message failed"}</b><p>{pending ? "Verify the original send against Twilio. This check never sends another SMS." : activity.status === "SENT" ? "No duplicate dispatch was sent. The original message remains the authoritative driver instruction." : "The pending lock is cleared. Review the instructions before choosing whether to send a new message."}</p></div>
      </div>
      <div className="reconciliation-details">
        <span>Driver <b>{activity.toPhone}</b></span><span>Attempted <b>{formatDateTime(activity.createdAt)}</b></span>
        {providerVisibility && <span>Twilio status <b>{titleCaseStatus(providerVisibility)}</b></span>}
        {activity.reconciledByName && <span>Reconciled by <b>{activity.reconciledByName}</b></span>}
        {activity.reconciledAt && <span>Reconciled at <b>{formatDateTime(activity.reconciledAt)}</b></span>}
      </div>
      {pending && <div className="reconciliation-form">
        <label>Twilio message SID (optional)<input value={sid} onChange={event => setSid(event.target.value)} placeholder="SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" autoComplete="off" /></label>
        <p>Leave the SID blank to search Twilio by driver, message, and attempt time. This check never sends another SMS.</p>
        {error && <p className="dispatch-warning">{error}</p>}
        <button className="solid-button" type="button" disabled={busy} onClick={onReconcile}>{busy ? "Checking Twilio..." : <>Check and reconcile <ShieldCheck /></>}</button>
      </div>}
      {!pending && activity.errorMessage && <p className="reconciliation-error">{activity.errorMessage}</p>}
      <button className="outline-button dark reconciliation-back" type="button" onClick={onBack}>{pending ? "Back to ride details" : "Return to ride"}</button>
    </aside>
  </div>;
}
function InquiryManager() {
  const [items, setItems] = useState<Inquiry[]>([]); const [q, setQ] = useState(""); const [status, setStatus] = useState("ALL"); const [selected, setSelected] = useState<Inquiry | null>(null);
  const location = useLocation();
  const load = () => api(`/api/admin/inquiries?q=${encodeURIComponent(q)}&status=${status}`).then(data => { setItems(data.inquiries); const requested = new URLSearchParams(location.search).get("inquiry"); if (requested) setSelected(data.inquiries.find((item: Inquiry) => item.id === requested) || null); });
  useEffect(() => { load(); }, [status]);
  const exportCsv = () => { window.location.href = "/api/admin/export.csv"; };
  return <div className="admin-page"><AdminHeader eyebrow="Operations / 24 total" title="Inquiries"><button className="outline-button dark small" onClick={exportCsv}><FileDown /> Export CSV</button></AdminHeader><div className="toolbar"><div className="search-box"><Search /><input placeholder="Search by name, email or location" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && load()} /></div><div className="filter-tabs">{["ALL", "NEW", "CONTACTED", "CONFIRMED", "COMPLETED", "CANCELLED"].map(item => <button className={status === item ? "selected" : ""} key={item} onClick={() => setStatus(item)}>{item === "ALL" ? "All inquiries" : item[0] + item.slice(1).toLowerCase()}</button>)}</div></div><section className="panel inquiry-list-panel"><div className="inquiry-list-head"><span>Client</span><span>Journey</span><span>Pickup</span><span>Status</span></div><div className="inquiry-table">{items.map(item => <InquiryRow key={item.id} inquiry={item} onClick={() => setSelected(item)} />)}</div>{!items.length && <div className="empty-state"><MessageSquareText /><p>No inquiries match these filters.</p></div>}</section>{selected && <InquiryDetail inquiry={selected} close={() => setSelected(null)} refresh={load} />}</div>;
}
function InquiryDetail({ inquiry, close, refresh }: { inquiry: Inquiry; close: () => void; refresh: () => void }) {
  const [note, setNote] = useState(""); const [saving, setSaving] = useState(false);
  const updateStatus = async (value: string) => {
    if (value === "COMPLETED" && !window.confirm("Complete this ride and capture its Stripe authorization?")) return;
    if (value === "CANCELLED" && !window.confirm("Cancel this booking and release its uncaptured authorization?")) return;
    setSaving(true);
    try { await api(`/api/admin/inquiries/${inquiry.id}`, { method: "PATCH", body: JSON.stringify({ status: value }) }); refresh(); close(); }
    finally { setSaving(false); }
  };
  const addNote = async () => { if (!note.trim()) return; await api(`/api/admin/inquiries/${inquiry.id}/notes`, { method: "POST", body: JSON.stringify({ body: note }) }); setNote(""); refresh(); };
  return <div className="detail-overlay" onClick={close}><aside className="detail-drawer" onClick={e => e.stopPropagation()}><div className="drawer-top"><div><p className="eyebrow brass">Inquiry {inquiry.id.slice(-4).toUpperCase()}</p><h2>{inquiry.fullName}</h2></div><button onClick={close}><X /></button></div><div className="drawer-contact"><a href={`mailto:${inquiry.email}`}>{inquiry.email}</a><a href={`tel:${inquiry.phone}`}>{inquiry.phone}</a></div><div className="drawer-block"><p className="drawer-label">Status</p><div className="status-options">{["NEW", "CONTACTED", "CONFIRMED", "COMPLETED", "CANCELLED"].map(s => <button className={inquiry.status === s ? "chosen" : ""} disabled={saving} onClick={() => updateStatus(s)} key={s}><i />{s[0] + s.slice(1).toLowerCase()}</button>)}</div></div><div className="drawer-block journey-block"><p className="drawer-label">Journey details</p><div className="journey-detail"><span><CalendarDays />Pickup</span><b>{formatDateTime(inquiry.pickupAt)}</b></div><div className="journey-detail"><span><ArrowDownRight />Route</span><b>{inquiry.pickup} <ArrowRight /> {inquiry.destination}</b></div><div className="journey-detail"><span><Sparkles />Service</span><b>{inquiry.serviceType} · {inquiry.passengers} passenger{inquiry.passengers === 1 ? "" : "s"}</b></div>{inquiry.isPrivateFBO && <><div className="journey-detail"><span><Plane />FBO</span><b>{inquiry.fboName} · Tail {inquiry.specificTailNumber}</b></div><div className="journey-detail"><span><UserRound />Principal</span><b>{inquiry.principalName}</b></div><div className="journey-detail"><span><MapPin />Ramp escort</span><b>{inquiry.tarmacInstructions}</b></div></>}{inquiry.airportCode && <><div className="journey-detail"><span><CarFront />Airport</span><b>{inquiry.airportCode} · {inquiry.airportTerminal} · Flight {inquiry.flightNumber}</b></div>{inquiry.flightScheduledAt && <div className="journey-detail"><span><Clock3 />Flight time</span><b>{formatDateTime(inquiry.flightScheduledAt)}</b></div>}<div className="journey-detail"><span><MapPin />Pickup plan</span><b>{inquiry.pickupPreference}</b></div></>}</div><div className="drawer-block"><p className="drawer-label">Contact history</p><div className="timeline"><div className="timeline-item"><i /><div><b>Inquiry received</b><small>{formatDateTime(inquiry.createdAt)}</small></div></div>{inquiry.history.map((h, i) => <div className="timeline-item" key={i}><i /><div><b>{h.body}</b><small>{h.author} · {formatDateTime(h.createdAt)}</small></div></div>)}</div><div className="note-input"><input placeholder="Add an internal note..." value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => e.key === "Enter" && addNote()} /><button onClick={addNote}><ArrowUpRight /></button></div></div></aside></div>;
}
function ContentManager({ type }: { type: "services" | "fleet" }) {
  const [items, setItems] = useState<(Service | Vehicle)[]>([]); const [editing, setEditing] = useState<string | null>(null); const [vehicleModalOpen, setVehicleModalOpen] = useState(false);
  const load = () => api("/api/admin/content").then(data => setItems(type === "services" ? data.services : data.fleet));
  useEffect(() => { load(); }, [type]);
  const save = async (item: Service | Vehicle) => { const body = { title: "title" in item ? item.title : undefined, name: "name" in item ? item.name : undefined, description: item.description, active: item.active }; await api(`/api/admin/content/${type}/${item.id}`, { method: "PATCH", body: JSON.stringify(body) }); setEditing(null); load(); };
  const add = async () => { if (type === "fleet") { setVehicleModalOpen(true); return; } const name = window.prompt("Service name"); if (!name) return; const imageUrl = window.prompt("HTTPS image URL", "https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1200&q=85"); if (!imageUrl) return; await api("/api/admin/content/services", { method: "POST", body: JSON.stringify({ slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), title: name, eyebrow: "Private service", description: "A considered service, tailored to every journey.", imageUrl, active: true }) }); load(); };
  const remove = async (id: string) => { if (!window.confirm("Remove this item permanently?")) return; await api(`/api/admin/content/${type}/${id}`, { method: "DELETE" }); load(); };
  return <div className="admin-page"><AdminHeader eyebrow={`Manage / ${type}`} title={type === "services" ? "Services" : "The fleet"}><button className="outline-button dark small" onClick={add}><Plus /> Add {type === "services" ? "service" : "vehicle"}</button></AdminHeader><div className="manage-grid">{items.map(item => <div className="manage-card panel" key={item.id}><div className="manage-image" style={{ backgroundImage: `url(${item.imageUrl})` }} /><div className="manage-content">{editing === item.id ? <><label>{type === "services" ? "Service name" : "Vehicle name"}{type === "services" ? <input value={(item as Service).title} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, title: e.target.value } as Service : i))} /> : <input value={(item as Vehicle).name} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, name: e.target.value } as Vehicle : i))} />}</label><label>Description<textarea value={item.description} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, description: e.target.value } as Service | Vehicle : i))} /></label><label className="publish-toggle"><input type="checkbox" checked={item.active} onChange={e => setItems(items.map(i => i.id === item.id ? { ...i, active: e.target.checked } as Service | Vehicle : i))} /> Published on website</label><div className="edit-actions"><button className="solid-button small-button" onClick={() => save(item)}>Save changes</button><button className="danger-button" onClick={() => remove(item.id)}><Trash2 /> Delete</button></div></> : <><div className="manage-heading"><div><p className="eyebrow brass">{type === "services" ? (item as Service).eyebrow : (item as Vehicle).category}</p><h2>{type === "services" ? (item as Service).title : (item as Vehicle).name}</h2></div><button onClick={() => setEditing(item.id)}><Pencil /></button></div><p>{item.description}</p><div className="manage-meta"><span className={item.active ? "active-label" : "inactive-label"}><i />{item.active ? "Published" : "Hidden"}</span>{type === "fleet" && <span>{(item as Vehicle).passengers} guests · {(item as Vehicle).luggage}</span>}</div></>}</div></div>)}</div>{type === "fleet" && vehicleModalOpen && <VehicleCreateModal close={() => setVehicleModalOpen(false)} created={() => { setVehicleModalOpen(false); load(); }} />}</div>;
}

function VehicleCreateModal({ close, created }: { close: () => void; created: () => void }) {
  const [form, setForm] = useState({ name: "", category: "The Collection", description: "", imageUrl: "https://cdn.pixabay.com/photo/2020/06/06/02/00/cadillac-escalade-5264974_1280.jpg", passengers: "1–3", luggage: "2 large", defaultDriverName: "", defaultDriverPhone: "" });
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  const update = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => { event.preventDefault(); setSaving(true); setError(""); try { await api("/api/admin/content/fleet", { method: "POST", body: JSON.stringify({ ...form, defaultDriverName: form.defaultDriverName || null, defaultDriverPhone: form.defaultDriverPhone || null, active: true }) }); created(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to add this vehicle."); } finally { setSaving(false); } };
  return <div className="vehicle-modal-backdrop" onClick={close}><section className="vehicle-modal" role="dialog" aria-modal="true" aria-label="Add vehicle" onClick={event => event.stopPropagation()}><div className="vehicle-modal-top"><div><p className="eyebrow brass">Fleet / new vehicle</p><h2>Add to<br /><em>the collection.</em></h2></div><button type="button" onClick={close} aria-label="Close"><X /></button></div><form onSubmit={submit}><div className="vehicle-modal-grid"><label>Vehicle name<input required value={form.name} onChange={event => update("name", event.target.value)} placeholder="Cadillac Escalade" /></label><label>Category<input required value={form.category} onChange={event => update("category", event.target.value)} placeholder="The Residence" /></label><label>Passenger capacity<input required value={form.passengers} onChange={event => update("passengers", event.target.value)} placeholder="1–6" /></label><label>Luggage capacity<input required value={form.luggage} onChange={event => update("luggage", event.target.value)} placeholder="4 large" /></label></div><label>Description<textarea required rows={3} value={form.description} onChange={event => update("description", event.target.value)} placeholder="A refined cabin for every journey." /></label><label>Vehicle image URL<input required type="url" value={form.imageUrl} onChange={event => update("imageUrl", event.target.value)} /></label><div className="vehicle-driver-fields"><p className="drawer-label">Default driver details <span>Used to pre-fill ride assignments</span></p><div className="vehicle-modal-grid"><label>Driver name<input value={form.defaultDriverName} onChange={event => update("defaultDriverName", event.target.value)} placeholder="Optional" /></label><label>Driver phone<input type="tel" value={form.defaultDriverPhone} onChange={event => update("defaultDriverPhone", event.target.value)} placeholder="Optional · +1 312 ..." /></label></div></div>{error && <p className="form-error">{error}</p>}<div className="vehicle-modal-actions"><button type="button" className="outline-button dark small" onClick={close}>Cancel</button><button className="solid-button small-button" disabled={saving}>{saving ? "Adding vehicle..." : <>Add vehicle <ArrowUpRight /></>}</button></div></form></section></div>;
}
function SiteContentManager() {
  const [content, setContent] = useState<Content["siteContent"]>(fallbackContent.siteContent); const [saved, setSaved] = useState(false);
  useEffect(() => { api("/api/admin/content").then(data => setContent(data.siteContent)); }, []);
  const update = (key: keyof typeof content, value: string) => setContent(c => ({ ...c, [key]: value }));
  const save = async () => { await api("/api/admin/content/site", { method: "PATCH", body: JSON.stringify(content) }); setSaved(true); setTimeout(() => setSaved(false), 2400); };
  return <div className="admin-page"><AdminHeader eyebrow="Manage / public website" title="Site content"><button className="solid-button small-button" onClick={save}>{saved ? <><Check /> Saved</> : <>Save changes <ArrowUpRight /></>}</button></AdminHeader><div className="content-editor-grid"><section className="panel editor-panel"><div className="panel-header"><div><p className="eyebrow brass">Homepage / Hero</p><h2>First impression</h2></div><span className="panel-icon"><Sparkles /></span></div><label>Eyebrow<input value={content.heroKicker} onChange={e => update("heroKicker", e.target.value)} /></label><label>Headline<textarea rows={2} value={content.heroTitle} onChange={e => update("heroTitle", e.target.value)} /></label><label>Supporting copy<textarea rows={3} value={content.heroDescription} onChange={e => update("heroDescription", e.target.value)} /></label></section><section className="panel editor-panel"><div className="panel-header"><div><p className="eyebrow brass">Homepage / Standard</p><h2>Our promise</h2></div><span className="panel-icon"><ShieldCheck /></span></div><label>Headline<textarea rows={2} value={content.standardTitle} onChange={e => update("standardTitle", e.target.value)} /></label><label>Body copy<textarea rows={6} value={content.standardBody} onChange={e => update("standardBody", e.target.value)} /></label></section></div></div>;
}
function AdminUsers() {
  const [users, setUsers] = useState<{ id: string; name: string; email: string; role: string; active: boolean; createdAt: string }[]>([]);
  const load = () => api("/api/admin/users").then(data => setUsers(data.users));
  useEffect(() => { load(); }, []);
  const add = async () => {
    const name = window.prompt("Administrator name"); if (!name) return;
    const email = window.prompt("Administrator email"); if (!email) return;
    const password = window.prompt("Temporary password (at least 12 characters)"); if (!password) return;
    await api("/api/admin/users", { method: "POST", body: JSON.stringify({ name, email, password, role: "ADMIN" }) }); load();
  };
  const toggle = async (user: typeof users[number]) => { await api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ active: !user.active }) }); load(); };
  return <div className="admin-page"><AdminHeader eyebrow="Security / team access" title="Admin users"><button className="outline-button dark small" onClick={add}><Plus /> Add administrator</button></AdminHeader><section className="panel user-list"><div className="user-list-head"><span>Administrator</span><span>Role</span><span>Added</span><span>Status</span></div>{users.map(user => <div className="user-list-row" key={user.id}><div className="inquiry-person"><span className="person-initials">{user.name.split(" ").map(v => v[0]).join("").slice(0, 2)}</span><div><b>{user.name}</b><small>{user.email}</small></div></div><select value={user.role} onChange={e => api(`/api/admin/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ role: e.target.value }) }).then(load)}><option value="ADMIN">Admin</option><option value="SUPER_ADMIN">Super admin</option></select><span>{formatDate(user.createdAt)}</span><button className={user.active ? "active-label user-status" : "inactive-label user-status"} onClick={() => toggle(user)}><i />{user.active ? "Active" : "Disabled"}</button></div>)}</section></div>;
}
function SettingsPage() { return <div className="admin-page"><AdminHeader eyebrow="Workspace / configuration" title="Settings" /><div className="settings-grid"><section className="panel settings-card"><div className="panel-header"><div><p className="eyebrow brass">Company profile</p><h2>Allan Limousine</h2></div><Pencil /></div><label>Business phone<input defaultValue="+1 312 555 0188" /></label><label>Contact email<input defaultValue="hello@allanlimousine.com" /></label><label>Service area<input defaultValue="Chicago, Illinois · Available citywide & beyond" /></label><button className="outline-button dark small">Save profile</button></section><section className="panel settings-card"><div className="panel-header"><div><p className="eyebrow brass">Security</p><h2>Admin access</h2></div><ShieldCheck /></div><div className="security-row"><span><b>Two-factor authentication</b><small>Protect administrator accounts with an additional verification step.</small></span><span className="coming-soon">Coming soon</span></div><div className="security-row"><span><b>Active sessions</b><small>1 active session on this workspace.</small></span><button className="text-button">Review <ArrowRight /></button></div></section></div></div>; }

export default function App() {
  const location = useLocation();
  if (location.pathname === "/admin/login") return <AdminLogin />;
  if (location.pathname.startsWith("/admin")) return <AdminShell />;
  return <PWAInstallGate><Home /></PWAInstallGate>;
}
