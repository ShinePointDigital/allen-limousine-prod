import type Stripe from "stripe";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./store.js";
import { getStripeClient } from "./stripe-client.js";
import { CORPORATE_BRAND } from "../shared/corporate.js";

export class CorporateBillingError extends Error {}
export async function chargeCorporateBooking(bookingRequestId: string, deps: {
  db: PrismaClient; stripe: () => Promise<Stripe>; now?: () => Date;
} = { db: prisma, stripe: getStripeClient }) {
  const now = deps.now?.() || new Date();
  let booking = await deps.db.inquiry.findUnique({ where: { bookingRequestId }, include: { corporateAccount: true, ride: true } });
  if (!booking?.corporateAccount || !booking.corporateAccountId) throw new CorporateBillingError("This is not a corporate booking.");
  if (booking.status === "CANCELLED" || !booking.ride || !["IN_PROGRESS", "COMPLETED"].includes(booking.ride.status)) {
    throw new CorporateBillingError("Corporate billing is only available when completing a ride that is in progress.");
  }
  const amount = booking.authorizedTotalCents;
  if (!Number.isSafeInteger(amount) || !amount || amount < 1 || amount !== (booking.estimatedFareCents || 0) + booking.gratuityCents ||
      !booking.stripeCustomerId || !booking.stripePaymentMethodId) throw new CorporateBillingError("The corporate booking's approved billing details are incomplete.");
  const stripe = await deps.stripe();
  let intent: Stripe.PaymentIntent;
  if (booking.stripePaymentIntentId) {
    intent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
    validateIntent(intent, booking.stripeCustomerId, amount, booking.id);
    if (intent.status === "requires_payment_method" && booking.corporateAccount.status === "ACTIVE" &&
        booking.corporateAccount.stripeCustomerId === booking.stripeCustomerId &&
        booking.corporateAccount.stripePaymentMethodId && booking.corporateAccount.stripePaymentMethodId !== booking.stripePaymentMethodId) {
      // A replacement card re-confirms the original intent, never a new charge.
      intent = await stripe.paymentIntents.confirm(intent.id, {
        payment_method: booking.corporateAccount.stripePaymentMethodId, off_session: true,
      }, { idempotencyKey: `corporate-retry-${intent.id}-${booking.corporateAccount.stripePaymentMethodId}` });
    }
  } else {
    if (booking.corporateAccount.status !== "ACTIVE") throw new CorporateBillingError("This corporate account is not active.");
    if (!booking.corporateChargeStartedAt) {
      await deps.db.inquiry.updateMany({
        where: { id: booking.id, corporateChargeStartedAt: null, stripePaymentIntentId: null, paymentStatus: "corporate_ready",
          status: { not: "CANCELLED" }, ride: { is: { status: "IN_PROGRESS" } }, corporateAccount: { is: { status: "ACTIVE" } } },
        data: { corporateChargeStartedAt: now, paymentStatus: "corporate_charging" },
      });
      booking = await deps.db.inquiry.findUniqueOrThrow({ where: { id: booking.id }, include: { corporateAccount: true, ride: true } });
    }
    if (booking.stripePaymentIntentId) return chargeCorporateBooking(bookingRequestId, deps);
    if (booking.status === "CANCELLED" || booking.ride?.status !== "IN_PROGRESS" || booking.corporateAccount?.status !== "ACTIVE") {
      throw new CorporateBillingError("The ride or corporate account changed before charging. No new charge was created.");
    }
    // Stripe retains idempotency keys for at least 24 hours. Never silently create
    // another charge after an unresolved reservation outlives that window.
    if (!booking.corporateChargeStartedAt || now.getTime() - booking.corporateChargeStartedAt.getTime() >= 23 * 3600000) {
      throw new CorporateBillingError("An earlier corporate charge is unresolved. Reconcile it in Stripe before retrying; no new charge was created.");
    }
    try {
      intent = await stripe.paymentIntents.create({
        amount, currency: "usd", customer: booking.stripeCustomerId!,
        payment_method: booking.stripePaymentMethodId!, confirm: true, off_session: true,
        description: `${CORPORATE_BRAND} — completed ride ${booking.id.slice(-6).toUpperCase()}${booking.corporateAccount!.billingPreference === "ITEMIZED_PO_RECEIPTS" ? ` · PO ${booking.poNumber} · Cost center ${booking.costCenterCode}` : ""}`,
        receipt_email: booking.corporateAccount!.billingEmail,
        metadata: { inquiryId: booking.id, corporateAccountId: booking.corporateAccountId!, poNumber: booking.poNumber || "", costCenterCode: booking.costCenterCode || "" },
      }, { idempotencyKey: `corporate-ride-${bookingRequestId}` });
    } catch (error) {
      const failed = (error as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
      if (!failed?.id) throw new CorporateBillingError("The corporate charge outcome is not confirmed. Retry this same ride; do not create another booking.");
      intent = failed;
    }
  }
  validateIntent(intent, booking.stripeCustomerId!, amount, booking.id);
  await deps.db.inquiry.update({
    where: { id: booking.id },
    data: { stripePaymentIntentId: intent.id, paymentStatus: intent.status === "succeeded" && intent.amount_received !== amount ? "corporate_review" : intent.status },
  });
  if (intent.status !== "succeeded" || intent.amount_received !== amount) {
    throw new CorporateBillingError(intent.status === "requires_action"
      ? "The company card requires bank authentication. The corporate contact must authorize the existing charge in the portal, then retry completing this ride."
      : "Corporate payment has not succeeded. Update the company payment method if needed and retry this same ride.");
  }
  await deps.db.ride.update({ where: { inquiryId: booking.id }, data: { collectedCents: amount } });
  return intent;
}

export function validateIntent(intent: Pick<Stripe.PaymentIntent, "amount" | "currency" | "customer" | "metadata">, customerId: string, amount: number, inquiryId: string) {
  const customer = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;
  if (intent.amount !== amount || intent.currency !== "usd" || customer !== customerId || intent.metadata.inquiryId !== inquiryId) {
    throw new CorporateBillingError("The corporate payment does not match the approved trip, customer and amount.");
  }
}
