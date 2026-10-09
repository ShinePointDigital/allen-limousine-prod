import { storedAuthorizationAmount } from "../shared/gratuity.js";

type Intent = { id: string; status: string; amount: number; currency: string };
export class AuthorizationRejectedError extends Error {
  readonly authorizationOutcome = "rejected";
}

/** Only a definitive provider rejection permits a new booking request. */
function definitiveCardRejection(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const failure = error as { type?: string; code?: string; payment_intent?: { status?: string }; raw?: { payment_intent?: { status?: string } } };
  if (failure.type !== "StripeCardError") return false;
  const intent = failure.payment_intent ?? failure.raw?.payment_intent;
  if (intent) return intent.status === "requires_payment_method" || intent.status === "canceled";
  return ["card_declined", "expired_card", "incorrect_cvc", "incorrect_number", "invalid_cvc", "invalid_number", "invalid_expiry_month", "invalid_expiry_year"].includes(failure.code || "");
}
export type AuthorizationStripe = {
  paymentIntents: {
    retrieve(id: string): Promise<Intent>;
    create(data: { amount: number; currency: string; customer: string; payment_method: string; capture_method: "manual"; confirm: true; off_session: true; description: string; metadata: Record<string, string> }, options: { idempotencyKey: string }): Promise<Intent>;
  };
  paymentMethods: { retrieve(id: string): Promise<{ customer: string | { id: string } | null }> };
};
export type AuthorizationBooking = {
  id: string; bookingRequestId?: string | null; estimatedFareCents?: number | null;
  gratuityCents?: number | null; authorizedTotalCents?: number | null; stripePaymentIntentId?: string | null;
  status?: string;
};

/** Amount and activation guards shared by new authorizations and request retries. */
export async function authorizeBooking(
  booking: AuthorizationBooking,
  card: { customerId: string; paymentMethodId: string; expectedAuthorizedTotalCents?: number },
  stripe: AuthorizationStripe,
  effects: {
    savePayment(intent: Intent): Promise<unknown>;
    syncStatus(intent: Intent): Promise<unknown>;
    activate(intent: Intent): Promise<unknown>;
  },
) {
  if (booking.status === "CANCELLED") throw new Error("This booking was cancelled. Review and authorize a new booking instead.");
  const amount = storedAuthorizationAmount(booking);
  if (card.expectedAuthorizedTotalCents !== undefined && card.expectedAuthorizedTotalCents !== amount) {
    throw new Error("The authorization total changed. Review the booking before authorizing your card.");
  }
  const validateIntent = (intent: Intent) => {
    if (intent.amount !== amount || intent.currency !== "usd") throw new Error("The Stripe authorization does not match the approved fare and gratuity.");
  };
  if (booking.stripePaymentIntentId) {
    const existing = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
    validateIntent(existing);
    await effects.syncStatus(existing);
    // A released hold is definitive, not permission to place another hold.
    if (existing.status === "canceled") return existing;
    if (!["canceled", "requires_payment_method"].includes(existing.status)) {
      if (existing.status === "requires_capture") await effects.activate(existing);
      return existing;
    }
  }
  const method = await stripe.paymentMethods.retrieve(card.paymentMethodId);
  const owner = typeof method.customer === "string" ? method.customer : method.customer?.id;
  if (owner !== card.customerId) throw new Error("That card does not belong to this passenger profile.");
  let intent: Intent;
  try {
    intent = await stripe.paymentIntents.create({
    amount, currency: "usd", customer: card.customerId, payment_method: card.paymentMethodId,
    capture_method: "manual", confirm: true, off_session: true,
    description: `Allan Limousine booking ${booking.id}`,
    metadata: {
      inquiryId: booking.id, bookingRequestId: booking.bookingRequestId!,
      fareCents: String(booking.estimatedFareCents), gratuityCents: String(booking.gratuityCents ?? 0),
    },
    }, { idempotencyKey: `booking-auth-${booking.bookingRequestId}-${booking.stripePaymentIntentId || "initial"}` });
  } catch (error) {
    if (definitiveCardRejection(error)) {
      throw new AuthorizationRejectedError(error instanceof Error ? error.message : "The card was declined. No authorization hold was placed.");
    }
    throw error;
  }
  validateIntent(intent);
  await effects.savePayment(intent);
  if (intent.status === "requires_payment_method" || intent.status === "canceled") {
    throw new AuthorizationRejectedError("The card authorization was rejected or released. Start a fresh booking to change your card.");
  }
  if (intent.status !== "requires_capture") throw new Error("The card authorization hold was not completed.");
  await effects.activate(intent);
  return intent;
}
