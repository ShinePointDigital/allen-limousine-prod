import { useEffect, useMemo, useState } from "react";
import { AdvancedMarker, APIProvider, Map, Pin, useMap } from "@vis.gl/react-google-maps";
import { CalendarPlus, CarFront, Check, Clock3, MapPin, MessageSquareText, Navigation, Phone, Plane, RefreshCw, ShieldCheck, Star } from "lucide-react";

export type ActiveReservation = {
  trackingToken: string;
  inquiryId: string;
  reference: string;
  pickupAt: string;
  pickup: string;
  destination: string;
  fareCents: number;
  paymentNotice: string;
  cardLast4?: string;
  flightNumber?: string;
  pickupPoint?: { latitude: number; longitude: number };
  destinationPoint?: { latitude: number; longitude: number };
  createdAt: string;
};

type LiveStatus = {
  status: string;
  driverName: string | null;
  driverPhone: string | null;
  vehicle: string | null;
  driverLatitude: number | null;
  driverLongitude: number | null;
  driverHeading: number | null;
  locationUpdatedAt: string | null;
  updatedAt: string;
};

const NIGHT_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#0a0a0a" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8b8b83" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0a0a0a" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#212121" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#2b2b29" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#080b0d" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
] as google.maps.MapTypeStyle[];

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const terminal = (status: string) => ["COMPLETED", "CANCELLED"].includes(status);

function StaticNightMap({ pickup, destination, showDriver }: { pickup: string; destination: string; showDriver: boolean }) {
  return <div className="tracking-static-map" aria-label="Route preview">
    <div className="map-road road-a" /><div className="map-road road-b" /><div className="map-road road-c" />
    <svg viewBox="0 0 600 340" preserveAspectRatio="none" aria-hidden="true"><path d="M82 275 C150 225 168 120 268 146 S405 256 520 70" /></svg>
    {showDriver && <span className="map-marker driver-marker"><CarFront /></span>}
    <span className="map-marker pickup-marker"><MapPin /></span>
    <span className="map-marker destination-marker"><MapPin /></span>
    <div className="map-location-label pickup-label"><b>Pickup</b><span>{pickup}</span></div>
    <div className="map-location-label destination-label"><b>Destination</b><span>{destination}</span></div>
  </div>;
}

function RouteLine({ points }: { points: google.maps.LatLngLiteral[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const line = new google.maps.Polyline({ map, path: points, geodesic: true, strokeColor: "#D4AF37", strokeOpacity: .95, strokeWeight: 4 });
    return () => line.setMap(null);
  }, [map, points]);
  return null;
}

function LiveGoogleMap({ reservation, live, mapId }: { reservation: ActiveReservation; live: LiveStatus; mapId: string }) {
  const pickup = reservation.pickupPoint ? { lat: reservation.pickupPoint.latitude, lng: reservation.pickupPoint.longitude } : { lat: 32.8998, lng: -97.0403 };
  const destination = reservation.destinationPoint ? { lat: reservation.destinationPoint.latitude, lng: reservation.destinationPoint.longitude } : { lat: 32.7767, lng: -96.797 };
  const driver = live.driverLatitude != null && live.driverLongitude != null ? { lat: live.driverLatitude, lng: live.driverLongitude } : null;
  const center = { lat: (pickup.lat + destination.lat) / 2, lng: (pickup.lng + destination.lng) / 2 };
  return <Map defaultCenter={center} defaultZoom={10} disableDefaultUI gestureHandling="greedy" mapId={mapId}>
    <RouteLine points={driver ? [driver, pickup, destination] : [pickup, destination]} />
    {driver && <AdvancedMarker position={driver}><span className="google-driver-marker" style={{ transform: `rotate(${live.driverHeading || 0}deg)` }}><CarFront /></span></AdvancedMarker>}
    <AdvancedMarker position={pickup}><Pin background="#D4AF37" borderColor="#0a0a0a" glyphColor="#0a0a0a" /></AdvancedMarker>
    <AdvancedMarker position={destination}><Pin background="#f5f0e6" borderColor="#0a0a0a" glyphColor="#0a0a0a" /></AdvancedMarker>
  </Map>;
}

export default function DispatchTrackingStep({ reservation, onComplete }: { reservation: ActiveReservation; onComplete: () => void }) {
  const [live, setLive] = useState<LiveStatus>({ status: "NEW", driverName: null, driverPhone: null, vehicle: null, driverLatitude: null, driverLongitude: null, driverHeading: null, locationUpdatedAt: null, updatedAt: reservation.createdAt });
  const [refreshing, setRefreshing] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [mapFailed, setMapFailed] = useState(false);
  const mapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const mapsMapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined;
  const fetchStatus = async () => {
    setRefreshing(true);
    try {
      const response = await fetch(`/api/tracking/${reservation.trackingToken}`);
      if (response.ok) {
        const data = await response.json();
        setLive(data.reservation);
        setStatusError("");
      } else setStatusError(response.status === 404 ? "This tracking link has expired or is no longer available." : "Tracking could not be refreshed.");
    } catch { setStatusError("Tracking could not be refreshed. Check your connection and try again."); }
    finally { setRefreshing(false); }
  };
  useEffect(() => {
    fetchStatus();
    if (terminal(live.status)) return;
    const timer = window.setInterval(fetchStatus, 20_000);
    return () => window.clearInterval(timer);
  }, [reservation.trackingToken, live.status]);
  const statusCopy = useMemo(() => ({
    NEW: ["Reservation received", "Dispatch is confirming your chauffeur."],
    CONTACTED: ["Dispatch reviewing", "Your trip details are being finalized."],
    CONFIRMED: ["Ride confirmed", "Your chauffeur assignment is underway."],
    UNASSIGNED: ["Ride confirmed", "A chauffeur will be assigned shortly."],
    ASSIGNED: ["Chauffeur assigned", "Your driver is preparing for your trip."],
    EN_ROUTE: ["Chauffeur en route", "Live driver tracking is active."],
    IN_PROGRESS: ["Trip in progress", "Enjoy your Allen Limousine experience."],
    COMPLETED: ["Trip completed", "Thank you for riding with Allen Limousine."],
    CANCELLED: ["Reservation cancelled", "Contact dispatch if you need assistance."],
  }[live.status] || ["Reservation active", "Dispatch is monitoring your trip."]), [live.status]);
  const addPass = () => {
    const start = new Date(reservation.pickupAt);
    const end = new Date(start.getTime() + 60 * 60_000);
    const format = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const content = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", `UID:${reservation.inquiryId}@allenlimousine.com`, `DTSTART:${format(start)}`, `DTEND:${format(end)}`, `SUMMARY:Allen Limousine Ride ${reservation.reference}`, `LOCATION:${reservation.pickup}`, `DESCRIPTION:${reservation.pickup} to ${reservation.destination}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/calendar" }));
    link.download = `allen-limousine-${reservation.reference}.ics`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const dispatchPhone = import.meta.env.VITE_DISPATCH_PHONE as string | undefined;
  const hasDriverLocation = live.driverLatitude != null && live.driverLongitude != null;

  return <section id="reserve" className="tracking-screen">
    <header className="tracking-topbar"><div><p className="eyebrow brass">Live reservation</p><h1>Ride <span>#{reservation.reference}</span></h1></div><button onClick={fetchStatus} aria-label="Refresh tracking status"><RefreshCw className={refreshing ? "spin" : ""} /></button></header>
    <div className="tracking-confirmation"><Check /><div><b>{statusCopy[0]}</b><span>{statusCopy[1]}</span></div><i>LIVE</i></div>
    {statusError && <div className="tracking-error"><span>{statusError}</span><button onClick={fetchStatus}>Try again</button><button onClick={onComplete}>Clear saved trip</button></div>}
    <div className="tracking-map">
      {mapsKey && mapsMapId && !mapFailed ? <APIProvider apiKey={mapsKey} onError={() => setMapFailed(true)}><LiveGoogleMap reservation={reservation} live={live} mapId={mapsMapId} /></APIProvider> : <StaticNightMap pickup={reservation.pickup} destination={reservation.destination} showDriver={hasDriverLocation} />}
      <div className="tracking-eta"><Navigation /><span><small>Pickup</small><b>{new Date(reservation.pickupAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b></span></div>
    </div>
    <div className="tracking-grid">
      <article className="chauffeur-card"><div className="chauffeur-avatar"><CarFront /></div><div><small>Your chauffeur</small><h2>{live.driverName || "Assignment pending"}</h2><p>{live.driverName && <><Star /> Chauffeur assigned</>} {live.vehicle && <>· {live.vehicle}</>}</p></div><ShieldCheck /></article>
      <article className="tracking-trip-card"><div><MapPin /><span><small>Pickup</small><b>{reservation.pickup}</b></span></div><i /><div><MapPin /><span><small>Drop-off</small><b>{reservation.destination}</b></span></div></article>
      <article className="tracking-detail-card"><Clock3 /><span><small>Pickup time</small><b>{new Date(reservation.pickupAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</b></span></article>
      <article className="tracking-detail-card"><ShieldCheck /><span><small>Payment</small><b>{reservation.paymentNotice || `${money(reservation.fareCents)} fare confirmed`}</b>{reservation.cardLast4 && <em>Card ending {reservation.cardLast4}</em>}</span></article>
      {reservation.flightNumber && <article className="tracking-flight"><Plane /><span><small>Flight monitoring</small><b>Flight {reservation.flightNumber}</b></span><i>MONITORING</i></article>}
    </div>
    <nav className="tracking-actions">
      {live.driverPhone ? <a href={`tel:${live.driverPhone}`}><Phone />Call chauffeur</a> : <span className="tracking-action-disabled"><Phone />Driver pending</span>}
      {dispatchPhone ? <a href={`sms:${dispatchPhone}`}><MessageSquareText />SMS dispatch</a> : <span className="tracking-action-disabled"><MessageSquareText />Dispatch pending</span>}
      <button onClick={addPass}><CalendarPlus />Add mobile pass</button>
    </nav>
    {terminal(live.status) && <button className="solid-button tracking-new-ride" onClick={onComplete}>Book another ride</button>}
  </section>;
}