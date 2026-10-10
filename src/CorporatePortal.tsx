import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight, CalendarDays, CarFront, CreditCard, KeyRound, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { loadStripe } from "@stripe/stripe-js";
import { RATE_TIER_PRICING, type RateTier } from "../shared/pricing";
import type { CorporateAccountView, CorporateBookingView, CorporateTripInput } from "../shared/corporate";
import "./corporate.css";

type Session = { user: { id: string; name: string; email: string }; account: CorporateAccountView };
type Quote = { quoteToken: string; fareCents: number; gratuityCents: 0; totalCents: number };
const freshId = () => crypto.randomUUID();
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const dateLabel = (date: string) => new Date(date).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const localDateInput = (date?: string) => {
  if (!date) return "";
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? "" : new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", ...options?.headers }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The request could not be completed.");
  return body as T;
}
const initialTrip = (): CorporateTripInput => ({
  bookingRequestId: freshId(), fullName: "", phone: "", pickup: "", destination: "", pickupAt: "",
  passengers: 1, rateTier: "EXECUTIVE_SEDAN", poNumber: "", costCenterCode: "", notes: "",
});

function CorporatePaymentRecovery({ booking }: { booking: CorporateBookingView }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);
  if (booking.paymentStatus !== "requires_action" && !verified) return null;
  const authorize = async () => {
    setBusy(true); setError("");
    try {
      const { clientSecret, publishableKey, alreadyPaid } = await request<{ clientSecret: string; publishableKey: string; alreadyPaid?: boolean }>(
        `/api/corporate/bookings/${encodeURIComponent(booking.id)}/payment-action`,
        { method: "POST" },
      );
      if (!alreadyPaid) {
        const stripe = await loadStripe(publishableKey);
        if (!stripe) throw new Error("Secure card authentication could not be initialized. Check your connection and retry.");
        const result = await stripe.confirmCardPayment(clientSecret);
        if (result.error) throw new Error(result.error.message || "Bank authentication was not completed. Retry to continue the existing charge.");
        if (!result.paymentIntent || result.paymentIntent.status !== "succeeded") {
          throw new Error("The bank did not confirm this payment yet. You may retry authorization for this same ride.");
        }
      }
      await request(`/api/corporate/bookings/${encodeURIComponent(booking.id)}/payment-sync`, { method: "POST" });
      setVerified(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Bank authentication could not be completed.");
    } finally { setBusy(false); }
  };
  if (verified) return <p className="corp-payment-recovery-success" role="status">Company card authorized. Ask dispatch or your chauffeur to retry trip completion.</p>;
  return <div className="corp-payment-recovery">
    <p>This company card requires bank authentication before this ride can be completed.</p>
    {error && <p className="corp-message error" role="alert">{error}</p>}
    <button type="button" className="corp-primary" onClick={() => void authorize()} disabled={busy}>{busy ? "Authenticating existing charge…" : <>Authorize company card <CreditCard /></>}</button>
  </div>;
}

export default function CorporatePortal() {
  const navigate = useNavigate();
  const location = useLocation();
  const loginPage = location.pathname === "/login";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [bookings, setBookings] = useState<CorporateBookingView[]>([]);
  const [loading, setLoading] = useState(!loginPage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [bookingsError, setBookingsError] = useState("");
  const [trip, setTrip] = useState<CorporateTripInput>(initialTrip);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingOutcomeUncertain, setBookingOutcomeUncertain] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentSessionId, setPaymentSessionId] = useState("");
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", password: "" });
  const tripRevision = useRef(0);

  const loadPortal = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const current = await request<Session>("/api/corporate/session");
      setSession(current);
      if (current.account.mustChangePassword) { setBookings([]); setBookingsError(""); return; }
      try { const result = await request<{ bookings: CorporateBookingView[] }>("/api/corporate/bookings"); setBookings(result.bookings); setBookingsError(""); }
      catch (reason) { setBookingsError(reason instanceof Error ? reason.message : "Bookings could not be loaded."); }
    } catch (reason) {
      setSession(null);
      if (!loginPage) navigate("/login", { replace: true });
      else setError(reason instanceof Error ? reason.message : "Sign in to continue.");
    } finally { setLoading(false); }
  }, [loginPage, navigate]);
  const refreshBookings = useCallback(async () => {
    try { const result = await request<{ bookings: CorporateBookingView[] }>("/api/corporate/bookings"); setBookings(result.bookings); setBookingsError(""); }
    catch (reason) { setBookingsError(reason instanceof Error ? reason.message : "Bookings could not be refreshed."); }
  }, []);

  useEffect(() => { if (!loginPage) void loadPortal(); }, [loginPage, loadPortal]);
  useEffect(() => {
    const sessionId = new URLSearchParams(location.search).get("session_id");
    if (!sessionId || loginPage) return;
    setPaymentSessionId(sessionId);
    request<{ message: string }>("/api/corporate/payment-confirm", { method: "POST", body: JSON.stringify({ sessionId }) })
      .then(() => void loadPortal()).catch(reason => setPaymentError(reason instanceof Error ? reason.message : "Payment setup confirmation could not be completed."));
  }, [location.search, loginPage, loadPortal]);
  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await request("/api/corporate/login", { method: "POST", body: JSON.stringify({ email, password }) }); navigate("/corporate/portal", { replace: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign in."); }
    finally { setBusy(false); }
  };
  const logout = async () => { setBusy(true); setError(""); try { await request("/api/corporate/logout", { method: "POST" }); navigate("/login", { replace: true }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign out."); } finally { setBusy(false); } };
  const updateTrip = <K extends keyof CorporateTripInput>(key: K, value: CorporateTripInput[K]) => { tripRevision.current += 1; setTrip(current => ({ ...current, [key]: value })); setQuote(null); setBookingError(""); };
  const getQuote = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setBookingError(""); setQuote(null);
    const revision = tripRevision.current;
    const reviewedTrip = { ...trip, bookingRequestId: freshId() };
    try {
      const reviewedQuote = await request<Quote>("/api/corporate/quotes", { method: "POST", body: JSON.stringify(reviewedTrip) });
      if (tripRevision.current === revision) { setTrip(reviewedTrip); setQuote(reviewedQuote); }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "A trip quote could not be prepared."); }
    finally { setBusy(false); }
  };
  const confirmBooking = async () => {
    if (!quote || bookingBusy) return;
    setBookingBusy(true); setBookingError(""); setBookingOutcomeUncertain(true);
    try {
      await request("/api/corporate/bookings", { method: "POST", body: JSON.stringify({ quoteToken: quote.quoteToken }) });
      setBookingOutcomeUncertain(false);
      setQuote(null); setTrip(initialTrip()); await loadPortal();
    } catch (reason) { setBookingError(`${reason instanceof Error ? reason.message : "Booking could not be confirmed."} The outcome is uncertain; retry this same reviewed booking. Do not create another.`); }
    finally { setBookingBusy(false); }
  };
  const paymentSetup = async () => {
    setBusy(true); setPaymentError("");
    try { const result = await request<{ url: string }>("/api/corporate/payment-setup", { method: "POST", body: JSON.stringify({ billingConsent: true }) }); window.location.assign(result.url); }
    catch (reason) { setPaymentError(reason instanceof Error ? reason.message : "Payment setup could not be opened."); setBusy(false); }
  };
  const retryPaymentConfirmation = async () => {
    if (!paymentSessionId || busy) return;
    setBusy(true); setPaymentError("");
    try { await request<{ message: string }>("/api/corporate/payment-confirm", { method: "POST", body: JSON.stringify({ sessionId: paymentSessionId }) }); await loadPortal(); }
    catch (reason) { setPaymentError(reason instanceof Error ? reason.message : "Payment setup confirmation could not be completed."); }
    finally { setBusy(false); }
  };
  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await request("/api/corporate/password", { method: "POST", body: JSON.stringify(passwordForm) }); navigate("/login", { replace: true, state: { passwordChanged: true } }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Password could not be updated."); }
    finally { setBusy(false); }
  };
  if (loading) return <main className="corp-page"><div className="corp-loading" aria-busy="true"><i /><i /><i /></div></main>;
  if (loginPage) return <main className="corp-page"><header className="corp-public-header"><Link to="/" className="corp-wordmark"><img src="/allan-limousine-logo.png" alt="Allan Limousine" /></Link><Link to="/corporate">Corporate program <ArrowUpRight /></Link></header><section className="corp-login"><p className="corp-kicker">Corporate travel account</p><h1>Welcome<br /><em>back.</em></h1><p>Sign in to coordinate and review company travel.</p>{(location.state as { passwordChanged?: boolean } | null)?.passwordChanged && <p className="corp-message success">Password updated. Sign in with your new password.</p>}<form onSubmit={login}><label>Email address<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>{error && <p className="corp-message error" role="alert">{error}</p>}<button className="corp-primary" disabled={busy}>{busy ? "Signing in…" : <>Sign in <ArrowUpRight /></>}</button></form><Link to="/corporate">Apply for a company account <ArrowUpRight /></Link></section></main>;
  if (!session) return null;
  const { account, user } = session;
  if (account.mustChangePassword) return <main className="corp-page"><header className="corp-public-header"><Link to="/" className="corp-wordmark"><img src="/allan-limousine-logo.png" alt="Allan Limousine" /></Link><span>Secure account setup</span></header><section className="corp-login corp-password-required"><KeyRound /><p className="corp-kicker">First sign-in required</p><h1>Make it<br /><em>yours.</em></h1><p>Set a new password before company booking and billing controls become available. You will return to sign in after this change.</p><form onSubmit={changePassword}><label>Temporary password<input type="password" autoComplete="current-password" required value={passwordForm.currentPassword} onChange={e => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })} /></label><label>New password<input type="password" autoComplete="new-password" minLength={12} maxLength={200} required value={passwordForm.password} onChange={e => setPasswordForm({ ...passwordForm, password: e.target.value })} /><small>Use 12–200 characters.</small></label>{error && <p className="corp-message error" role="alert">{error}</p>}<button className="corp-primary" disabled={busy || passwordForm.password.length < 12}>{busy ? "Updating password…" : "Set new password"}</button></form></section></main>;
  return <main className="corp-page corp-portal">
    <header className="corp-portal-header"><Link to="/" className="corp-wordmark"><img src="/allan-limousine-logo.png" alt="Allan Limousine" /></Link><div><span>{account.companyLegalName}</span><button onClick={() => void logout()} disabled={busy}><LogOut /> Sign out</button></div></header>
    <section className="corp-portal-welcome"><div><p className="corp-kicker">Corporate travel · {account.status}</p><h1>Good morning,<br /><em>{user.name.split(" ")[0]}.</em></h1><p>Company rides are reviewed before booking and charged per completed trip.</p></div><div className="corp-account-mark"><ShieldCheck /><span>Staff approved<br />accountable travel</span></div></section>
    {!account.paymentReady && <section className="corp-payment-required"><CreditCard /><div><b>Payment setup required</b><p>Add a saved company payment method before booking. Each completed ride is charged individually.</p>{paymentError && <p className="corp-message error" role="alert">{paymentError}</p>}</div>{paymentError && paymentSessionId && <button onClick={() => void retryPaymentConfirmation()} disabled={busy}>Retry confirmation</button>}<button onClick={() => void paymentSetup()} disabled={busy}>{busy ? "Opening Stripe…" : "Set up payment"} <ArrowUpRight /></button></section>}
    {paymentError && account.paymentReady && <div className="corp-message error" role="alert">{paymentError}{paymentSessionId && <button onClick={() => void retryPaymentConfirmation()} disabled={busy}>Retry confirmation</button>}</div>}
    {account.paymentReady && <section className="corp-book-trip"><div className="corp-section-title"><div><p className="corp-kicker">New reservation</p><h2>Plan the next<br /><em>company ride.</em></h2></div><span>Reviewed fare · per-ride billing</span></div>
      {!quote ? <form className="corp-form corp-trip-form" onSubmit={getQuote}>
        <div className="corp-field-row"><label>Passenger name<input required value={trip.fullName} onChange={e => updateTrip("fullName", e.target.value)} /></label><label>Passenger phone<input required type="tel" value={trip.phone} onChange={e => updateTrip("phone", e.target.value)} /></label></div>
        <div className="corp-field-row"><label>Pick-up location<input required value={trip.pickup} onChange={e => updateTrip("pickup", e.target.value)} /></label><label>Destination<input required value={trip.destination} onChange={e => updateTrip("destination", e.target.value)} /></label></div>
        <div className="corp-field-row"><label>Pick-up date &amp; time<input required type="datetime-local" value={localDateInput(trip.pickupAt)} onChange={e => updateTrip("pickupAt", e.target.value ? new Date(e.target.value).toISOString() : "")} /></label><label>Vehicle class<select value={trip.rateTier} onChange={e => updateTrip("rateTier", e.target.value as RateTier)}>{Object.entries(RATE_TIER_PRICING).map(([key, tier]) => <option key={key} value={key}>{tier.label}</option>)}</select></label></div>
        <div className="corp-field-row"><label>Passengers<input required type="number" min="1" max="14" value={trip.passengers} onChange={e => updateTrip("passengers", Number(e.target.value))} /></label><label>Purchase order number<input required value={trip.poNumber} onChange={e => updateTrip("poNumber", e.target.value)} /></label></div>
        <div className="corp-field-row"><label>Cost center code<input required value={trip.costCenterCode} onChange={e => updateTrip("costCenterCode", e.target.value)} /></label><label>Airport code, if applicable<input maxLength={3} value={trip.airportCode || ""} onChange={e => updateTrip("airportCode", e.target.value.toUpperCase() || undefined)} placeholder="ORD" /></label></div>
        <div className="corp-field-row"><label>Flight number, optional<input value={trip.flightNumber || ""} onChange={e => updateTrip("flightNumber", e.target.value || undefined)} /></label><label>Flight scheduled time, optional<input type="datetime-local" value={localDateInput(trip.flightScheduledAt)} onChange={e => updateTrip("flightScheduledAt", e.target.value ? new Date(e.target.value).toISOString() : undefined)} /></label></div>
        <label>Trip instructions<textarea rows={3} maxLength={1000} value={trip.notes} onChange={e => updateTrip("notes", e.target.value)} /></label>
        {error && <p className="corp-message error" role="alert">{error}</p>}<button className="corp-primary" disabled={busy}>{busy ? "Preparing reviewed fare…" : <>Review trip and fare <ArrowUpRight /></>}</button>
      </form> : <section className="corp-quote" aria-live="polite"><p className="corp-kicker">Review before booking</p><h3>{trip.pickup}<span>to</span>{trip.destination}</h3><div className="corp-quote-meta"><span>{trip.fullName} · {trip.phone}</span><span>{dateLabel(trip.pickupAt)}</span><span>PO · {trip.poNumber}</span><span>Cost center · {trip.costCenterCode}</span><span>{trip.passengers} passenger{trip.passengers === 1 ? "" : "s"} · {RATE_TIER_PRICING[trip.rateTier].label}</span></div><dl><div><dt>Reviewed fare</dt><dd>{money(quote.fareCents)}</dd></div><div><dt>Gratuity</dt><dd>{money(quote.gratuityCents)}</dd></div><div className="total"><dt>Per-ride total</dt><dd>{money(quote.totalCents)}</dd></div></dl><p>Payment method on file is automatically charged for this fare when the ride is completed.</p>{bookingError && <p className="corp-message error" role="alert">{bookingError}</p>}{bookingOutcomeUncertain && <p className="corp-outcome-note" role="status">Only retry the booking below. Editing could risk creating a duplicate trip.</p>}<div className="corp-quote-actions"><button className="corp-secondary" disabled={bookingBusy || bookingOutcomeUncertain} onClick={() => { setQuote(null); setBookingError(""); }}>Edit trip</button><button className="corp-primary" disabled={bookingBusy} onClick={() => void confirmBooking()}>{bookingBusy ? "Confirming booking…" : bookingOutcomeUncertain ? <>Retry same booking <ArrowUpRight /></> : <>Confirm company booking <ArrowUpRight /></>}</button></div></section>}
    </section>}
    <section className="corp-history"><div className="corp-section-title"><div><p className="corp-kicker">Account record</p><h2>Company ride<br /><em>history.</em></h2></div><button className="corp-refresh" onClick={() => void refreshBookings()} disabled={loading}><RefreshCw /> Refresh</button></div>{bookingsError ? <div className="corp-empty"><p className="corp-message error" role="alert">{bookingsError}</p><button className="corp-secondary" onClick={() => void refreshBookings()}>Try again</button></div> : bookings.length === 0 ? <div className="corp-empty"><CalendarDays /><h3>No company rides yet.</h3><p>Confirmed reservations and their trip-level billing status will appear here.</p></div> : <div className="corp-history-list">{bookings.map(booking => <article key={booking.id}><div className="corp-history-top"><span>Ref. {booking.reference}</span><span>{booking.status.replaceAll("_", " ")}</span></div><div className="corp-history-route"><b>{booking.pickup}</b><i />{booking.destination}</div><div className="corp-history-meta"><span><CalendarDays />{dateLabel(booking.pickupAt)}</span><span>PO · {booking.poNumber}</span><span>Cost center · {booking.costCenterCode}</span><span><CarFront />Payment · {booking.paymentStatus?.replaceAll("_", " ") || "Pending completion"}</span></div><strong>{money(booking.authorizedTotalCents)}</strong><CorporatePaymentRecovery booking={booking} /></article>)}</div>}</section>
    <footer className="corp-footer"><span>{account.companyLegalName}</span><span>Billing is per completed ride, not invoice credit terms.</span><Link to="/">Allan Limousine</Link></footer>
  </main>;
}
