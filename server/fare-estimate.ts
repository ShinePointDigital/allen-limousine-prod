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

const geocodeCache = new Map<string, { expiresAt: number; result: Coordinates | null }>();
const estimateCache = new Map<string, { expiresAt: number; result: Estimate }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const locationQuery = (address: string) => {
  const normalized = address.toLowerCase();
  const texas = /\b(dfw|dal)\b|dallas|fort worth|love field/.test(normalized);
  return `${address}, ${texas ? "Texas" : "Chicago, IL"}`;
};

async function geocode(address: string): Promise<Coordinates | null> {
  const query = locationQuery(address);
  const cacheKey = query.toLowerCase().trim();
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "ALLAN-Livery/1.0" },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("Address lookup is temporarily unavailable.");
  const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
  const first = results[0];
  const result = first ? { latitude: Number(first.lat), longitude: Number(first.lon), label: first.display_name } : null;
  geocodeCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result });
  return result;
}

export async function reverseGeocode(latitude: number, longitude: number): Promise<string> {
  const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`, {
    headers: { "User-Agent": "ALLAN-Livery/1.0" },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("Live location lookup is temporarily unavailable.");
  const result = await response.json() as { display_name?: string };
  if (!result.display_name) throw new Error("We couldn’t identify your current location.");
  return result.display_name;
}

export async function searchLocations(query: string): Promise<LocationSuggestion[]> {
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=us&q=${encodeURIComponent(locationQuery(query))}`, {
    headers: { "User-Agent": "ALLAN-Livery/1.0" },
    signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error("Location suggestions are temporarily unavailable.");
  const results = await response.json() as Array<{ lat: string; lon: string; display_name: string }>;
  return results.map(result => ({ label: result.display_name, latitude: Number(result.lat), longitude: Number(result.lon) }));
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

  const routeResponse = await fetch(`https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${target.longitude},${target.latitude}?overview=false`, {
    headers: { "User-Agent": "ALLAN-Livery/1.0" },
    signal: AbortSignal.timeout(7000),
  });
  if (!routeResponse.ok) throw new Error("Driving distance is temporarily unavailable. Please try again.");
  const route = await routeResponse.json() as { code: string; routes?: Array<{ distance: number; duration: number }> };
  const firstRoute = route.routes?.[0];
  if (route.code !== "Ok" || !firstRoute) throw new Error("We couldn’t calculate a driving route between those points.");

  const miles = firstRoute.distance / 1609.344;
  const minutes = firstRoute.duration / 60;
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