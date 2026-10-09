import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link2, Plus, UserRound, X } from "lucide-react";
import type { DispatchWizardSnapshot } from "../../shared/dispatch-wizard";
import { validPassengerCapacity } from "../../shared/chauffeur-pairing";
import "./ChauffeurVehicleSetup.css";

type Driver = DispatchWizardSnapshot["drivers"][number];
type Vehicle = DispatchWizardSnapshot["vehicles"][number];
type VehicleDetails = {
  name: string;
  category: string;
  description: string;
  imageUrl: string;
  passengers: string;
  luggage: string;
};

type Props = {
  drivers: Driver[];
  vehicles: Vehicle[];
  readOnly: boolean;
  refreshSnapshot: () => Promise<DispatchWizardSnapshot | null>;
  onCreated: (driverId: string) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
};

const emptyVehicle: VehicleDetails = {
  name: "",
  category: "",
  description: "",
  imageUrl: "",
  passengers: "",
  luggage: "",
};

function VehicleFields({
  value, onChange,
}: {
  value: VehicleDetails;
  onChange: (value: VehicleDetails) => void;
}) {
  const update = (field: keyof VehicleDetails, next: string) => onChange({ ...value, [field]: next });
  return <div className="cvs-vehicle-fields">
    <label className="dw-field">Vehicle name
      <input value={value.name} onChange={event => update("name", event.target.value)} minLength={2} maxLength={100} required />
    </label>
    <label className="dw-field">Category
      <input value={value.category} onChange={event => update("category", event.target.value)} minLength={2} maxLength={100} placeholder="Executive sedan" required />
    </label>
    <label className="dw-field cvs-span-two">Description
      <textarea value={value.description} onChange={event => update("description", event.target.value)} minLength={2} maxLength={500} rows={3} required />
    </label>
    <label className="dw-field cvs-span-two">Vehicle image URL
      <input type="url" value={value.imageUrl} onChange={event => update("imageUrl", event.target.value)} maxLength={2000} placeholder="https://…" required />
    </label>
    <label className="dw-field">Passenger capacity
      <input value={value.passengers} onChange={event => update("passengers", event.target.value)} maxLength={30} placeholder="3 or 1–6" required />
      <span className="cvs-hint">Enter a positive number or range.</span>
    </label>
    <label className="dw-field">Luggage capacity
      <input value={value.luggage} onChange={event => update("luggage", event.target.value)} maxLength={30} placeholder="2 large suitcases" required />
    </label>
  </div>;
}

export default function ChauffeurVehicleSetup({ drivers, vehicles, readOnly, refreshSnapshot, onCreated, onBusyChange }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "pair">("create");
  const [newVehicle, setNewVehicle] = useState(false);
  const [driver, setDriver] = useState({ name: "", phone: "" });
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [vehicle, setVehicle] = useState<VehicleDetails>(emptyVehicle);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const availableVehicles = vehicles.filter(item =>
    item.available && item.pairable && !item.pairedToDriverId);
  const pairableDrivers = drivers.filter(item => !item.fleetVehicleId && item.pairable);

  const reset = () => {
    setOpen(false);
    setError("");
    setDriver({ name: "", phone: "" });
    setDriverId("");
    setVehicleId("");
    setVehicle(emptyVehicle);
    setNewVehicle(false);
    setMode("create");
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busyRef.current || readOnly) return;
    if (!newVehicle && !availableVehicles.some(item => item.id === vehicleId)) {
      setError("Choose an available, unpaired vehicle or enter details for a new vehicle.");
      return;
    }
    if (newVehicle && !validPassengerCapacity(vehicle.passengers)) {
      setError("Passenger capacity must be a positive number or a valid range, such as 3 or 1–6.");
      return;
    }
    if (mode === "pair" && !pairableDrivers.some(item => item.id === driverId)) {
      setError("Choose an unlinked chauffeur who is available for pairing.");
      return;
    }

    const payload: Record<string, unknown> = newVehicle ? { newVehicle: vehicle } : { vehicleId };
    let url = "/api/admin/chauffeurs";
    if (mode === "create") {
      const name = driver.name.trim();
      const phone = driver.phone.trim();
      if (!name || !phone) {
        setError("Enter the chauffeur’s name and phone number.");
        return;
      }
      payload.name = name;
      payload.phone = phone;
    } else {
      url = `/api/admin/chauffeurs/${encodeURIComponent(driverId)}/vehicle`;
    }

    busyRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({})) as {
        error?: string;
        chauffeur?: { id?: string };
      };
      if (!response.ok) throw new Error(data.error || "The chauffeur and vehicle pairing could not be saved.");
      const createdId = mode === "create" ? data.chauffeur?.id : driverId;
      if (!createdId) throw new Error("The server accepted the setup but did not return a chauffeur record. Refresh the roster before retrying.");
      await onCreated(createdId);
      reset();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The setup could not be saved.";
      const refreshed = await refreshSnapshot();
      setError(`${message} ${refreshed ? "The roster was refreshed; check for a saved chauffeur or vehicle before trying again." : "The roster could not be refreshed; refresh the dispatch before retrying."}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  };

  return <section className="cvs-root" aria-label="Chauffeur and vehicle setup">
    <div className="cvs-intro">
      <div>
        <span className="dw-overline">Roster setup</span>
        <strong>Keep each chauffeur paired to one fleet vehicle.</strong>
        <p>Add a complete pairing or link a chauffeur who still needs a vehicle.</p>
      </div>
      {!open && <button type="button" className="dw-button dw-button-secondary cvs-open" onClick={() => { setOpen(true); setError(""); }} disabled={readOnly}>
        <Plus aria-hidden="true" /> Add or pair
      </button>}
      {open && <button type="button" className="dw-icon-button" aria-label="Close chauffeur setup" onClick={reset} disabled={busy}><X aria-hidden="true" /></button>}
    </div>

    {pairableDrivers.length === 0 && <p className="cvs-roster-note"><UserRound aria-hidden="true" /> No unlinked chauffeurs are currently available to pair.</p>}
    {availableVehicles.length === 0 && <p className="cvs-roster-note"><Link2 aria-hidden="true" /> No unpaired available vehicles. You can add a vehicle during setup.</p>}

    {open && <form className="cvs-form" onSubmit={submit}>
      <fieldset className="cvs-controls" disabled={readOnly || busy}>
        <legend className="cvs-sr-only">Chauffeur and vehicle pairing details</legend>
      <div className="cvs-mode-tabs" role="group" aria-label="Roster setup action">
        <button type="button" className={mode === "create" ? "is-selected" : ""} aria-pressed={mode === "create"} onClick={() => { setMode("create"); setError(""); }}>New chauffeur</button>
        <button type="button" className={mode === "pair" ? "is-selected" : ""} aria-pressed={mode === "pair"} onClick={() => { setMode("pair"); setError(""); }}>Pair existing</button>
      </div>
      {mode === "create" ? <div className="cvs-driver-fields">
        <label className="dw-field">Chauffeur name
          <input value={driver.name} onChange={event => setDriver(current => ({ ...current, name: event.target.value }))} minLength={2} maxLength={100} autoComplete="name" required />
        </label>
        <label className="dw-field">Phone number
          <input type="tel" value={driver.phone} onChange={event => setDriver(current => ({ ...current, phone: event.target.value }))} minLength={7} maxLength={30} autoComplete="tel" required />
        </label>
      </div> : <label className="dw-field">Unlinked chauffeur
        <select value={driverId} onChange={event => setDriverId(event.target.value)} required>
          <option value="">Choose an unlinked chauffeur</option>
          {pairableDrivers.map(item => <option key={item.id} value={item.id}>{item.name} · {item.phone}</option>)}
        </select>
      </label>}

      <fieldset className="cvs-vehicle-choice">
        <legend>Vehicle pairing</legend>
        <label className="cvs-radio-choice">
          <input type="radio" name="cvs-vehicle-choice" checked={!newVehicle} onChange={() => { setNewVehicle(false); setError(""); }} />
          <span><b>Use an existing vehicle</b><small>Only available, unpaired vehicles are shown.</small></span>
        </label>
        {!newVehicle && <label className="dw-field">Available vehicle
          <select value={vehicleId} onChange={event => setVehicleId(event.target.value)} required>
            <option value="">Choose an unpaired vehicle</option>
            {availableVehicles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}
          </select>
        </label>}
        <label className="cvs-radio-choice">
          <input type="radio" name="cvs-vehicle-choice" checked={newVehicle} onChange={() => { setNewVehicle(true); setError(""); }} />
          <span><b>Create a new vehicle</b><small>Vehicle details are saved with this chauffeur pairing.</small></span>
        </label>
        {newVehicle && <VehicleFields value={vehicle} onChange={setVehicle} />}
      </fieldset>
      </fieldset>
      {error && <p className="cvs-error" role="alert">{error}</p>}
      <div className="cvs-actions">
        <button type="button" className="dw-text-button" onClick={reset} disabled={busy}>Cancel</button>
        <button type="submit" className="dw-button dw-button-primary" disabled={busy || readOnly}>
          {busy ? "Saving pairing…" : mode === "create" ? "Add chauffeur & vehicle" : "Save vehicle pairing"}
        </button>
      </div>
    </form>}
    {readOnly && <p className="cvs-locked-note">Roster changes are disabled after notifications are reserved or attempted, and after dispatch is complete.</p>}
  </section>;
}
