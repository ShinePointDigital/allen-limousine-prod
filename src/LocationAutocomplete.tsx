import { useEffect, useRef, useState } from "react";
import { LocateFixed, MapPin, Plane } from "lucide-react";
import { loadGoogleMaps } from "./google-maps";

export type LocationPoint = { latitude: number; longitude: number };
export type QuickLocation = {
  code: string;
  label: string;
  address: string;
  point: LocationPoint;
  kind: "airport" | "fbo";
};

type LocationSuggestion = {
  id: string;
  label: string;
  placeId?: string;
  point?: LocationPoint;
  placePrediction?: any;
};

const CHICAGO_METRO_BOUNDS = {
  north: 42.55,
  south: 41.35,
  east: -87.3,
  west: -88.65,
};

export const CHICAGO_QUICK_LOCATIONS: QuickLocation[] = [
  {
    code: "ORD",
    label: "O’Hare International",
    address: "O’Hare International Airport (ORD), 10000 W O’Hare Ave, Chicago, IL 60666",
    point: { latitude: 41.9742, longitude: -87.9073 },
    kind: "airport",
  },
  {
    code: "MDW",
    label: "Midway International",
    address: "Chicago Midway International Airport (MDW), 5700 S Cicero Ave, Chicago, IL 60638",
    point: { latitude: 41.7868, longitude: -87.7522 },
    kind: "airport",
  },
  {
    code: "PWK",
    label: "Chicago Executive / FBO",
    address: "Chicago Executive Airport (PWK), 1020 S Plant Rd, Wheeling, IL 60090",
    point: { latitude: 42.1143, longitude: -87.9015 },
    kind: "fbo",
  },
  {
    code: "DPA",
    label: "DuPage Airport / FBO",
    address: "DuPage Airport (DPA), 2700 International Dr, West Chicago, IL 60185",
    point: { latitude: 41.9078, longitude: -88.2486 },
    kind: "fbo",
  },
];

async function fallbackSuggestions(query: string, signal: AbortSignal): Promise<LocationSuggestion[]> {
  const response = await fetch(`/api/location-search?q=${encodeURIComponent(query)}`, { signal });
  if (!response.ok) throw new Error("Location search is unavailable.");
  const result = await response.json();
  return (result.locations || []).slice(0, 5).map((location: LocationPoint & { label: string }) => ({
    id: `${location.latitude}-${location.longitude}`,
    label: location.label,
    point: { latitude: location.latitude, longitude: location.longitude },
  }));
}

export default function LocationAutocomplete({
  id,
  label,
  value,
  placeholder,
  onChange,
  onSelect,
  onUseLocation,
  locationState,
  variant = "wizard",
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSelect: (value: string, point: LocationPoint, quickLocation?: QuickLocation) => void;
  onUseLocation?: () => void;
  locationState?: "idle" | "locating" | "live" | "manual" | "unavailable";
  variant?: "wizard" | "reservation";
}) {
  const [focused, setFocused] = useState(false);
  const [provider, setProvider] = useState<"loading" | "google" | "fallback">("loading");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const autocompleteService = useRef<any>(null);
  const autocompleteMode = useRef<"new" | "legacy" | null>(null);
  const placesService = useRef<any>(null);
  const placesLibrary = useRef<any>(null);
  const sessionToken = useRef<any>(null);
  const requestSequence = useRef(0);

  useEffect(() => {
    let active = true;
    void loadGoogleMaps().then(async available => {
      if (!active) return;
      const googleWindow = window as Window & { google?: any };
      if (!available || !googleWindow.google?.maps?.places) {
        setProvider("fallback");
        return;
      }
      try {
        const library = googleWindow.google.maps.importLibrary
          ? await googleWindow.google.maps.importLibrary("places")
          : googleWindow.google.maps.places;
        if (!active) return;
        placesLibrary.current = library;
        if (library?.AutocompleteSuggestion) {
          autocompleteService.current = library.AutocompleteSuggestion;
          autocompleteMode.current = "new";
        } else if (library?.AutocompleteService && library?.PlacesService) {
          autocompleteService.current = new library.AutocompleteService();
          placesService.current = new library.PlacesService(document.createElement("div"));
          autocompleteMode.current = "legacy";
        } else {
          setProvider("fallback");
          return;
        }
        setProvider("google");
      } catch {
        if (active) setProvider("fallback");
      }
    });
    return () => {
      active = false;
      autocompleteService.current = null;
      placesService.current = null;
      placesLibrary.current = null;
      autocompleteMode.current = null;
    };
  }, []);

  const beginSession = () => {
    if (sessionToken.current || provider !== "google") return;
    const googleWindow = window as Window & { google?: any };
    if (googleWindow.google?.maps?.places?.AutocompleteSessionToken) {
      sessionToken.current = new googleWindow.google.maps.places.AutocompleteSessionToken();
    }
  };

  const endSession = () => {
    sessionToken.current = null;
  };

  useEffect(() => {
    const query = value.trim();
    if (!focused || query.length < 2 || provider === "loading") {
      requestSequence.current += 1;
      setSuggestions([]);
      setSearching(false);
      return;
    }

    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearching(true);
      if (provider === "google" && autocompleteService.current && autocompleteMode.current === "new") {
        beginSession();
        try {
          const result = await autocompleteService.current.fetchAutocompleteSuggestions({
            input: query,
            includedRegionCodes: ["us"],
            locationBias: CHICAGO_METRO_BOUNDS,
            sessionToken: sessionToken.current,
          });
          if (sequence !== requestSequence.current) return;
          const nextSuggestions = (result?.suggestions || [])
            .map((suggestion: any) => suggestion.placePrediction)
            .filter(Boolean)
            .slice(0, 5)
            .map((prediction: any) => ({
              id: prediction.placeId,
              placeId: prediction.placeId,
              label: prediction.text?.toString?.() || prediction.text?.text || prediction.placeId,
              placePrediction: prediction,
            }));
          setSuggestions(nextSuggestions);
        } catch {
          if (sequence === requestSequence.current) setSuggestions([]);
        } finally {
          if (sequence === requestSequence.current) setSearching(false);
        }
        return;
      }
      if (provider === "google" && autocompleteService.current && autocompleteMode.current === "legacy") {
        beginSession();
        autocompleteService.current.getPlacePredictions({
          input: query,
          componentRestrictions: { country: "us" },
          locationBias: CHICAGO_METRO_BOUNDS,
          sessionToken: sessionToken.current,
        }, (predictions: any[] | null, status: string) => {
          if (sequence !== requestSequence.current) return;
          const googleWindow = window as Window & { google?: any };
          const ok = status === "OK" || status === googleWindow.google?.maps?.places?.PlacesServiceStatus?.OK;
          setSuggestions(ok ? (predictions || []).slice(0, 5).map(prediction => ({
            id: prediction.place_id,
            placeId: prediction.place_id,
            label: prediction.description,
          })) : []);
          setSearching(false);
        });
        return;
      }

      try {
        const locations = await fallbackSuggestions(query, controller.signal);
        if (sequence === requestSequence.current) setSuggestions(locations);
      } catch {
        if (!controller.signal.aborted && sequence === requestSequence.current) setSuggestions([]);
      } finally {
        if (!controller.signal.aborted && sequence === requestSequence.current) setSearching(false);
      }
    }, provider === "google" ? 180 : 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [focused, provider, value]);

  const chooseSuggestion = (suggestion: LocationSuggestion) => {
    requestSequence.current += 1;
    setSuggestions([]);
    setFocused(false);
    if (suggestion.point) {
      onSelect(suggestion.label, suggestion.point);
      endSession();
      return;
    }
    if (suggestion.placePrediction && autocompleteMode.current === "new") {
      const place = suggestion.placePrediction.toPlace?.();
      if (!place) {
        onChange(suggestion.label);
        endSession();
        return;
      }
      void place.fetchFields({ fields: ["formattedAddress", "location", "displayName"] }).then(() => {
        const location = place.location;
        const latitude = typeof location?.lat === "function" ? location.lat() : location?.lat;
        const longitude = typeof location?.lng === "function" ? location.lng() : location?.lng;
        const selectedValue = place.formattedAddress || place.displayName || suggestion.label;
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          onSelect(selectedValue, { latitude, longitude });
        } else {
          onChange(suggestion.label);
        }
        endSession();
      }).catch(() => {
        onChange(suggestion.label);
        endSession();
      });
      return;
    }
    if (!suggestion.placeId || !placesService.current) {
      onChange(suggestion.label);
      endSession();
      return;
    }

    placesService.current.getDetails({
      placeId: suggestion.placeId,
      fields: ["formatted_address", "geometry", "name"],
      sessionToken: sessionToken.current,
    }, (place: any, status: string) => {
      const googleWindow = window as Window & { google?: any };
      const ok = status === "OK" || status === googleWindow.google?.maps?.places?.PlacesServiceStatus?.OK;
      const latitude = place?.geometry?.location?.lat();
      const longitude = place?.geometry?.location?.lng();
      const selectedValue = place?.formatted_address || place?.name || suggestion.label;
      if (ok && Number.isFinite(latitude) && Number.isFinite(longitude)) {
        onSelect(selectedValue, { latitude, longitude });
      } else {
        onChange(suggestion.label);
      }
      endSession();
    });
  };

  const chooseQuickLocation = (location: QuickLocation) => {
    requestSequence.current += 1;
    setSuggestions([]);
    setFocused(false);
    endSession();
    onSelect(location.address, location.point, location);
  };

  const quickPicks = <label className="location-quick-select">
    <span>Airport or FBO</span>
    <div>
      <Plane aria-hidden="true" />
      <select
        value=""
        aria-label={`Select ${label.toLowerCase()} airport or FBO`}
        onChange={event => {
          const location = CHICAGO_QUICK_LOCATIONS.find(item => item.code === event.target.value);
          if (location) chooseQuickLocation(location);
        }}
      >
        <option value="">Select airport or FBO</option>
        {CHICAGO_QUICK_LOCATIONS.map(location => <option key={location.code} value={location.code}>
          {location.code} — {location.label}
        </option>)}
      </select>
    </div>
  </label>;

  const suggestionList = focused && (searching || suggestions.length > 0)
    ? variant === "wizard"
      ? <section role="listbox" aria-label={`${label} suggestions`}>
          {searching && <span className="location-searching">Finding nearby locations…</span>}
          {!searching && suggestions.map(suggestion => <button type="button" role="option" key={suggestion.id} onMouseDown={event => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)}><MapPin /><span>{suggestion.label}</span></button>)}
        </section>
      : <div className="location-suggestions" role="listbox" aria-label={`${label} suggestions`}>
          {searching && <span>Finding nearby locations…</span>}
          {!searching && suggestions.map(suggestion => <button type="button" role="option" key={suggestion.id} onMouseDown={event => event.preventDefault()} onClick={() => chooseSuggestion(suggestion)}><MapPin /><span>{suggestion.label}</span></button>)}
        </div>
    : null;

  const input = <input
    id={id}
    required
    value={value}
    placeholder={placeholder}
    autoComplete="off"
    onFocus={() => { setFocused(true); beginSession(); }}
    onBlur={() => window.setTimeout(() => setFocused(false), 120)}
    onChange={event => onChange(event.target.value)}
  />;

  if (variant === "reservation") {
    return <div className="location-field location-autocomplete">
      <label htmlFor={id}>{label}</label>
      <div className="location-input-wrap">
        <MapPin aria-hidden="true" />
        {input}
        {onUseLocation && <button type="button" className="use-location-button" onClick={onUseLocation} disabled={locationState === "locating"} aria-label="Use my current location" title="Use my current location"><LocateFixed /></button>}
      </div>
      {locationState && <small className={`location-status location-${locationState}`}>{locationState === "locating" ? "Finding your current location…" : locationState === "live" ? "Current location added" : locationState === "unavailable" ? "Location unavailable—enter your pickup manually" : locationState === "manual" ? "Manual pickup location" : ""}</small>}
      {quickPicks}
      {suggestionList}
    </div>;
  }

  return <div className="wizard-location location-autocomplete">
    <label htmlFor={id}>{label}</label>
    <div>
      <MapPin aria-hidden="true" />
      {input}
      {onUseLocation && <button type="button" onClick={onUseLocation} aria-label="Use current location"><LocateFixed /></button>}
    </div>
    {quickPicks}
    {suggestionList}
  </div>;
}