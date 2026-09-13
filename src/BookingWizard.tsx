import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, CarFront, Check, Clock3, LocateFixed, MapPin, Plane, ShieldCheck, UserRound } from "lucide-react";
import { RATE_TIER_PRICING, type RateTier } from "../shared/pricing.js";
import StripeCardSetup, { type SavedPayment } from "./StripeCardSetup.js";
import DispatchTrackingStep, { type ActiveReservation } from "./DispatchTrackingStep.js";

type Point = { latitude: number; longitude: number };
type Suggestion = Point & { label: string };
type Fare = { fareCents: number; miles: number; minutes: number; eventVenue?: { name: string } | null; eventSurchargeCents?: number };
type AirportCode = "DFW" | "DAL";

const VEHICLES: { tier: RateTier; label: string; detail: string }[] = [
  { tier: "EXECUTIVE_SEDAN", label: "Executive Sedan", detail: "Up to 3 passengers" },
  { tier: "LUXURY_SUV", label: "Luxury SUV", detail: "Up to 6 passengers" },
  { tier: "SPRINTER_CLASS", label: "Mercedes Sprinter", detail: "Up to 14 passengers" },
];
const DFW_TERMINALS = ["Terminal A", "Terminal B", "Terminal C", "Terminal D", "Terminal E"];
const DFW_LANES = ["Lower-Level Curbside Staging", "Baggage Meet & Greet"];
const DAL_LANES = ["Garage C / Valet Pavilion", "Lower-Level Curbside", "Baggage Meet & Greet"];
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
  if (text.includes("dallas fort worth") || text.includes("dfw")) return "DFW";
  if (text.includes("dallas love field") || /\bdal\b/.test(text)) return "DAL";
  return null;
};
const request = async (url: string, options?: RequestInit) => {
  const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
};

let placesLoader: Promise<boolean> | null = null;
function loadPlaces() {
  const googleWindow = window as Window & { google?: any };
  if (googleWindow.google?.maps?.places) return Promise.resolve(true);
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.resolve(false);
  placesLoader ??= new Promise(resolve => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&loading=async`;
    script.async = true;
    script.onload = () => resolve(Boolean(googleWindow.google?.maps?.places));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
  return placesLoader;
}

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
  const [googleActive, setGoogleActive] = useState(false);
  useEffect(() => {
    let listener: { remove?: () => void } | undefined;
    loadPlaces().then(active => {
      if (!active || !input.current) return;
      const googleWindow = window as Window & { google?: any };
      const autocomplete = new googleWindow.google.maps.places.Autocomplete(input.current, {
        componentRestrictions: { country: "us" },
        fields: ["formatted_address", "geometry", "name"],
      });
      listener = autocomplete.addListener("place_changed", () => {
        const place = autocomplete.getPlace();
        const latitude = place.geometry?.location?.lat();
        const longitude = place.geometry?.location?.lng();
        const address = place.formatted_address || place.name;
        if (address && Number.isFinite(latitude) && Number.isFinite(longitude)) onSelect(address, { latitude, longitude });
      });
      setGoogleActive(true);
    });
    return () => listener?.remove?.();
  }, []);
  useEffect(() => {
    if (googleActive || !focused || value.trim().length < 3) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      request(`/api/location-search?q=${encodeURIComponent(value.trim())}`, { signal: controller.signal })
        .then(result => setSuggestions(result.locations || []))
        .catch(() => setSuggestions([]));
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [focused, googleActive, value]);
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
  const [airport, setAirport] = useState({ code: "DFW" as AirportCode, terminal: "", lane: "", flight: "" });
  const [contact, setContact] = useState({ fullName: "", phone: "", email: "", passengers: "1", notes: "" });
  const [needsOnboarding, setNeedsOnboarding] = useState(() => launchedAsPwa() && !["rider_name", "rider_phone", "rider_email"].every(key => localStorage.getItem(key)?.trim()));
  const [promoCode, setPromoCode] = useState(() => launchedAsPwa() ? localStorage.getItem("allan_first_ride_promo") || "" : "");
  const [submitState, setSubmitState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [savedPayment, setSavedPayment] = useState<SavedPayment | null>(readSavedPayment);
  const [authorizeCard, setAuthorizeCard] = useState(() => Boolean(readSavedPayment()?.capability));
  const [paymentNotice, setPaymentNotice] = useState("");
  const [activeReservation, setActiveReservation] = useState<ActiveReservation | null>(() => {
    try { return JSON.parse(localStorage.getItem("allen_active_reservation") || "null"); } catch { return null; }
  });
  const savePayment = (payment: SavedPayment) => {
    localStorage.setItem("allen-saved-payment", JSON.stringify(payment));
    localStorage.setItem("stripe_customer_id", payment.customerId);
    localStorage.setItem("default_payment_method_id", payment.paymentMethodId);
    localStorage.setItem("card_brand", payment.cardBrand);
    localStorage.setItem("card_last4", payment.cardLast4);
    setSavedPayment(payment);
    setAuthorizeCard(true);
  };

  const detectedAirport = detectAirport(`${route.pickup} ${route.destination}`);
  useEffect(() => {
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
    if (detectedAirport && detectedAirport !== airport.code) setAirport({ code: detectedAirport, terminal: "", lane: "", flight: "" });
  }, [detectedAirport]);
  useEffect(() => {
    if (route.pickup.trim().length < 3 || route.destination.trim().length < 3) { setFareState("idle"); setFares({}); return; }
    setFareState("loading");
    setFares({});
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const entries = await Promise.all(VEHICLES.map(async vehicle => {
          const query = new URLSearchParams({ pickup: route.pickup, destination: route.destination, tier: vehicle.tier });
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
  }, [route, points]);

  function useCurrentLocation() {
    if (!navigator.geolocation) { setLocationStatus("Location is unavailable. Enter your pickup manually."); return; }
    setLocationStatus("Finding your current location…");
    navigator.geolocation.getCurrentPosition(async position => {
      try {
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        const result = await request(`/api/reverse-geocode?lat=${point.latitude}&lon=${point.longitude}`);
        setRoute(current => ({ ...current, pickup: result.address }));
        setPoints(current => ({ ...current, pickup: point }));
        setLocationStatus("Current location added");
      } catch { setLocationStatus("Enter your pickup manually."); }
    }, () => setLocationStatus("Enter your pickup manually."), { timeout: 8000, maximumAge: 300_000 });
  }
  const selectedFare = fares[tier];
  const promoDiscount = hasWelcomePromo(promoCode) && selectedFare ? Math.min(1500, selectedFare.fareCents) : 0;
  const finalFareCents = selectedFare ? selectedFare.fareCents - promoDiscount : 0;
  const canContinueRoute = route.pickup.trim().length > 2 && route.destination.trim().length > 2 && (!detectedAirport || Boolean(airport.lane && airport.flight && (airport.code === "DAL" || airport.terminal)));
  const next = () => { setError(""); setStep(current => Math.min(4, current + 1)); };
  const submit = async () => {
    if (!selectedFare) return;
    setSubmitState("sending");
    setError("");
    const effectivePickupAt = timing === "RIDE_NOW" ? new Date(Date.now() + 15 * 60_000).toISOString() : new Date(pickupAt).toISOString();
    try {
      localStorage.setItem("allan-booking-contact", JSON.stringify({ fullName: contact.fullName, phone: contact.phone, email: contact.email }));
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
          promoCode: promoCode || undefined,
          promoDiscountCents: promoDiscount || undefined,
          bookingRequestId,
          pickupLatitude: points.pickup?.latitude,
          pickupLongitude: points.pickup?.longitude,
          destinationLatitude: points.destination?.latitude,
          destinationLongitude: points.destination?.longitude,
          ...(detectedAirport ? {
            airportCode: airport.code,
            airportTerminal: airport.code === "DFW" ? airport.terminal : undefined,
            flightNumber: airport.flight,
            pickupPreference: airport.lane,
          } : {}),
        }),
      });
      if (hasWelcomePromo(promoCode)) {
        localStorage.removeItem("allan_first_ride_promo");
        setPromoCode("");
      }
      if (!hasWelcomePromo(result.inquiry?.promoCode)) localStorage.removeItem("allan_first_ride_promo");
      const trackingToken = typeof result.trackingToken === "string" ? result.trackingToken : "";
      let active: ActiveReservation | null = null;
      if (trackingToken) {
        active = {
          trackingToken,
          inquiryId: result.inquiry.id,
          reference: result.inquiry.id.slice(-6).toUpperCase(),
          pickupAt: effectivePickupAt,
          pickup: route.pickup,
          destination: route.destination,
          fareCents: result.inquiry.estimatedFareCents,
          paymentNotice: "Your booking was received. Payment confirmation is being finalized.",
          cardLast4: savedPayment && authorizeCard ? savedPayment.cardLast4 : undefined,
          flightNumber: detectedAirport ? airport.flight : undefined,
          pickupPoint: points.pickup,
          destinationPoint: points.destination,
          createdAt: new Date().toISOString(),
        };
        localStorage.setItem("allen_active_reservation", JSON.stringify(active));
      }
      let finalPaymentNotice = "Your booking was received as pay later. The Allen Limousine team will arrange payment with you.";
      if (savedPayment && authorizeCard && savedPayment.capability) {
        try {
          await request("/api/create-payment-intent", {
            method: "POST",
            body: JSON.stringify({
              bookingRequestId,
              customerId: savedPayment.customerId,
              paymentMethodId: savedPayment.paymentMethodId,
              capability: savedPayment.capability,
            }),
          });
          finalPaymentNotice = `A ${money(result.inquiry.estimatedFareCents)} authorization hold was placed on your saved card.`;
        } catch {
          finalPaymentNotice = "Your booking was received, but the card hold was not placed. The Allen Limousine team will arrange payment with you.";
        }
      }
      setPaymentNotice(finalPaymentNotice);
      if (active) {
        active = { ...active, paymentNotice: finalPaymentNotice };
        localStorage.setItem("allen_active_reservation", JSON.stringify(active));
        setActiveReservation(active);
      }
      setSubmitState("success");
    } catch (reason) {
      setSubmitState("error");
      setError(reason instanceof Error ? reason.message : "Unable to submit your booking.");
    }
  };

  if (needsOnboarding) {
    const saveProfile = () => {
      if (!contact.fullName || !contact.phone || !contact.email) return;
      localStorage.setItem("rider_name", contact.fullName);
      localStorage.setItem("rider_phone", contact.phone);
      localStorage.setItem("rider_email", contact.email);
      localStorage.setItem("allan_first_ride_promo", "WELCOME15");
      localStorage.setItem("allan-booking-contact", JSON.stringify({ fullName: contact.fullName, phone: contact.phone, email: contact.email }));
      setPromoCode("WELCOME15");
      setNeedsOnboarding(false);
      useCurrentLocation();
    };
    return <section className="pwa-onboarding"><div className="onboarding-card"><div className="onboarding-offer">$15 FIRST-RIDE CREDIT</div><p className="eyebrow brass">Welcome to Allen Limousine</p><h1>Set up once.<br /><em>Ride in one tap.</em></h1><p>Save your passenger profile and payment method for faster bookings and direct chauffeur updates.</p><div className="onboarding-fields"><label className="wizard-field">Full name<input autoFocus value={contact.fullName} onChange={event => setContact(current => ({ ...current, fullName: event.target.value }))} placeholder="Your name" /></label><label className="wizard-field">Phone number<input value={contact.phone} onChange={event => setContact(current => ({ ...current, phone: event.target.value }))} placeholder="+1 214…" /></label><label className="wizard-field">Email<input type="email" value={contact.email} onChange={event => setContact(current => ({ ...current, email: event.target.value }))} placeholder="you@example.com" /></label></div><StripeCardSetup fullName={contact.fullName} email={contact.email} savedPayment={savedPayment} onSaved={savePayment} /><button className="solid-button" disabled={!contact.fullName || !contact.phone || !contact.email} onClick={saveProfile}>{savedPayment ? "Save profile & start booking" : "Continue — pay later"} <ArrowRight /></button><small>Card details are tokenized by Stripe. Allen Limousine never stores your card number.</small></div></section>;
  }

  if (activeReservation) return <DispatchTrackingStep reservation={activeReservation} onComplete={() => {
    localStorage.removeItem("allen_active_reservation");
    setActiveReservation(null);
    setSubmitState("idle");
    setStep(1);
    setBookingRequestId(crypto.randomUUID());
    setPaymentNotice("");
  }} />;

  if (submitState === "success") return <section id="reserve" className="booking-wizard-section section-pad"><div className="wizard-success"><Check /><p className="eyebrow brass">Request received</p><h2>Your ride is<br /><em>in motion.</em></h2><p>We saved your trip and sent it to the Allen Limousine team for confirmation.</p>{paymentNotice && <p className="payment-result">{paymentNotice}</p>}<button className="solid-button" onClick={() => { setSubmitState("idle"); setStep(1); setBookingRequestId(crypto.randomUUID()); setPaymentNotice(""); }}>Book another ride</button></div></section>;

  return <section id="reserve" className="booking-wizard-section section-pad">
    <div className="wizard-shell">
      <header className="wizard-header"><div><p className="eyebrow brass">Book your chauffeur</p><h2>{["Where are you going?", "Choose your vehicle", "When should we arrive?", "Confirm your details"][step - 1]}</h2></div><span>0{step} / 04</span></header>
      <nav className="wizard-progress" aria-label="Booking progress">{[1, 2, 3, 4].map(number => <i key={number} className={number <= step ? "active" : ""} />)}</nav>
      <main className="wizard-body">
        {step === 1 && <div className="wizard-step">
          {hasWelcomePromo(promoCode) && <div className="wizard-promo"><Check /><span><b>$15 first-ride credit applied</b><small>Promo WELCOME15 will be included with your booking.</small></span></div>}
          <SmartLocation label="Pickup location" value={route.pickup} placeholder="Address, hotel, airport, or landmark" currentLocation={useCurrentLocation} onType={value => { setRoute(current => ({ ...current, pickup: value })); setPoints(current => ({ ...current, pickup: undefined })); }} onSelect={(value, point) => { setRoute(current => ({ ...current, pickup: value })); setPoints(current => ({ ...current, pickup: point })); }} />
          <small className="wizard-location-status">{locationStatus}</small>
          <SmartLocation label="Drop-off location" value={route.destination} placeholder="Where should we take you?" onType={value => { setRoute(current => ({ ...current, destination: value })); setPoints(current => ({ ...current, destination: undefined })); }} onSelect={(value, point) => { setRoute(current => ({ ...current, destination: value })); setPoints(current => ({ ...current, destination: point })); }} />
          {detectedAirport && <div className="wizard-airport"><header><Plane /><div><b>{detectedAirport === "DFW" ? "Dallas Fort Worth International" : "Dallas Love Field"}</b><span>Flight-aware airport pickup</span></div></header>{detectedAirport === "DFW" && <label>Terminal<select required value={airport.terminal} onChange={event => setAirport(current => ({ ...current, terminal: event.target.value }))}><option value="">Select terminal</option>{DFW_TERMINALS.map(item => <option key={item}>{item}</option>)}</select></label>}<label>Pickup lane<select required value={airport.lane} onChange={event => setAirport(current => ({ ...current, lane: event.target.value }))}><option value="">Select pickup preference</option>{(detectedAirport === "DFW" ? DFW_LANES : DAL_LANES).map(item => <option key={item}>{item}</option>)}</select></label><label>Flight number<input required value={airport.flight} onChange={event => setAirport(current => ({ ...current, flight: event.target.value.toUpperCase() }))} placeholder="AA 1234" /></label></div>}
          {fareState === "error" && <p className="form-error">We couldn’t calculate this route. Select an address suggestion or add a more specific address.</p>}
          <button className="solid-button wizard-next" disabled={!canContinueRoute || fareState === "loading"} onClick={next}>{fareState === "loading" ? "Calculating route…" : <>See vehicles & fares <ArrowRight /></>}</button>
        </div>}
        {step === 2 && <div className="wizard-step"><div className="wizard-route-summary"><MapPin /><span>{route.pickup}</span><ArrowRight /><span>{route.destination}</span></div><div className="wizard-vehicles">{VEHICLES.map(vehicle => { const fare = fares[vehicle.tier]; const discount = hasWelcomePromo(promoCode) && fare ? Math.min(1500, fare.fareCents) : 0; return <button type="button" key={vehicle.tier} className={tier === vehicle.tier ? "selected" : ""} onClick={() => setTier(vehicle.tier)}><CarFront /><div><b>{vehicle.label}</b><span>{vehicle.detail}</span><small>Guaranteed Upfront Fare • Tolls &amp; Fees Included • Zero Surge</small></div>{fareState === "loading" ? <i className="fare-shimmer" /> : <strong>{fare ? <>{discount > 0 && <del>{money(fare.fareCents)}</del>}{money(fare.fareCents - discount)}</> : "Unavailable"}</strong>}</button>; })}</div><div className="wizard-actions"><button className="wizard-back" onClick={() => setStep(1)}><ArrowLeft /> Back</button><button className="solid-button" disabled={!selectedFare} onClick={next}>Choose {RATE_TIER_PRICING[tier].label} <ArrowRight /></button></div></div>}
        {step === 3 && <div className="wizard-step"><div className="wizard-toggle"><button className={timing === "RIDE_NOW" ? "active" : ""} onClick={() => setTiming("RIDE_NOW")}><Clock3 />Ride Now</button><button className={timing === "RESERVE_LATER" ? "active" : ""} onClick={() => setTiming("RESERVE_LATER")}><CalendarDays />Reserve for Later</button></div>{timing === "RESERVE_LATER" && <label className="wizard-field">Pickup date &amp; time<input type="datetime-local" min={localDateTime()} value={pickupAt} onChange={event => setPickupAt(event.target.value)} /></label>}<div className="wizard-toggle"><button className={serviceType === "Point-to-Point" ? "active" : ""} onClick={() => setServiceType("Point-to-Point")}>Point-to-Point</button><button className={serviceType === "Hourly Charter" ? "active" : ""} onClick={() => setServiceType("Hourly Charter")}>Hourly Charter</button></div><div className="wizard-selection-note"><ShieldCheck /><span><b>{timing === "RIDE_NOW" ? "Pickup requested as soon as possible" : new Date(pickupAt).toLocaleString()}</b><small>{serviceType} · {RATE_TIER_PRICING[tier].label}</small></span><strong>{selectedFare && money(finalFareCents)}</strong></div><div className="wizard-actions"><button className="wizard-back" onClick={() => setStep(2)}><ArrowLeft /> Back</button><button className="solid-button" onClick={next}>Passenger details <ArrowRight /></button></div></div>}
        {step === 4 && <div className="wizard-step"><div className="wizard-contact-grid"><label className="wizard-field">Full name<input required value={contact.fullName} onChange={event => setContact(current => ({ ...current, fullName: event.target.value }))} placeholder="Your name" /></label><label className="wizard-field">Phone<input required value={contact.phone} onChange={event => setContact(current => ({ ...current, phone: event.target.value }))} placeholder="+1 214…" /></label><label className="wizard-field">Email<input required type="email" value={contact.email} onChange={event => setContact(current => ({ ...current, email: event.target.value }))} placeholder="you@example.com" /></label><label className="wizard-field">Passengers<select value={contact.passengers} onChange={event => setContact(current => ({ ...current, passengers: event.target.value }))}>{Array.from({ length: 14 }, (_, index) => index + 1).map(number => <option key={number}>{number}</option>)}</select></label></div><label className="wizard-field">Notes<textarea value={contact.notes} onChange={event => setContact(current => ({ ...current, notes: event.target.value }))} placeholder="Special requests, luggage, or itinerary notes…" /></label><div className="wizard-final-summary"><UserRound /><div><b>{RATE_TIER_PRICING[tier].label} · {serviceType}</b><span>{route.pickup} → {route.destination}</span></div><strong>{selectedFare && money(finalFareCents)}</strong></div><StripeCardSetup compact fullName={contact.fullName} email={contact.email} savedPayment={savedPayment} onSaved={savePayment} />{savedPayment?.capability && <label className="payment-choice"><input type="checkbox" checked={authorizeCard} onChange={event => setAuthorizeCard(event.target.checked)} /><span><b>Pre-authorize {money(finalFareCents)} on this card</b><small>Uncheck to submit this booking as pay later.</small></span></label>}{error && <p className="form-error">{error}</p>}<div className="wizard-actions"><button className="wizard-back" onClick={() => setStep(3)}><ArrowLeft /> Back</button><button className="solid-button" disabled={submitState === "sending" || !contact.fullName || !contact.phone || !contact.email} onClick={submit}>{submitState === "sending" ? "Submitting…" : savedPayment?.capability && authorizeCard ? <>Confirm &amp; Pre-Authorize ({money(finalFareCents)}) <Check /></> : <>Confirm booking — pay later <Check /></>}</button></div></div>}
      </main>
    </div>
  </section>;
}