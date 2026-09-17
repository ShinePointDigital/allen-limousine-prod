import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, CarFront, Check, Clock3, LocateFixed, MapPin, Plane, ShieldCheck, UserRound } from "lucide-react";
import { RATE_TIER_PRICING, type RateTier } from "../shared/pricing.js";
import StripeCardSetup, { type SavedPayment } from "./StripeCardSetup.js";
import DispatchTrackingStep, { type ActiveReservation } from "./DispatchTrackingStep.js";

type Point = { latitude: number; longitude: number };
type Suggestion = Point & { label: string };
type Fare = { fareCents: number; miles: number; minutes: number; eventVenue?: { name: string } | null; eventSurchargeCents?: number };
type AirportCode = "ORD" | "MDW";
type AirlineRule = { airline: string; airport: AirportCode; terminal: string };

const VEHICLES: { tier: RateTier; label: string; detail: string; capacity: number }[] = [
  { tier: "EXECUTIVE_SEDAN", label: "Executive Sedan", detail: "Up to 3 passengers", capacity: 3 },
  { tier: "LUXURY_SUV", label: "Luxury SUV", detail: "Up to 6 passengers", capacity: 6 },
  { tier: "SPRINTER_CLASS", label: "Mercedes Sprinter", detail: "Up to 14 passengers", capacity: 14 },
];
const AIRPORTS: Record<AirportCode, { name: string; terminals: string[] }> = {
  ORD: { name: "O’Hare International", terminals: ["Terminal 1", "Terminal 2", "Terminal 3", "Terminal 5"] },
  MDW: { name: "Midway International", terminals: ["Concourse A", "Concourse B", "Concourse C"] },
};
const AIRLINE_RULES: Record<string, AirlineRule> = {
  UA: { airline: "United Airlines", airport: "ORD", terminal: "Terminal 1" },
  AC: { airline: "Air Canada", airport: "ORD", terminal: "Terminal 2" },
  AA: { airline: "American Airlines", airport: "ORD", terminal: "Terminal 3" },
  AS: { airline: "Alaska Airlines", airport: "ORD", terminal: "Terminal 3" },
  NK: { airline: "Spirit Airlines", airport: "ORD", terminal: "Terminal 3" },
  DL: { airline: "Delta Air Lines", airport: "ORD", terminal: "Terminal 5" },
  BA: { airline: "British Airways", airport: "ORD", terminal: "Terminal 5" },
  LH: { airline: "Lufthansa", airport: "ORD", terminal: "Terminal 5" },
  WN: { airline: "Southwest Airlines", airport: "MDW", terminal: "Concourse B" },
  F9: { airline: "Frontier Airlines", airport: "MDW", terminal: "Concourse A" },
  PD: { airline: "Porter Airlines", airport: "MDW", terminal: "Concourse A" },
};
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
const hasWelcomePromo = (code: string | null | undefined) => code === "WELCOME15" || code === "FIRST15";
const readSavedPayment = (): SavedPayment | null => {
  try {
    const value = localStorage.getItem("allen-saved-payment");
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};
const localDateTime = (offsetMinutes = 0) => {
  const value = new Date(Date.now() + offsetMinutes * 60_000);
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const launchedAsPwa = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
const detectAirport = (value: string): AirportCode | null => {
  const text = value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (text.includes("o hare") || text.includes("ohare") || /\bord\b/.test(text)) return "ORD";
  if (text.includes("midway") || /\bmdw\b/.test(text)) return "MDW";
  return null;
};
const parseFlightNumber = (value: string, routeAirport: AirportCode | null) => {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = normalized.match(/^([A-Z]{2}|[A-Z]\d|[A-Z]{3})(\d{1,4}[A-Z]?)$/);
  if (!match) return { normalized, airline: "", airport: routeAirport, terminal: "", valid: false, ruleAirport: null as AirportCode | null };
  const rule = AIRLINE_RULES[match[1]];
  const airport = routeAirport || rule?.airport || null;
  return {
    normalized: `${match[1]} ${match[2]}`,
    airline: rule?.airline || match[1],
    airport,
    terminal: rule && rule.airport === airport ? rule.terminal : "",
    valid: true,
    ruleAirport: rule?.airport || null,
  };
};
const validRiderProfile = (contact: { fullName: string; phone: string; email: string }) =>
  contact.fullName.trim().length >= 2 &&
  contact.phone.replace(/\D/g, "").length >= 7 &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email.trim());
const request = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("The booking service returned an invalid response.");
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};

function SmartLocation({ label, value, placeholder, onType, onSelect, currentLocation }: {
  label: string;
  value: string;
  placeholder: string;
  onType: (value: string) => void;
  onSelect: (value: string, point: Point) => void;
  currentLocation?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  useEffect(() => {
    if (!focused || value.trim().length < 3) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      request(`/api/location-search?q=${encodeURIComponent(value.trim())}`, { signal: controller.signal })
        .then(result => setSuggestions(result.locations || []))
        .catch(() => setSuggestions([]));
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [focused, value]);
  return <div className="wizard-location">
    <label>{label}</label>
    <div><MapPin /><input ref={input} value={value} required placeholder={placeholder} autoComplete="off" onFocus={() => setFocused(true)} onChange={event => onType(event.target.value)} />{currentLocation && <button type="button" onClick={currentLocation} aria-label="Use current location"><LocateFixed /></button>}</div>
    {focused && suggestions.length > 0 && <section>{suggestions.map(item => <button type="button" key={`${item.latitude}-${item.longitude}`} onClick={() => { onSelect(item.label, item); setSuggestions([]); setFocused(false); }}><MapPin /><span>{item.label}</span></button>)}</section>}
  </div>;
}

export default function BookingWizard() {
  const [bookingRequestId, setBookingRequestId] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState(1);
  const [route, setRoute] = useState({ pickup: "", destination: "" });
  const [points, setPoints] = useState<{ pickup?: Point; destination?: Point }>({});
  const [locationStatus, setLocationStatus] = useState("");
  const [fares, setFares] = useState<Partial<Record<RateTier, Fare>>>({});
  const [fareState, setFareState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [tier, setTier] = useState<RateTier>("EXECUTIVE_SEDAN");
  const [timing, setTiming] = useState<"RIDE_NOW" | "RESERVE_LATER">("RESERVE_LATER");
  const [pickupAt, setPickupAt] = useState(localDateTime(60));
  const [serviceType, setServiceType] = useState("Point-to-Point");
  const [isPrivateFBO, setIsPrivateFBO] = useState(false);
  const [fboDetails, setFboDetails] = useState({ specificTailNumber: "", principalName: "", fboName: "", tarmacInstructions: "" });
  const [airport, setAirport] = useState<{ code: AirportCode | null; terminal: string; flight: string; airline: string }>({ code: null, terminal: "", flight: "", airline: "" });
  const [contact, setContact] = useState({ fullName: "", phone: "", email: "", passengers: "1", notes: "" });
  const [needsOnboarding, setNeedsOnboarding] = useState(() => launchedAsPwa() && !["rider_name", "rider_phone", "rider_email"].every(key => localStorage.getItem(key)?.trim()));
  const [hasRiderProfile, setHasRiderProfile] = useState(() => ["rider_name", "rider_phone", "rider_email"].every(key => localStorage.getItem(key)?.trim()));
  const [editingProfile, setEditingProfile] = useState(false);
  const [promoCode, setPromoCode] = useState(() => launchedAsPwa() ? localStorage.getItem("allan_first_ride_promo") || "" : "");
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [savedPayment, setSavedPayment] = useState<SavedPayment | null>(readSavedPayment);
  const [paymentNotice, setPaymentNotice] = useState("");
  const [pendingTrackingToken, setPendingTrackingToken] = useState("");
  const [rideNowPickupAt, setRideNowPickupAt] = useState("");
  const trackingTokenFromUrl = useState(() => new URLSearchParams(window.location.search).get("tracking") || "")[0];
  const [trackingLinkState, setTrackingLinkState] = useState<"idle" | "loading" | "ready" | "error">(trackingTokenFromUrl ? "loading" : "idle");
  const [activeReservation, setActiveReservation] = useState<ActiveReservation | null>(null);
  const savePayment = (payment: SavedPayment) => {
    localStorage.setItem("allen-saved-payment", JSON.stringify(payment));
    localStorage.setItem("stripe_customer_id", payment.customerId);
    localStorage.setItem("default_payment_method_id", payment.paymentMethodId);
    localStorage.setItem("card_brand", payment.cardBrand);
    localStorage.setItem("card_last4", payment.cardLast4);
    setSavedPayment(payment);
  };

  const pickup = typeof route.pickup === "string" ? route.pickup : "";
  const destination = typeof route.destination === "string" ? route.destination : "";
  const routeAirport = detectAirport(`${pickup} ${destination}`);
  const detectedAirport = routeAirport || airport.code;
  useEffect(() => {
    try { localStorage.removeItem("allen_active_reservation"); } catch { /* Storage may be unavailable in private browsing. */ }
    const riderProfile = {
      fullName: localStorage.getItem("rider_name") || "",
      phone: localStorage.getItem("rider_phone") || "",
      email: localStorage.getItem("rider_email") || "",
    };
    const saved = localStorage.getItem("allan-booking-contact");
    if (saved) try {
      const populatedProfile = Object.fromEntries(Object.entries(riderProfile).filter(([, value]) => value));
      setContact(current => ({ ...current, ...JSON.parse(saved), ...populatedProfile }));
    } catch { setContact(current => ({ ...current, ...riderProfile })); }
    else setContact(current => ({ ...current, ...riderProfile }));
    if (!needsOnboarding) useCurrentLocation();
  }, []);
  useEffect(() => {
    if (!trackingTokenFromUrl) return;
    let cancelled = false;
    fetch(`/api/tracking/${encodeURIComponent(trackingTokenFromUrl)}`)
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "This tracking link has expired or is no longer available.");
        return data.reservation;
      })
      .then(reservation => {
        if (cancelled) return;
        setActiveReservation({
          trackingToken: trackingTokenFromUrl,
          inquiryId: reservation.inquiryId,
          reference: reservation.reference,
          pickupAt: reservation.pickupAt,
          pickup: reservation.pickup,
          destination: reservation.destination,
          fareCents: reservation.fareCents || 0,
          paymentNotice: reservation.fareCents ? `${money(reservation.fareCents)} fare confirmed` : "Payment authorization confirmed.",
          flightNumber: reservation.flightNumber || undefined,
          pickupPoint: reservation.pickupLatitude != null && reservation.pickupLongitude != null ? { latitude: reservation.pickupLatitude, longitude: reservation.pickupLongitude } : undefined,
          destinationPoint: reservation.destinationLatitude != null && reservation.destinationLongitude != null ? { latitude: reservation.destinationLatitude, longitude: reservation.destinationLongitude } : undefined,
          createdAt: reservation.updatedAt || new Date().toISOString(),
        });
        setTrackingLinkState("ready");
      })
      .catch(() => {
        if (!cancelled) setTrackingLinkState("error");
      });
    return () => { cancelled = true; };
  }, [trackingTokenFromUrl]);
  useEffect(() => {
    const prefill = (event: Event) => {
      const detail = (event as CustomEvent<{ destination?: string; isPrivateFBO?: boolean }>).detail;
      if (!detail) return;
      setStep(1);
      setIsPrivateFBO(Boolean(detail.isPrivateFBO));
      setTier("EXECUTIVE_SEDAN");
      setServiceType(detail.isPrivateFBO ? "Private Aviation / FBO" : "Point-to-Point");
      setRoute(current => ({ ...current, destination: detail.destination || "" }));
      setPoints(current => ({ ...current, destination: undefined }));
    };
    window.addEventListener("allen-booking-prefill", prefill);
    return () => window.removeEventListener("allen-booking-prefill", prefill);
  }, []);
  useEffect(() => {
    if (!routeAirport) {
      setAirport(current => current.code ? { code: null, terminal: "", flight: "", airline: "" } : current);
      return;
    }
    setAirport(current => {
      if (current.code === routeAirport) return current;
      const parsed = parseFlightNumber(current.flight, routeAirport);
      return { ...current, code: routeAirport, terminal: parsed.terminal, airline: parsed.airline };
    });
  }, [routeAirport]);
  useEffect(() => {
    if (pickup.trim().length < 3 || destination.trim().length < 3) { setFareState("idle"); setFares({}); return; }
    setFareState("loading");
    setFares({});
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const entries = await Promise.all(VEHICLES.map(async vehicle => {
           const query = new URLSearchParams({ pickup, destination, tier: vehicle.tier, isPrivateFBO: String(isPrivateFBO) });
          if (points.pickup) { query.set("pickupLat", String(points.pickup.latitude)); query.set("pickupLon", String(points.pickup.longitude)); }
          if (points.destination) { query.set("destinationLat", String(points.destination.latitude)); query.set("destinationLon", String(points.destination.longitude)); }
          return [vehicle.tier, await request(`/api/fare/calculate?${query}`, { signal: controller.signal })] as const;
        }));
        setFares(Object.fromEntries(entries));
        setFareState("ready");
      } catch {
        if (!controller.signal.aborted) setFareState("error");
      }
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
   }, [pickup, destination, points, isPrivateFBO]);

  function useCurrentLocation() {
    if (!navigator.geolocation) { setLocationStatus("Location is unavailable. Enter your pickup manually."); return; }
    setLocationStatus("Finding your current location…");
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        const result = await request(`/api/reverse-geocode?lat=${point.latitude}&lon=${point.longitude}`);
        if (typeof result.address !== "string" || !result.address.trim()) {
          throw new Error("Current location address was unavailable.");
        }
        setRoute(current => ({ ...current, pickup: result.address }));
        setPoints(current => ({ ...current, pickup: point }));
        setLocationStatus(`Current location added · accurate to about ${Math.round(position.coords.accuracy)} m`);
      } catch { setLocationStatus("Enter your pickup manually."); }
    }, error => {
      const message = error.code === error.PERMISSION_DENIED
        ? "Location permission is off. Allow location access for this app, then tap the location button."
        : error.code === error.TIMEOUT
          ? "Location took too long. Move near a window and tap the location button to retry."
          : "Your phone couldn’t determine its location. Tap the location button to retry or enter pickup manually.";
      setLocationStatus(message);
    }, {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 60_000,
    });
  }
  const selectedFare = fares[tier];
  const selectedVehicle = VEHICLES.find(vehicle => vehicle.tier === tier)!;
  const availableVehicles = isPrivateFBO ? VEHICLES.filter(vehicle => vehicle.tier !== "SPRINTER_CLASS") : VEHICLES;
  const promoDiscount = !isPrivateFBO && hasWelcomePromo(promoCode) && selectedFare ? Math.min(1500, selectedFare.fareCents) : 0;
  const finalFareCents = selectedFare ? selectedFare.fareCents - promoDiscount : 0;
  const parsedFlight = parseFlightNumber(airport.flight, routeAirport);
  const flightMatchesAirport = !detectedAirport || !parsedFlight.ruleAirport || parsedFlight.ruleAirport === detectedAirport;
  const flightReady = Boolean(parsedFlight.valid && flightMatchesAirport && airport.terminal);
  const fboReady = Object.values(fboDetails).every(value => value.trim().length > 1);
  const canContinueRoute = pickup.trim().length > 2 && destination.trim().length > 2 && (!isPrivateFBO || fboReady);
  const profileValid = validRiderProfile(contact);
  const updateFlight = (value: string) => {
    const parsed = parseFlightNumber(value, routeAirport);
    setAirport(current => ({
      code: parsed.airport,
      terminal: parsed.terminal || (current.code === parsed.airport ? current.terminal : ""),
      flight: parsed.normalized,
      airline: parsed.airline,
    }));
  };
  const scheduledPickupTime = timing === "RIDE_NOW" ? Date.now() + 15 * 60_000 : new Date(pickupAt).getTime();
  const withinAuthorizationWindow = scheduledPickupTime <= Date.now() + 6 * 24 * 60 * 60 * 1000;
  const validSchedule = scheduledPickupTime > Date.now() && withinAuthorizationWindow;
  const canBook = Boolean(selectedFare && profileValid && validSchedule && Number(contact.passengers) <= selectedVehicle.capacity);
  const next = () => { setError(""); setStep(current => Math.min(4, current + 1)); };
  const submit = async () => {
    if (!selectedFare || !savedPayment?.capability) {
      setError("Add a payment card before booking.");
      return;
    }
    setSubmitState("sending");
    setError("");
    const effectivePickupAt = timing === "RIDE_NOW"
      ? rideNowPickupAt || new Date(Date.now() + 15 * 60_000).toISOString()
      : new Date(pickupAt).toISOString();
    if (timing === "RIDE_NOW" && !rideNowPickupAt) setRideNowPickupAt(effectivePickupAt);
    try {
      localStorage.setItem("allan-booking-contact", JSON.stringify({ fullName: contact.fullName, phone: contact.phone, email: contact.email }));
      if (hasRiderProfile || editingProfile || launchedAsPwa()) {
        localStorage.setItem("rider_name", contact.fullName);
        localStorage.setItem("rider_phone", contact.phone);
        localStorage.setItem("rider_email", contact.email);
      }
      const result = await request("/api/inquiries", {
        method: "POST",
        body: JSON.stringify({
          ...contact,
          passengers: Number(contact.passengers),
          pickup: route.pickup,
          destination: route.destination,
          pickupAt: effectivePickupAt,
          serviceType,
          rideTiming: timing,
          rateTier: tier,
          estimatedFareCents: finalFareCents,
          estimatedMiles: selectedFare.miles,
          estimatedMinutes: selectedFare.minutes,
          promoCode: !isPrivateFBO && promoCode ? promoCode : undefined,
          promoDiscountCents: promoDiscount || undefined,
          bookingRequestId,
          pickupLatitude: points.pickup?.latitude,
          pickupLongitude: points.pickup?.longitude,
          destinationLatitude: points.destination?.latitude,
          destinationLongitude: points.destination?.longitude,
           isPrivateFBO,
           ...(isPrivateFBO ? fboDetails : {}),
           ...(!isPrivateFBO && detectedAirport ? {
            airportCode: detectedAirport,
            airportTerminal: airport.terminal,
            flightNumber: airport.flight,
            pickupPreference: "Meet & Greet",
          } : {}),
        }),
      });
      const trackingToken = typeof result.trackingToken === "string" ? result.trackingToken : pendingTrackingToken;
      if (!trackingToken) throw new Error("The secure booking session expired. Start a new booking and try again.");
      setPendingTrackingToken(trackingToken);
      const payment = await request("/api/create-payment-intent", {
        method: "POST",
        body: JSON.stringify({
          bookingRequestId,
          customerId: savedPayment.customerId,
          paymentMethodId: savedPayment.paymentMethodId,
          capability: savedPayment.capability,
          trackingToken,
        }),
      });
      if (payment.status !== "requires_capture") throw new Error("The card authorization hold was not completed.");
      const finalPaymentNotice = `A ${money(result.inquiry.estimatedFareCents)} authorization hold was placed on your card. It will be captured when your driver completes the ride.`;
      if (!isPrivateFBO && hasWelcomePromo(promoCode)) {
        localStorage.removeItem("allan_first_ride_promo");
        setPromoCode("");
      }
      if (!isPrivateFBO && !hasWelcomePromo(result.inquiry?.promoCode)) localStorage.removeItem("allan_first_ride_promo");
      setPaymentNotice(finalPaymentNotice);
      setSubmitState("success");
      setPendingTrackingToken("");
      setRideNowPickupAt("");
    } catch (reason) {
      setSubmitState("error");
      setError(reason instanceof Error ? reason.message : "Unable to submit your booking.");
    }
  };

  if (needsOnboarding && !trackingTokenFromUrl) {
    const saveProfile = () => {
      if (!contact.fullName || !contact.phone || !contact.email) return;
      localStorage.setItem("rider_name", contact.fullName);
      localStorage.setItem("rider_phone", contact.phone);
      localStorage.setItem("rider_email", contact.email);
      localStorage.setItem("allan_first_ride_promo", "WELCOME15");
      localStorage.setItem("allan-booking-contact", JSON.stringify({ fullName: contact.fullName, phone: contact.phone, email: contact.email }));
      setPromoCode("WELCOME15");
      setNeedsOnboarding(false);
      setHasRiderProfile(true);
      useCurrentLocation();
    };
    return <section className="pwa-onboarding"><div className="onboarding-card"><div className="onboarding-offer">$15 FIRST-RIDE CREDIT</div><p className="eyebrow brass">Welcome to Allen Limousine</p><h1>Set up once.<br /><em>Ride in one tap.</em></h1><p>Save your passenger profile and payment method for faster bookings and direct chauffeur updates.</p><div className="onboarding-fields"><label className="wizard-field">Full name<input autoFocus value={contact.fullName} onChange={event => setContact(current => ({ ...current, fullName: event.target.value }))} placeholder="Your name" /></label><label className="wizard-field">Phone number<input value={contact.phone} onChange={event => setContact(current => ({ ...current, phone: event.target.value }))} placeholder="+1 214…" /></label><label className="wizard-field">Email<input type="email" value={contact.email} onChange={event => setContact(current => ({ ...current, email: event.target.value }))} placeholder="you@example.com" /></label></div><StripeCardSetup fullName={contact.fullName} email={contact.email} savedPayment={savedPayment} onSaved={savePayment} /><button className="solid-button" disabled={!contact.fullName || !contact.phone || !contact.email} onClick={saveProfile}>{savedPayment ? "Save profile & start booking" : "Continue — pay later"} <ArrowRight /></button><small>Card details are tokenized by Stripe. Allen Limousine never stores your card number.</small></div></section>;
  }

  if (trackingLinkState === "loading") return <section id="reserve" className="booking-wizard-section section-pad"><div className="wizard-success"><p className="eyebrow brass">Secure reservation link</p><h2>Loading your<br /><em>ride updates.</em></h2><p>We’re retrieving the latest details for your reservation.</p></div></section>;
  if (trackingLinkState === "error") return <section id="reserve" className="booking-wizard-section section-pad"><div className="wizard-success"><p className="eyebrow brass">Secure reservation link</p><h2>Tracking is<br /><em>unavailable.</em></h2><p>This link has expired or is no longer available. Please contact Allen Limousine if you need help with this reservation.</p></div></section>;
  if (activeReservation) return <DispatchTrackingStep reservation={activeReservation} onComplete={() => {
    setActiveReservation(null);
    setSubmitState("idle");
    setStep(1);
    setBookingRequestId(crypto.randomUUID());
    setPaymentNotice("");
    useCurrentLocation();
  }} />;

  if (submitState === "success") return <section id="reserve" className="booking-wizard-section section-pad"><div className="wizard-success"><Check /><p className="eyebrow brass">Request received</p><h2>Your ride is<br /><em>in motion.</em></h2><p>We saved your trip and sent it to the Allen Limousine team for confirmation. We’ll text a secure tracking link to {contact.phone} so you can follow your reservation.</p>{paymentNotice && <p className="payment-result">{paymentNotice}</p>}<button className="solid-button" onClick={() => { setSubmitState("idle"); setStep(1); setBookingRequestId(crypto.randomUUID()); setPaymentNotice(""); useCurrentLocation(); }}>Book another ride</button></div></section>;

  return <section id="reserve" className="booking-wizard-section section-pad">
    <div className="wizard-shell">
       <header className="wizard-header"><div><p className="eyebrow brass">{isPrivateFBO ? "Private aviation coordination" : "Book your chauffeur"}</p><h2>{["Where are you going?", "Choose your vehicle", "Schedule your ride", "Review & payment"][step - 1]}</h2></div><span>0{step} / 04</span></header>
      <nav className="wizard-progress" aria-label="Booking progress">{[1, 2, 3, 4].map(number => <i key={number} className={number <= step ? "active" : ""} />)}</nav>
      <main className="wizard-body">
        {step === 1 && <div className="wizard-step">
          {!isPrivateFBO && hasWelcomePromo(promoCode) && <div className="wizard-promo"><Check /><span><b>$15 first-ride credit applied</b><small>Promo WELCOME15 will be included with your booking.</small></span></div>}
          <SmartLocation label="Pickup location" value={pickup} placeholder="Address, hotel, airport, or landmark" currentLocation={useCurrentLocation} onType={value => { setRoute(current => ({ ...current, pickup: value })); setPoints(current => ({ ...current, pickup: undefined })); }} onSelect={(value, point) => { setRoute(current => ({ ...current, pickup: value })); setPoints(current => ({ ...current, pickup: point })); }} />
          <small className="wizard-location-status">{locationStatus}</small>
           <SmartLocation label="Drop-off location" value={destination} placeholder="Where should we take you?" onType={value => { setRoute(current => ({ ...current, destination: value })); setPoints(current => ({ ...current, destination: undefined })); }} onSelect={(value, point) => { setRoute(current => ({ ...current, destination: value })); setPoints(current => ({ ...current, destination: point })); }} />
           {isPrivateFBO ? <div className="wizard-fbo-fields"><header><Plane /><div><b>Private aviation details</b><span>Required for ramp access and FBO coordination.</span></div></header><label className="wizard-field">Specific Tail Number<input required maxLength={40} value={fboDetails.specificTailNumber} onChange={event => setFboDetails(current => ({ ...current, specificTailNumber: event.target.value.toUpperCase() }))} placeholder="N123AB" autoComplete="off" /></label><label className="wizard-field">Passenger Name / Principal<input required maxLength={100} value={fboDetails.principalName} onChange={event => setFboDetails(current => ({ ...current, principalName: event.target.value }))} placeholder="Passenger or principal name" /></label><label className="wizard-field">FBO / Jet Center Name<input required maxLength={100} value={fboDetails.fboName} onChange={event => setFboDetails(current => ({ ...current, fboName: event.target.value }))} placeholder="Signature, Atlantic, Hawthorne…" /></label><label className="wizard-field wizard-fbo-instructions">Ramp/Tarmac Escort Instructions<textarea required maxLength={400} value={fboDetails.tarmacInstructions} onChange={event => setFboDetails(current => ({ ...current, tarmacInstructions: event.target.value }))} placeholder="Access contact, gate, escort procedure, or aircraft-side instructions…" /></label></div> : <><label className="wizard-field wizard-flight-field">Airline flight number<input value={airport.flight} onChange={event => updateFlight(event.target.value)} placeholder="UA 1234 or WN 567" inputMode="text" autoComplete="off" /><small>Enter the airline code and flight number. We’ll identify O’Hare or Midway and suggest the terminal.</small></label>{detectedAirport && <div className="wizard-airport"><header><Plane /><div><b>{AIRPORTS[detectedAirport].name}</b><span>{airport.airline ? `${airport.airline} · flight ${airport.flight}` : "Chicago airport detected from your route"}</span></div></header><label>Airport<input readOnly value={`${detectedAirport} · ${AIRPORTS[detectedAirport].name}`} /></label><label>Terminal / concourse<select required value={airport.terminal} onChange={event => setAirport(current => ({ ...current, terminal: event.target.value }))}><option value="">Select terminal</option>{AIRPORTS[detectedAirport].terminals.map(item => <option key={item}>{item}</option>)}</select></label></div>}{detectedAirport && airport.flight && (!parsedFlight.valid || !flightMatchesAirport) && <p className="form-error">{!parsedFlight.valid ? "Enter a valid airline code and flight number, such as UA 1234 or WN 567." : `${airport.airline || "This airline"} does not use ${AIRPORTS[detectedAirport].name}. Check the flight number or airport.`}</p>}</>}
           {fareState === "error" && <p className="form-error">We couldn’t calculate this route. Select an address suggestion or add a more specific address.</p>}
           {detectedAirport && !flightReady && <small className="wizard-flight-note">Flight details are optional for fare review. Add an airline flight number and terminal when available for airport coordination.</small>}
          <button className="solid-button wizard-next" disabled={!canContinueRoute || fareState === "loading"} onClick={next}>{fareState === "loading" ? "Calculating route…" : <>See vehicles & fares <ArrowRight /></>}</button>
        </div>}
         {step === 2 && <div className="wizard-step"><div className="wizard-route-summary"><MapPin /><span>{route.pickup}</span><ArrowRight /><span>{route.destination}</span></div>{isPrivateFBO && <div className="wizard-fbo-rate-note"><Plane /><span><b>Private aviation rate</b><small>Includes dedicated FBO coordination and $35 tarmac handling. $150 minimum.</small></span></div>}<div className="wizard-vehicles">{availableVehicles.map(vehicle => { const fare = fares[vehicle.tier]; const discount = !isPrivateFBO && hasWelcomePromo(promoCode) && fare ? Math.min(1500, fare.fareCents) : 0; return <button type="button" key={vehicle.tier} className={tier === vehicle.tier ? "selected" : ""} onClick={() => { setTier(vehicle.tier); setContact(current => ({ ...current, passengers: String(Math.min(Number(current.passengers), vehicle.capacity)) })); }}><CarFront /><div><b>{vehicle.label}</b><span>{vehicle.detail}</span><small>Guaranteed Upfront Fare • Tolls &amp; Fees Included • Zero Surge</small></div>{fareState === "loading" ? <i className="fare-shimmer" /> : <strong>{fare ? <>{discount > 0 && <del>{money(fare.fareCents)}</del>}{money(fare.fareCents - discount)}</> : "Unavailable"}</strong>}</button>; })}</div><div className="wizard-actions"><button className="wizard-back" onClick={() => setStep(1)}><ArrowLeft /> Back</button><button className="solid-button" disabled={!selectedFare} onClick={next}>Choose {RATE_TIER_PRICING[tier].label} <ArrowRight /></button></div></div>}
        {step === 3 && <div className="wizard-step">
          <div className="wizard-toggle"><button className={timing === "RIDE_NOW" ? "active" : ""} onClick={() => setTiming("RIDE_NOW")}><Clock3 />Ride Now</button><button className={timing === "RESERVE_LATER" ? "active" : ""} onClick={() => setTiming("RESERVE_LATER")}><CalendarDays />Reserve for Later</button></div>
          {timing === "RESERVE_LATER" && <label className="wizard-field">Pickup date &amp; time<input type="datetime-local" required min={localDateTime()} value={pickupAt} onChange={event => setPickupAt(event.target.value)} /></label>}
          {!withinAuthorizationWindow && <p className="form-error">Card authorization holds can be placed up to six days before pickup. Choose an earlier pickup time to continue.</p>}
           {!isPrivateFBO && <div className="wizard-toggle"><button className={serviceType === "Point-to-Point" ? "active" : ""} onClick={() => setServiceType("Point-to-Point")}>Point-to-Point</button><button className={serviceType === "Hourly Charter" ? "active" : ""} onClick={() => setServiceType("Hourly Charter")}>Hourly Charter</button></div>}
          {hasRiderProfile && !editingProfile ? <div className="wizard-profile-summary"><UserRound /><div><small>Rider profile</small><b>{contact.fullName}</b><span>{contact.phone} · {contact.email}</span></div><button type="button" onClick={() => setEditingProfile(true)}>Edit</button><Check /></div> : <><div className="wizard-contact-grid"><label className="wizard-field">Full name<input required value={contact.fullName} onChange={event => setContact(current => ({ ...current, fullName: event.target.value }))} placeholder="Your name" /></label><label className="wizard-field">Phone<input required value={contact.phone} onChange={event => setContact(current => ({ ...current, phone: event.target.value }))} placeholder="+1 312…" /></label><label className="wizard-field">Email<input required type="email" value={contact.email} onChange={event => setContact(current => ({ ...current, email: event.target.value }))} placeholder="you@example.com" /></label></div>{!profileValid && <small className="wizard-profile-help">Enter a valid name, phone number, and email to enable one-tap booking.</small>}</>}
          <div className="wizard-trip-options"><label className="wizard-field">Passengers<select value={contact.passengers} onChange={event => setContact(current => ({ ...current, passengers: event.target.value }))}>{Array.from({ length: selectedVehicle.capacity }, (_, index) => index + 1).map(number => <option key={number}>{number}</option>)}</select></label><label className="wizard-field">Notes<textarea value={contact.notes} onChange={event => setContact(current => ({ ...current, notes: event.target.value }))} placeholder="Luggage, accessibility, or itinerary notes…" /></label></div>
          {error && <p className="form-error">{error}</p>}
          <div className="wizard-actions"><button className="wizard-back" onClick={() => setStep(2)}><ArrowLeft /> Back</button><button className="solid-button" disabled={!canBook} onClick={next}>Continue to payment <ArrowRight /></button></div>
        </div>}
        {step === 4 && <div className="wizard-step">
          <div className="wizard-final-summary"><ShieldCheck /><div><b>{timing === "RIDE_NOW" ? "Pickup as soon as possible" : new Date(pickupAt).toLocaleString()}</b><span>{RATE_TIER_PRICING[tier].label} · {serviceType} · {route.pickup} → {route.destination}</span>{isPrivateFBO && <span>{fboDetails.fboName} · Tail {fboDetails.specificTailNumber} · Principal {fboDetails.principalName}</span>}</div><strong>{selectedFare && money(finalFareCents)}</strong></div>
          <StripeCardSetup compact requiredPayment fullName={contact.fullName} email={contact.email} savedPayment={savedPayment} onSaved={savePayment} />
          <div className="wizard-pay-later"><ShieldCheck /><span><b>Authorization hold today</b><small>{money(finalFareCents)} will be authorized now and captured only after your driver completes the ride.</small></span></div>
          {error && <p className="form-error">{error}</p>}
          <div className="wizard-actions"><button className="wizard-back" onClick={() => setStep(3)}><ArrowLeft /> Back</button><button className="solid-button wizard-instant-book" disabled={submitState === "sending" || !canBook || !savedPayment?.capability} onClick={submit}>{submitState === "sending" ? "Authorizing…" : <>Authorize &amp; book · {money(finalFareCents)} <Check /></>}</button></div>
        </div>}
      </main>
    </div>
  </section>;
}