export type FlightInfo = {
  /** Set only after a staff lookup matched this exact booking context. */
  verifiedBookingContext?: VerifiedBookingFlightContext;
  source: "AviationStack";
  flightNumber: string;
  flightDate: string | null;
  airlineName: string | null;
  flightStatus: string | null;
  departureAirport: string | null;
  departureAirportCode: string | null;
  departureTimezone: string | null;
  arrivalAirport: string | null;
  arrivalAirportCode: string | null;
  arrivalTimezone: string | null;
  scheduledDepartureTime: string | null;
  estimatedDepartureTime: string | null;
  actualDepartureTime: string | null;
  scheduledArrivalTime: string | null;
  estimatedArrivalTime: string | null;
  actualArrivalTime: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  departureTerminal: string | null;
  arrivalTerminal: string | null;
  departureGate: string | null;
  arrivalGate: string | null;
  baggageBelt: string | null;
  departureDelayMinutes: number | null;
  arrivalDelayMinutes: number | null;
  fetchedAt: string;
};

export type VerifiedBookingFlightContext = {
  flightNumber: string;
  scheduledAt: string;
  airportCode: string;
  flightDate: string | null;
  departureAirportCode: string | null;
  arrivalAirportCode: string | null;
  scheduledDepartureTime: string | null;
  scheduledArrivalTime: string | null;
};

export const DRIVER_FLIGHT_FRESH_MS = 5 * 60_000;
export type DriverFlightUpdate = {
  state: "current" | "stale" | "unavailable";
  fetchedAt: string | null;
  validUntil: string | null;
  source: "AviationStack" | null;
  airportRole: "arrival" | "departure" | null;
  status: string | null;
  scheduledTime: string | null;
  estimatedTime: string | null;
  actualTime: string | null;
  terminal: string | null;
  gate: string | null;
  baggageBelt: string | null;
};

export type BookingFlightMetadata = {
  flightNumber?: string | null;
  flightScheduledAt?: string | null;
  airportCode?: string | null;
  airlineName?: string | null;
  flightStatus?: string | null;
  arrivalTime?: string | null;
  departureTime?: string | null;
  arrivalTerminal?: string | null;
  departureTerminal?: string | null;
  baggageBelt?: string | null;
  flightUpdatedAt?: string | null;
  flightDetails?: FlightInfo | null;
};
