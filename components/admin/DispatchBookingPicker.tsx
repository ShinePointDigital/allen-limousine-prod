import { useEffect, useState } from "react";
import { ArrowRight, X } from "lucide-react";

type ListedRide = { id: string; inquiryId: string; inquiry: { fullName: string; pickupAt: string; pickup: string; destination: string } };
export default function DispatchBookingPicker({ vehicle, onClose, onSelect }: {
  vehicle: { name: string }; onClose: () => void; onSelect: (bookingId: string) => void;
}) {
  const [rides, setRides] = useState<ListedRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/rides?unassigned=true", { credentials: "same-origin", signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load bookings."); return data; })
      .then(data => { setRides(data.rides); setLoading(false); })
      .catch(reason => { if (!controller.signal.aborted) { setError(reason.message); setLoading(false); } });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);
  return <div className="available-rides-backdrop" onClick={onClose}>
    <section className="available-rides-modal" role="dialog" aria-modal="true" aria-labelledby="dispatch-picker-title" onClick={event => event.stopPropagation()}>
      <header className="available-rides-top"><div><p className="eyebrow brass">Dispatch / available bookings</p><h2 id="dispatch-picker-title">{vehicle.name}</h2></div><button type="button" onClick={onClose} aria-label="Close booking picker"><X /></button></header>
      <p className="available-rides-caption">Choose a booking to review, assign a chauffeur and vehicle, and confirm dispatch. Selecting a booking does not send SMS.</p>
      {loading ? <p role="status">Loading bookings…</p> : error ? <p role="alert" className="form-error">{error}</p> :
        <div className="available-rides-list">{rides.map(ride => <button type="button" className="available-ride-row" key={ride.id} onClick={() => onSelect(ride.inquiryId)}><div><b>{ride.inquiry.fullName}</b><small>{new Date(ride.inquiry.pickupAt).toLocaleString("en-US", { timeZone: "America/Chicago", timeZoneName: "short" })}</small><span>{ride.inquiry.pickup} → {ride.inquiry.destination}</span></div><ArrowRight /></button>)}{!rides.length && <p>No unassigned bookings are available.</p>}</div>}
    </section>
  </div>;
}
