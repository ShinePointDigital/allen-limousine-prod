import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, CalendarDays, CarFront, KeyRound, LogOut, MapPin, UserRound } from "lucide-react";
import "./CustomerAccount.css";

type Customer = { id: string; name: string; email: string; role: "USER" };
type Booking = { id: string; reference: string; serviceType: string; pickupAt: string; pickup: string; destination: string; passengers: number; status: string; fareCents: number | null; gratuityCents?: number | null; authorizedTotalCents?: number | null; paymentStatus: string | null; createdAt: string };
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", headers: { "Content-Type": "application/json", ...options?.headers }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data as T;
}
const money = (cents: number | null) => cents == null ? "To be confirmed" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
const dateTime = (value: string) => new Date(value).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function CustomerAccount() {
  const navigate = useNavigate();
  const location = useLocation();
  const loginPage = location.pathname === "/account/login";
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(!loginPage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [bookingsError, setBookingsError] = useState("");

  const loadAccount = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const session = await request<{ user: Customer }>("/api/customer/session");
      setCustomer(session.user);
      try {
        const result = await request<{ bookings: Booking[] }>("/api/customer/bookings");
        setBookings(result.bookings);
      } catch (reason) {
        setBookingsError(reason instanceof Error ? reason.message : "Unable to load bookings.");
      }
    } catch (reason) {
      setCustomer(null);
      if (!loginPage) navigate("/account/login", { replace: true });
      else setError(reason instanceof Error ? reason.message : "Please sign in to continue.");
    } finally { setLoading(false); }
  }, [loginPage, navigate]);
  useEffect(() => { if (!loginPage) void loadAccount(); }, [loginPage, loadAccount]);

  const submitLogin = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await request("/api/customer/login", { method: "POST", body: JSON.stringify({ email, password }) });
      navigate("/account", { replace: true });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign in."); }
    finally { setBusy(false); }
  };
  const signOut = async () => {
    setBusy(true); setError("");
    try { await request("/api/customer/logout", { method: "POST" }); navigate("/account/login", { replace: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign out."); }
    finally { setBusy(false); }
  };
  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    try {
      await request("/api/customer/password", { method: "POST", body: JSON.stringify({ currentPassword, password: newPassword }) });
      try { await request("/api/customer/logout", { method: "POST" }); } catch { /* Password change may already revoke this session. */ }
      navigate("/account/login", { replace: true, state: { passwordChanged: true } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to change password."); }
    finally { setBusy(false); }
  };

  if (loading) return <main className="ca-page"><div className="ca-shell"><div className="ca-skeleton"><i /><i /><i /></div></div></main>;
  if (loginPage || !customer) return <main className="ca-page"><div className="ca-shell ca-login">
    <Link className="ca-back" to="/"><ArrowLeft /> Allan Limousine</Link>
    <div className="ca-login-card"><p className="eyebrow brass">Customer account</p><h1>Welcome<br /><em>back.</em></h1><p>Sign in to see the reservations linked to your account.</p>
      {location.state?.passwordChanged && <p className="ca-message success" role="status">Password updated. Sign in with your new password.</p>}
      <form onSubmit={submitLogin}><label>Email address<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} /></label>{error && <p className="ca-message error" role="alert">{error}</p>}<button className="solid-button" disabled={busy}>{busy ? "Signing in…" : <>Sign in <ArrowUpRight /></>}</button></form>
      <div className="ca-login-foot"><span>New to Allan?</span><Link to="/#reserve">Book a ride <ArrowUpRight /></Link></div>
    </div>
  </div></main>;

  return <main className="ca-page"><div className="ca-shell">
    <header className="ca-header"><Link className="ca-brand" to="/">ALLAN <span>CHICAGO</span></Link><button className="ca-signout" onClick={() => void signOut()} disabled={busy}><LogOut /> Sign out</button></header>
    <section className="ca-welcome"><div><p className="eyebrow brass">Your account</p><h1>Good to see you,<br /><em>{customer.name.split(" ")[0]}.</em></h1><p>Reservations linked to <b>{customer.email}</b> appear here.</p></div><span className="ca-monogram"><UserRound /></span></section>
    <section className="ca-bookings"><div className="ca-section-heading"><div><p className="eyebrow brass">Travel, at a glance</p><h2>Your reservations</h2><p className="ca-booking-notice">Only bookings linked to this account appear here. Guest and older bookings are not automatically imported.</p></div><Link className="solid-button" to="/#reserve">Book a ride <ArrowUpRight /></Link></div>
      {bookingsError ? <div className="ca-empty"><p className="ca-message error">{bookingsError}</p><button className="outline-button dark small" onClick={() => { setBookingsError(""); void loadAccount(); }}>Try again</button></div> : bookings.length === 0 ? <div className="ca-empty"><CalendarDays /><h3>Your next ride starts here.</h3><p>No account-linked reservations yet. Guest or older bookings are not automatically imported into this account.</p><Link className="outline-button dark small" to="/#reserve">Make a reservation <ArrowUpRight /></Link></div> :
         <div className="ca-booking-list">{bookings.map(booking => <article className="ca-booking" key={booking.id}><div className="ca-booking-top"><span className="ca-reference">Ref. {booking.reference}</span><span className={`ca-booking-status ${booking.status.toLowerCase().replace(/[^a-z]+/g, "-")}`}>{booking.status.replaceAll("_", " ")}</span></div><div className="ca-trip"><div className="ca-trip-date"><CalendarDays /><span>{dateTime(booking.pickupAt)}</span></div><div className="ca-route"><span><i />{booking.pickup}</span><span><i />{booking.destination}</span></div><div className="ca-trip-details"><span><CarFront />{booking.serviceType}</span><span>{booking.passengers} passenger{booking.passengers === 1 ? "" : "s"}</span><span>Payment · {booking.paymentStatus?.replaceAll("_", " ") || "Not recorded"}</span><span className="ca-financials">Fare {money(booking.fareCents)} · Gratuity {money(booking.gratuityCents ?? 0)}</span><b>Total {money(booking.authorizedTotalCents ?? ((booking.fareCents || 0) + (booking.gratuityCents || 0)))}</b></div></div></article>)}</div>}
    </section>
    <section className="ca-password"><div><p className="eyebrow brass">Account security</p><h2>Change password</h2><p>After updating your password, you’ll be signed out on this device.</p></div>
      <form onSubmit={changePassword}><label>Current password<input type="password" autoComplete="current-password" required value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label><label>New password<input type="password" autoComplete="new-password" required minLength={12} maxLength={200} value={newPassword} onChange={event => setNewPassword(event.target.value)} /><small>Choose 12–200 characters.</small></label>{error && <p className="ca-message error" role="alert">{error}</p>}{success && <p className="ca-message success" role="status">{success}</p>}<button className="outline-button dark small" disabled={busy || newPassword.length < 12}><KeyRound />{busy ? "Updating…" : "Update password"}</button></form>
    </section>
    <footer className="ca-footer"><span>ALLAN LIMOUSINE · CHICAGO</span><Link to="/#reserve">Need a ride? Book here <ArrowUpRight /></Link><span><MapPin /> Chicago, Illinois</span></footer>
  </div></main>;
}
