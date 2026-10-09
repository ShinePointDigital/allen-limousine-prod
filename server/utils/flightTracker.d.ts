import type { FlightInfo } from "../../shared/flight.js";
export class FlightTrackerError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status?: number);
}
export function normalizeFlightNumber(value: string): string;
export function mapFlight(record: any, flightNumber: string, fetchedAt: string): FlightInfo;
export function createFlightTracker(options?: {
  client?: { get: (url: string, options: any) => Promise<any> };
  getApiKey?: () => string | undefined;
  now?: () => number;
}): (flightNumber: string, options?: { scheduledAt?: string; airportCode?: string }) => Promise<FlightInfo>;
export const trackFlight: ReturnType<typeof createFlightTracker>;
