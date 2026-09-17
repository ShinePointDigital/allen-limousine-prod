import type { SavedPayment } from "./StripeCardSetup.js";

export type PwaTrip = {
  trackingToken: string;
  reference: string;
  pickupAt: string;
  pickup: string;
  destination: string;
  fareCents: number;
  status: string;
  createdAt: string;
};

const TRIPS_KEY = "allan-pwa-trips";
const WALLET_KEY = "allan-wallet-cards";
const PAYMENT_KEY = "allen-saved-payment";

const emit = (name: string) => {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name));
};

export function readSavedPayment(): SavedPayment | null {
  try {
    const value = localStorage.getItem(PAYMENT_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

export function readWalletPayments(): SavedPayment[] {
  try {
    const value = localStorage.getItem(WALLET_KEY);
    const stored = value ? JSON.parse(value) : [];
    if (Array.isArray(stored)) return stored;
  } catch {
    // Continue with the legacy single-card record below.
  }
  const current = readSavedPayment();
  return current ? [current] : [];
}

export function saveSavedPayment(payment: SavedPayment) {
  localStorage.setItem(PAYMENT_KEY, JSON.stringify(payment));
  localStorage.setItem("stripe_customer_id", payment.customerId);
  localStorage.setItem("default_payment_method_id", payment.paymentMethodId);
  localStorage.setItem("card_brand", payment.cardBrand);
  localStorage.setItem("card_last4", payment.cardLast4);
  const payments = readWalletPayments().filter(item => item.paymentMethodId !== payment.paymentMethodId);
  localStorage.setItem(WALLET_KEY, JSON.stringify([payment, ...payments]));
  emit("allan-wallet-changed");
}

export function removeWalletPayment(paymentMethodId: string) {
  const payments = readWalletPayments().filter(item => item.paymentMethodId !== paymentMethodId);
  localStorage.setItem(WALLET_KEY, JSON.stringify(payments));
  const current = readSavedPayment();
  if (current?.paymentMethodId === paymentMethodId) {
    const next = payments[0] || null;
    if (next) saveSavedPayment(next);
    else {
      localStorage.removeItem(PAYMENT_KEY);
      localStorage.removeItem("stripe_customer_id");
      localStorage.removeItem("default_payment_method_id");
      localStorage.removeItem("card_brand");
      localStorage.removeItem("card_last4");
      emit("allan-wallet-changed");
    }
  } else {
    emit("allan-wallet-changed");
  }
}

export function readPwaTrips(): PwaTrip[] {
  try {
    const value = localStorage.getItem(TRIPS_KEY);
    const stored = value ? JSON.parse(value) : [];
    return Array.isArray(stored) ? stored.filter(item => item && typeof item.trackingToken === "string") : [];
  } catch {
    return [];
  }
}

export function replacePwaTrips(trips: PwaTrip[]) {
  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips.slice(0, 25)));
  emit("allan-trips-changed");
}

export function rememberPwaTrip(trip: PwaTrip) {
  replacePwaTrips([trip, ...readPwaTrips().filter(item => item.trackingToken !== trip.trackingToken)]);
}

export function forgetPwaTrip(trackingToken: string) {
  replacePwaTrips(readPwaTrips().filter(item => item.trackingToken !== trackingToken));
}