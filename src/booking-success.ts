import type { ActiveReservation } from "./DispatchTrackingStep.js";

export type BookingSuccessInput = {
  trackingToken: string;
  inquiryId: string;
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

export type BookingSuccessTransition =
  | { view: "tracking"; reservation: ActiveReservation }
  | { view: "request-received" };

export function isPwaLaunch(search: string, displayModeStandalone: boolean, iosStandalone: boolean) {
  return new URLSearchParams(search).get("source") === "pwa" || displayModeStandalone || iosStandalone;
}

export function bookingSuccessTransition(isPwa: boolean, input: BookingSuccessInput): BookingSuccessTransition {
  if (!isPwa) return { view: "request-received" };

  return {
    view: "tracking",
    reservation: {
      trackingToken: input.trackingToken,
      inquiryId: input.inquiryId,
      reference: input.inquiryId.slice(-6).toUpperCase(),
      pickupAt: input.pickupAt,
      pickup: input.pickup,
      destination: input.destination,
      fareCents: input.fareCents,
      paymentNotice: input.paymentNotice,
      cardLast4: input.cardLast4,
      flightNumber: input.flightNumber,
      pickupPoint: input.pickupPoint,
      destinationPoint: input.destinationPoint,
      createdAt: input.createdAt,
    },
  };
}