import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { CorporateAccount, PrismaClient } from "@prisma/client";
import type Stripe from "stripe";
import { CORPORATE_BILLING_VERSION, type CorporateAccountView, type CorporateApplicationInput, type CorporateBookingView, type CorporateTripInput } from "../shared/corporate.js";
import { RATE_TIER_PRICING } from "../shared/pricing.js";
import { prisma } from "./store.js";
import { sendCorporateAccessEmail, CorporateEmailError, assertCorporateEmailConfigured } from "./corporate-mail.js";
import { getStripeClient } from "./stripe-client.js";

export class CorporateError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export const capabilityHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
export const accountView = (a: CorporateAccount): CorporateAccountView => ({
  id: a.id, companyLegalName: a.companyLegalName, contactName: a.contactName, contactEmail: a.contactEmail,
  contactPhone: a.contactPhone, monthlyRideVolume: a.monthlyRideVolume, billingPreference: a.billingPreference as CorporateAccountView["billingPreference"],
  billingName: a.billingName, billingEmail: a.billingEmail, billingAddress: a.billingAddress,
  status: a.status, createdAt: a.createdAt.toISOString(), paymentReady: !!a.stripePaymentMethodId,
  mustChangePassword: a.mustChangePassword, credentialsEmailStatus: a.credentialsEmailStatus,
  rejectionReason: a.rejectionReason, approvedAt: a.approvedAt?.toISOString() || null,
});
export const corporateBookingView = (b: any): CorporateBookingView => ({
  id: b.id, reference: b.id.slice(-6).toUpperCase(), pickup: b.pickup, destination: b.destination,
  pickupAt: b.pickupAt.toISOString(), fullName: b.fullName, status: b.ride?.status || b.status,
  fareCents: b.estimatedFareCents, gratuityCents: b.gratuityCents, authorizedTotalCents: b.authorizedTotalCents,
  paymentStatus: b.paymentStatus, poNumber: b.poNumber, costCenterCode: b.costCenterCode,
});
type Quote = { accountId: string; userId: string; trip: CorporateTripInput; fareCents: number; expiresAt: number };
function signingKey() {
  if (!process.env.SESSION_SECRET) throw new CorporateError(503, "Corporate quote signing is not configured.");
  return process.env.SESSION_SECRET;
}
export function signCorporateQuote(quote: Quote, key = signingKey()) {
  const body = Buffer.from(JSON.stringify(quote)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", key).update(body).digest("base64url")}`;
}
export function readCorporateQuote(token: string, key = signingKey()): Quote {
  const [body, signature, extra] = token.split(".");
  const expected = crypto.createHmac("sha256", key).update(body || "").digest();
  const supplied = Buffer.from(signature || "", "base64url");
  if (extra || supplied.length !== expected.length || !crypto.timingSafeEqual(expected, supplied)) throw new CorporateError(400, "This quote is invalid. Review the ride again.");
  try {
    const quote = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!quote.trip || !Number.isSafeInteger(quote.fareCents) || quote.fareCents < 1 || quote.fareCents > 10000000 || !Number.isFinite(quote.expiresAt)) throw Error();
    return quote;
  } catch { throw new CorporateError(400, "This quote is invalid."); }
}
export class CorporateService {
  constructor(
    readonly db: PrismaClient = prisma,
    readonly stripe: () => Promise<Stripe> = getStripeClient,
    readonly sendEmail = sendCorporateAccessEmail,
    readonly assertEmail: () => void | Promise<void> = assertCorporateEmailConfigured,
  ) {}
  async apply(data: CorporateApplicationInput) {
    const token = data.applicationToken || crypto.randomBytes(32).toString("hex");
    const { billingConsent, applicationToken, ...profile } = data;
    const existing = await this.db.corporateAccount.findUnique({ where: { applicationTokenHash: capabilityHash(token) } });
    if (existing) {
      if (existing.applicationTokenExpiresAt <= new Date() || existing.status !== "PENDING" ||
          Object.entries(profile).some(([key, value]) => existing[key as keyof CorporateAccount] !== value)) {
        throw new CorporateError(409, "This application request was already used. Do not change its details while retrying.");
      }
      return { application: { id: existing.id, status: existing.status }, applicationToken: token };
    }
    const application = await this.db.corporateAccount.create({ data: {
      ...profile, billingConsentAt: new Date(), billingConsentVersion: CORPORATE_BILLING_VERSION,
      applicationTokenHash: capabilityHash(token), applicationTokenExpiresAt: new Date(Date.now() + 7 * 86400000),
    } });
    return { application: { id: application.id, status: application.status }, applicationToken: token };
  }
  async applicant(id: string, token: string) {
    const account = await this.db.corporateAccount.findFirst({ where: {
      id, applicationTokenHash: capabilityHash(token), applicationTokenExpiresAt: { gt: new Date() }, status: "PENDING",
    } });
    if (!account) throw new CorporateError(404, "This application link is unavailable or expired.");
    return account;
  }
  async account(userId: string) {
    const account = await this.db.corporateAccount.findUnique({ where: { userId } });
    if (!account || account.status !== "ACTIVE") throw new CorporateError(403, "An approved, active corporate account is required.");
    if (account.mustChangePassword && (!account.credentialsExpiresAt || account.credentialsExpiresAt <= new Date())) {
      throw new CorporateError(401, "Your temporary password expired. Contact dispatch for new access.");
    }
    return account;
  }
  async setup(account: CorporateAccount, origin: string, applicant = false) {
    const stripe = await this.stripe();
    let customerId = account.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: account.companyLegalName, email: account.billingEmail,
        metadata: { corporateAccountId: account.id },
      }, { idempotencyKey: `corporate-customer-${account.id}` });
      customerId = customer.id;
      await this.db.corporateAccount.update({ where: { id: account.id }, data: { stripeCustomerId: customerId } });
    }
    const returnPath = applicant ? `/corporate?application=${encodeURIComponent(account.id)}&` : "/corporate/portal?";
    const session = await stripe.checkout.sessions.create({
      mode: "setup", customer: customerId, currency: "usd", payment_method_types: ["card"],
      setup_intent_data: { metadata: { corporateAccountId: account.id } },
      metadata: { corporateAccountId: account.id },
      custom_text: { submit: { message: "Authorize Allen Express, LLC (dba Allan Limousine) to save this company payment method and charge the reviewed fare for each completed ride, not a monthly invoice." } },
      success_url: `${origin}${returnPath}session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}${applicant ? `/corporate?application=${encodeURIComponent(account.id)}` : "/corporate/portal"}`,
    }, { idempotencyKey: `corporate-setup-${account.id}-${Math.floor(Date.now() / 1800000)}` });
    if (!session.url) throw new CorporateError(503, "Stripe did not return a secure payment setup link.");
    await this.db.corporateAccount.update({ where: { id: account.id }, data: { stripeSetupSessionId: session.id } });
    return { url: session.url };
  }
  async confirmPayment(account: CorporateAccount, sessionId: string) {
    const stripe = await this.stripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["setup_intent"] });
    const customer = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const setup = session.setup_intent as Stripe.SetupIntent | null;
    if (session.id !== account.stripeSetupSessionId || session.mode !== "setup" || session.status !== "complete" ||
        customer !== account.stripeCustomerId || session.metadata?.corporateAccountId !== account.id ||
        !setup || setup.status !== "succeeded" || setup.usage !== "off_session" || setup.metadata?.corporateAccountId !== account.id) {
      throw new CorporateError(409, "The company payment method has not been verified. Finish its secure Stripe setup.");
    }
    const methodId = typeof setup.payment_method === "string" ? setup.payment_method : setup.payment_method?.id;
    if (!methodId) throw new CorporateError(409, "Stripe did not confirm a payment method.");
    const method = await stripe.paymentMethods.retrieve(methodId);
    const owner = typeof method.customer === "string" ? method.customer : method.customer?.id;
    if (owner !== account.stripeCustomerId || method.type !== "card") throw new CorporateError(409, "This payment method does not belong to the company.");
    const saved = await this.db.corporateAccount.updateMany({
      where: { id: account.id, status: account.status, stripeCustomerId: customer, stripeSetupSessionId: sessionId },
      data: { stripePaymentMethodId: method.id },
    });
    if (!saved.count) throw new CorporateError(409, "The corporate account changed during payment setup. Reopen it.");
    return { message: account.status === "PENDING" ? "Payment method verified. Your application is awaiting admin approval." : "Company payment method verified." };
  }
  async approve(id: string, actorId: string, origin: string) {
    await this.assertEmail();
    const password = crypto.randomBytes(24).toString("base64url");
    const hash = await bcrypt.hash(password, 12);
    let createdUser = false;
    const account = await this.db.$transaction(async db => {
      const a = await db.corporateAccount.findUnique({ where: { id } });
      if (!a || a.status !== "PENDING" || !a.stripePaymentMethodId || !a.stripeCustomerId) throw new CorporateError(409, "Only pending applications with a verified company payment method can be approved.");
      let user = await db.adminUser.findUnique({ where: { email: a.contactEmail } });
      if (user && (!user.active || user.role !== "USER")) throw new CorporateError(409, "The contact email belongs to an unavailable or staff account. Resolve this without replacing its credentials.");
      if (!user) {
        user = await db.adminUser.create({ data: { email: a.contactEmail, name: a.contactName, passwordHash: hash, role: "USER", permissions: [] } });
        createdUser = true;
      }
      return db.corporateAccount.update({ where: { id }, data: {
        status: "ACTIVE", userId: user.id, approvedAt: new Date(), approvedById: actorId,
        mustChangePassword: createdUser, credentialsExpiresAt: createdUser ? new Date(Date.now() + 86400000) : null,
        credentialsEmailStatus: "PENDING",
      } });
    }, { isolationLevel: "Serializable" });
    return this.deliver(account, createdUser ? password : null, origin);
  }
  async deliver(account: CorporateAccount, password: string | null, origin: string) {
    let status = "SENT";
    try { await this.sendEmail(account.contactEmail, account.contactEmail, password, `${origin}/login`); }
    catch (error) { status = error instanceof CorporateEmailError && error.definitive ? "FAILED" : "UNCERTAIN"; }
    const saved = await this.db.corporateAccount.update({ where: { id: account.id }, data: { credentialsEmailStatus: status } });
    return { account: accountView(saved), message: status === "SENT" ? "Account approved. Access details were accepted by the email provider." : "Account approved, but access email delivery is not confirmed. Use Resend access to revoke the old temporary password and send new access." };
  }
  async resend(id: string, origin: string) {
    await this.assertEmail();
    const password = crypto.randomBytes(24).toString("base64url");
    const hash = await bcrypt.hash(password, 12);
    const account = await this.db.$transaction(async db => {
      const a = await db.corporateAccount.findUnique({ where: { id } });
      if (!a || a.status !== "ACTIVE" || !a.userId) throw new CorporateError(409, "This account has not been approved.");
      // Never reset an established customer's password through email recovery.
      if (!a.mustChangePassword) return a;
      await db.adminUser.update({ where: { id: a.userId }, data: { passwordHash: hash } });
      await db.adminSession.deleteMany({ where: { userId: a.userId } });
      return db.corporateAccount.update({ where: { id }, data: { credentialsExpiresAt: new Date(Date.now() + 86400000), credentialsEmailStatus: "PENDING" } });
    }, { isolationLevel: "Serializable" });
    return this.deliver(account, account.mustChangePassword ? password : null, origin);
  }
  async book(account: CorporateAccount, userId: string, token: string) {
    const quote = readCorporateQuote(token);
    if (quote.accountId !== account.id || quote.userId !== userId) throw new CorporateError(403, "This quote belongs to a different corporate account.");
    const trip = quote.trip;
    const fingerprint = capabilityHash(JSON.stringify({ accountId: account.id, trip, fareCents: quote.fareCents }));
    return this.db.$transaction(async db => {
      const existing = await db.inquiry.findUnique({ where: { bookingRequestId: trip.bookingRequestId }, include: { ride: true } });
      if (existing) {
        if (existing.corporateAccountId !== account.id || existing.customerUserId !== userId || existing.bookingRequestFingerprint !== fingerprint) {
          throw new CorporateError(409, "This booking request was already used for a different ride. Do not resubmit it.");
        }
        return { booking: corporateBookingView(existing) };
      }
      if (quote.expiresAt <= Date.now() || new Date(trip.pickupAt).getTime() <= Date.now()) throw new CorporateError(409, "The quote expired or pickup is in the past. Review the ride again.");
      const current = await db.corporateAccount.findUnique({ where: { id: account.id } });
      if (!current || current.status !== "ACTIVE" || current.mustChangePassword || current.userId !== userId ||
          !current.stripeCustomerId || !current.stripePaymentMethodId) throw new CorporateError(409, "An active account, permanent password and verified company payment method are required.");
      const booking = await db.inquiry.create({ data: {
        corporateAccountId: account.id, companyName: current.companyLegalName, customerUserId: userId,
        fullName: trip.fullName, email: current.contactEmail, phone: trip.phone,
        pickup: trip.pickup, destination: trip.destination, pickupAt: new Date(trip.pickupAt),
        passengers: trip.passengers, serviceType: RATE_TIER_PRICING[trip.rateTier].label, rateTier: trip.rateTier,
        poNumber: trip.poNumber, costCenterCode: trip.costCenterCode, notes: trip.notes,
        airportCode: trip.airportCode, flightNumber: trip.flightNumber,
        flightScheduledAt: trip.flightScheduledAt ? new Date(trip.flightScheduledAt) : null,
        estimatedFareCents: quote.fareCents, grossFareCents: quote.fareCents, authorizedTotalCents: quote.fareCents,
        gratuityCents: 0, bookingRequestId: trip.bookingRequestId, bookingRequestFingerprint: fingerprint,
        stripeCustomerId: current.stripeCustomerId, stripePaymentMethodId: current.stripePaymentMethodId,
        paymentStatus: "corporate_ready", status: "NEW", source: "corporate_portal",
        ride: { create: { quoteCents: quote.fareCents } },
        notifications: { create: { type: "NEW_INQUIRY", title: "New corporate reservation", body: `${current.companyLegalName}: PO ${trip.poNumber}, cost center ${trip.costCenterCode}.` } },
      }, include: { ride: true } });
      return { booking: corporateBookingView(booking) };
    }, { isolationLevel: "Serializable" });
  }
}
