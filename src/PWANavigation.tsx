import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, CreditCard, Headphones, LoaderCircle, Mail, MapPin, Phone, Plus, ShieldCheck, Trash2, WalletCards, X } from "lucide-react";
import StripeCardSetup, { type SavedPayment } from "./StripeCardSetup.js";
import { forgetPwaTrip, readPwaTrips, readSavedPayment, readWalletPayments, removeWalletPayment, replacePwaTrips, saveSavedPayment, type PwaTrip } from "./pwa-state.js";

type Panel = "trips" | "wallet" | "support" | null;
type StripeCard = {
  paymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
  isDefault: boolean;
};

const api = async (url: string, body: unknown) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "That request could not be completed.");
  return data;
};

const formatTripDate = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const statusLabel = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase());

function DrawerHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return <header className="pwa-drawer-header"><div><p className="eyebrow brass">{eyebrow}</p><h2>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close panel"><X /></button></header>;
}

function TripsPanel({ onClose }: { onClose: () => void }) {
  const [trips, setTrips] = useState<PwaTrip[]>(readPwaTrips);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const update = () => setTrips(readPwaTrips());
    window.addEventListener("allan-trips-changed", update);
    return () => window.removeEventListener("allan-trips-changed", update);
  }, []);
  const refresh = async () => {
    setRefreshing(true);
    const refreshed = await Promise.all(trips.map(async trip => {
      try {
        const response = await fetch(`/api/tracking/${encodeURIComponent(trip.trackingToken)}`);
        if (!response.ok) return { ...trip, status: response.status === 404 ? "EXPIRED" : trip.status };
        const data = await response.json();
        return { ...trip, status: data.reservation?.status || trip.status };
      } catch {
        return trip;
      }
    }));
    setTrips(refreshed);
    replacePwaTrips(refreshed);
    setRefreshing(false);
  };
  useEffect(() => { if (trips.length) void refresh(); }, []);
  return <div className="pwa-drawer-content">
    <DrawerHeader eyebrow="Your reservations" title="My trips" onClose={onClose} />
    {!trips.length ? <div className="pwa-empty-state"><CalendarDays /><h3>Your trips will appear here.</h3><p>Book through the app and your secure tracking links will stay available on this device.</p><button type="button" className="solid-button" onClick={onClose}>Book a ride <MapPin /></button></div> : <div className="pwa-trip-list">
      <div className="pwa-panel-toolbar"><span>{trips.length} saved reservation{trips.length === 1 ? "" : "s"}</span><button type="button" onClick={refresh} disabled={refreshing}>{refreshing ? <LoaderCircle className="spin" /> : "Refresh"}</button></div>
      {trips.map(trip => <article className="pwa-trip-card" key={trip.trackingToken}>
        <div className="pwa-trip-card-top"><span className="eyebrow brass">Ride #{trip.reference}</span><b className={`pwa-status pwa-status-${trip.status.toLowerCase()}`}>{statusLabel(trip.status)}</b></div>
        <strong>{formatTripDate(trip.pickupAt)}</strong>
        <div className="pwa-trip-route"><span><i />{trip.pickup}</span><span><i />{trip.destination}</span></div>
        <div className="pwa-trip-actions"><button type="button" className="solid-button" onClick={() => window.location.assign(`/?source=pwa&tracking=${encodeURIComponent(trip.trackingToken)}`)}>View trip</button><button type="button" className="pwa-text-button" onClick={() => { forgetPwaTrip(trip.trackingToken); setTrips(current => current.filter(item => item.trackingToken !== trip.trackingToken)); }}>Remove</button></div>
      </article>)}
    </div>}
  </div>;
}

function WalletPanel({ onClose }: { onClose: () => void }) {
  const profile = useMemo(() => ({
    fullName: localStorage.getItem("rider_name") || "",
    email: localStorage.getItem("rider_email") || "",
  }), []);
  const [name, setName] = useState(profile.fullName);
  const [email, setEmail] = useState(profile.email);
  const [currentPayment, setCurrentPayment] = useState<SavedPayment | null>(readSavedPayment);
  const [localPayments, setLocalPayments] = useState<SavedPayment[]>(readWalletPayments);
  const [cards, setCards] = useState<StripeCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const refreshCards = async (payment = currentPayment) => {
    if (!payment || !email) {
      setCards([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await api("/api/payment-methods/list", { customerId: payment.customerId, email, capability: payment.capability });
      setCards(data.cards || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Saved cards could not be loaded.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const update = () => {
      setCurrentPayment(readSavedPayment());
      setLocalPayments(readWalletPayments());
    };
    window.addEventListener("allan-wallet-changed", update);
    return () => window.removeEventListener("allan-wallet-changed", update);
  }, []);
  useEffect(() => { if (currentPayment && email) void refreshCards(); }, [currentPayment?.paymentMethodId, email]);
  const addCard = (payment: SavedPayment) => {
    if (name.trim()) localStorage.setItem("rider_name", name.trim());
    if (email.trim()) localStorage.setItem("rider_email", email.trim().toLowerCase());
    saveSavedPayment(payment);
    setCurrentPayment(payment);
    setLocalPayments(readWalletPayments());
    setShowAdd(false);
    setNotice("Card added securely. It is now selected for future bookings.");
    setError("");
  };
  const deleteCard = async (card: StripeCard) => {
    const payment = localPayments.find(item => item.paymentMethodId === card.paymentMethodId) || currentPayment;
    if (!payment) {
      setError("This card can only be removed from the device where it was added.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api("/api/payment-methods/delete", { customerId: payment.customerId, email, capability: payment.capability, paymentMethodId: card.paymentMethodId });
      removeWalletPayment(card.paymentMethodId);
      setCurrentPayment(readSavedPayment());
      setLocalPayments(readWalletPayments());
      setCards(current => current.filter(item => item.paymentMethodId !== card.paymentMethodId));
      setNotice("Card removed from your wallet.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "That card could not be removed.");
    } finally {
      setLoading(false);
    }
  };
  const selectCard = (payment: SavedPayment) => {
    saveSavedPayment(payment);
    setCurrentPayment(payment);
    setNotice(`${payment.cardBrand.toUpperCase()} ending in ${payment.cardLast4} is selected for future bookings.`);
  };
  return <div className="pwa-drawer-content">
    <DrawerHeader eyebrow="Secure payment methods" title="Wallet" onClose={onClose} />
    <div className="pwa-wallet-intro"><ShieldCheck /><p>Your card details are handled by Stripe. Allen Limousine never stores your card number.</p></div>
    {!name || !email ? <div className="pwa-wallet-profile"><p className="drawer-label">Complete your wallet profile</p><label>Name<input value={name} onChange={event => setName(event.target.value)} placeholder="Your name" /></label><label>Email<input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label></div> : null}
    {error && <p className="form-error">{error}</p>}
    {notice && <p className="pwa-wallet-notice"><Check />{notice}</p>}
    <div className="pwa-wallet-toolbar"><div><p className="drawer-label">Saved cards</p><span>{cards.length || localPayments.length ? `${cards.length || localPayments.length} card${(cards.length || localPayments.length) === 1 ? "" : "s"}` : "No cards saved"}</span></div><button type="button" className="outline-button small" disabled={!name.trim() || !email.trim()} onClick={() => setShowAdd(value => !value)}>{showAdd ? <><X /> Close</> : <><Plus /> Add card</>}</button></div>
    {showAdd && <div className="pwa-wallet-add"><StripeCardSetup fullName={name} email={email} savedPayment={null} onSaved={addCard} /></div>}
    {loading && !showAdd ? <div className="pwa-wallet-loading"><LoaderCircle className="spin" />Loading saved cards…</div> : <div className="pwa-card-list">
      {cards.map(card => {
        const local = localPayments.find(item => item.paymentMethodId === card.paymentMethodId);
        return <article className={`pwa-card ${currentPayment?.paymentMethodId === card.paymentMethodId ? "selected" : ""}`} key={card.paymentMethodId}><div className="pwa-card-icon"><CreditCard /></div><div className="pwa-card-details"><b>{card.brand.toUpperCase()} •••• {card.last4}</b><span>Expires {String(card.expMonth).padStart(2, "0")}/{card.expYear}</span>{currentPayment?.paymentMethodId === card.paymentMethodId && <em>Selected for bookings</em>}</div><div className="pwa-card-actions">{local && currentPayment?.paymentMethodId !== card.paymentMethodId && <button type="button" onClick={() => selectCard(local)}>Use</button>}<button type="button" onClick={() => deleteCard(card)} aria-label={`Delete ${card.brand} card ending in ${card.last4}`}><Trash2 /></button></div></article>;
      })}
      {!cards.length && localPayments.map(payment => <article className="pwa-card selected" key={payment.paymentMethodId}><div className="pwa-card-icon"><CreditCard /></div><div className="pwa-card-details"><b>{payment.cardBrand.toUpperCase()} •••• {payment.cardLast4}</b><em>Selected for bookings</em></div><div className="pwa-card-actions"><button type="button" onClick={() => deleteCard({ paymentMethodId: payment.paymentMethodId, brand: payment.cardBrand, last4: payment.cardLast4, expMonth: 0, expYear: 0, isDefault: true })} aria-label={`Delete ${payment.cardBrand} card ending in ${payment.cardLast4}`}><Trash2 /></button></div></article>)}
    </div>}
  </div>;
}

function SupportPanel({ onClose }: { onClose: () => void }) {
  return <div className="pwa-drawer-content">
    <DrawerHeader eyebrow="Always available" title="Support" onClose={onClose} />
    <p className="pwa-support-copy">Our dispatch team can help with a reservation, pickup details, or a change to your itinerary.</p>
    <div className="pwa-support-actions"><a href="tel:+13125550188"><Phone /><span><b>Call dispatch</b><small>+1 312 555 0188</small></span></a><a href="sms:+13125550188"><Headphones /><span><b>Text dispatch</b><small>Send a message about your ride</small></span></a><a href="mailto:hello@allanlivery.com"><Mail /><span><b>Email the team</b><small>hello@allanlivery.com</small></span></a></div>
    <div className="pwa-support-note"><ShieldCheck /><span><b>For active rides</b><small>Open My Trips to view your secure reservation link and current chauffeur updates.</small></span></div>
  </div>;
}

export function PWABottomNav() {
  const [panel, setPanel] = useState<Panel>(null);
  const [tripCount, setTripCount] = useState(() => readPwaTrips().length);
  useEffect(() => {
    const update = () => setTripCount(readPwaTrips().length);
    window.addEventListener("allan-trips-changed", update);
    return () => window.removeEventListener("allan-trips-changed", update);
  }, []);
  const book = () => {
    setPanel(null);
    if (new URLSearchParams(window.location.search).has("tracking")) {
      window.location.assign("/?source=pwa#reserve");
      return;
    }
    document.getElementById("reserve")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return <>
    <nav className="pwa-bottom-nav" aria-label="App navigation">
      <button type="button" className={!panel ? "active" : ""} onClick={book}><MapPin /><span>Book</span></button>
      <button type="button" className={panel === "trips" ? "active" : ""} onClick={() => setPanel("trips")}><CalendarDays /><span>My Trips{tripCount > 0 && <i>{tripCount > 9 ? "9+" : tripCount}</i>}</span></button>
      <button type="button" className={panel === "wallet" ? "active" : ""} onClick={() => setPanel("wallet")}><WalletCards /><span>Wallet</span></button>
      <button type="button" className={panel === "support" ? "active" : ""} onClick={() => setPanel("support")}><Headphones /><span>Support</span></button>
    </nav>
    {panel && <div className="pwa-drawer-backdrop" role="presentation" onClick={() => setPanel(null)}><aside className="pwa-drawer" role="dialog" aria-modal="true" aria-label={panel === "trips" ? "My trips" : panel === "wallet" ? "Wallet" : "Support"} onClick={event => event.stopPropagation()}>{panel === "trips" ? <TripsPanel onClose={() => setPanel(null)} /> : panel === "wallet" ? <WalletPanel onClose={() => setPanel(null)} /> : <SupportPanel onClose={() => setPanel(null)} />}</aside></div>}
  </>;
}