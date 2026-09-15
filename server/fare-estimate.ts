import { calculateFare, type RateTier } from "../shared/pricing.js";
import { detectEventVenue } from "../shared/venues.js";

type Coordinates = { latitude: number; longitude: number; label: string };
export type FareCoordinates = {
  pickup?: { latitude: number; longitude: number };
  destination?: { latitude: number; longitude: number };
};
type Estimate = ReturnType<typeof calculateFare> & {
  pickupLabel: string;
  destinationLabel: string;
  eventVenue: { slug: string; name: string; surchargeCents: number } | null;
  eventSurchargeCents: number;
  hourlyCharterSuggested: boolean;
};
type LocationSuggestion = { label: string; latitude: number; longitude: number };
type GoogleGeocodeResponse = {
  status: string;
  results?: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
};
type GoogleDistanceMatrixResponse = {
  status: string;
  rows?: Array<{
    elements?: Array<{
      status: string;
      distance?: { value: number };
      duration?: { value: number };
    }>;
  }>;
};

const geocodeCache = new Map<string, { expiresAt: number; result: Coordinates | null }>();
const estimateCache = new Map<string, { expiresAt: number; result: Estimate }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const locationQuery = (address: string) => {
  const normalized = address.toLowerCase();
  const texas = /\b(dfw|dal)\b|dallas|fort worth|love field/.test(normalized);
  return `${address}, ${texas ? "Texas" : "Chicago, IL"}`;
};

function googleMapsServerKey() {
  const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
  if (!key) throw new Error("Google Maps server configuration is unavailable.");
  return key;
}

async function googleMapsRequest<T>(path: string, parameters: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ ...parameters, key: googleMapsServerKey() });
  const response = await fetch(`https://maps.googleapis.com/maps/api/${path}?${query}`, {
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("Google Maps is temporarily unavailable.");
  return response.json() as Promise<T>;
}

async function geocode(address: string): Promise<Coordinates | null> {
  const query = locationQuery(address);
  const cacheKey = query.toLowerCase().trim();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const data = await googleMapsRequest<GoogleGeocodeResponse>("geocode/json", {
    address: query,
    components: "country:US",
  });
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") throw new Error("Address lookup is temporarily unavailable.");
  const first = data.results?.[0];
  const result = first ? {
    latitude: first.geometry.location.lat,
    longitude: first.geometry.location.lng,
    label: first.formatted_address,
  } : null;
  geocodeCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  const data = await googleMapsRequest<GoogleGeocodeResponse>("geocode/json", {
    latlng: `${latitude},${longitude}`,
    result_type: "street_address|premise|route",
  });
  if (data.status !== "OK" || !data.results?.[0]?.formatted_address) throw new Error("We couldn’t identify your current location.");
  return data.results[0].formatted_address;
}

export async function searchLocations(query: string): Promise<LocationSuggestion[]> {
  const data = await googleMapsRequest<GoogleGeocodeResponse>("geocode/json", {
    address: locationQuery(query),
    components: "country:US",
  });
  if (data.status !== "OK" && data.status !== "ZERO_RESULTS") throw new Error("Location suggestions are temporarily unavailable.");
  return (data.results || []).slice(0, 5).map(result => ({
    label: result.formatted_address,
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
  }));
}

export async function estimateFare(pickup: string, destination: string, tier: RateTier, coordinates: FareCoordinates = {}): Promise<Estimate> {
  const coordinateKey = [
    coordinates.pickup ? `${coordinates.pickup.latitude},${coordinates.pickup.longitude}` : "",
    coordinates.destination ? `${coordinates.destination.latitude},${coordinates.destination.longitude}` : "",
  ].join(":");
  const cacheKey = `${tier}:${pickup.trim().toLowerCase()}:${destination.trim().toLowerCase()}:${coordinateKey}`;
  const cached = estimateCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const [origin, target] = await Promise.all([
    coordinates.pickup
      ? Promise.resolve({ ...coordinates.pickup, label: pickup })
      : geocode(pickup),
    coordinates.destination
      ? Promise.resolve({ ...coordinates.destination, label: destination })
      : geocode(destination),
  ]);
  if (!origin || !target) throw new Error("We couldn’t locate one of those Chicago addresses. Try adding a street address, hotel, or airport name.");

  const matrix = await googleMapsRequest<GoogleDistanceMatrixResponse>("distancematrix/json", {
    origins: `${origin.latitude},${origin.longitude}`,
    destinations: `${target.latitude},${target.longitude}`,
    mode: "driving",
    units: "imperial",
  });
  if (matrix.status !== "OK") throw new Error("Driving distance is temporarily unavailable. Please try again.");
  const route = matrix.rows?.[0]?.elements?.[0];
  if (route?.status !== "OK" || !route.distance || !route.duration) throw new Error("We couldn’t calculate a driving route between those points.");

  const miles = route.distance.value / 1609.344;
  const minutes = route.duration.value / 60;
  const eventVenue = detectEventVenue(target.label) || detectEventVenue(destination);
  const eventSurchargeCents = eventVenue?.surchargeCents || 0;
  const baseFare = calculateFare(tier, miles, minutes);
  const result = {
    ...baseFare,
    fareCents: baseFare.fareCents + eventSurchargeCents,
    pickupLabel: origin.label,
    destinationLabel: target.label,
    eventVenue: eventVenue ? { slug: eventVenue.slug, name: eventVenue.name, surchargeCents: eventVenue.surchargeCents } : null,
    eventSurchargeCents,
    hourlyCharterSuggested: Boolean(eventVenue),
  };
  estimateCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}