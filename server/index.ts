import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { addInquiry, addInquiryNote, authenticate, consumeStripeSetupSession, createAdmin, createDispatchAttempt, createFleet, createService, createStripeSetupSession, dashboardData, deleteFleet, deleteService, dispatchBrief, finalizeAuthorizedInquiry, finishDispatchAttempt, getAdminContent, getDispatchAttempt, getDispatchAttemptByProviderMessageId, getInquiries, getInquiryByBookingRequestId, getInquiryByTrackingTokenHash, getNotifications, getPendingDispatchAttempt, getPublicContent, getRideById, getRideByInquiryId, getRides, getStripeCustomerProfile, initializeStore, listAdmins, logout, markNotificationRead, reconcileDispatchAttempt, saveStripeCustomerProfile, sessionUser, updateAdmin, updateDispatchDeliveryStatus, updateDispatchProviderStatus, updateFleet, updateInquiry, updateInquiryPayment, updateInquiryPaymentStatusByIntent, updateRide, updateService, updateSiteContent, validateRideUpdate } from "./store.js";
import { classifyTwilioMessageStatus, getDriverDispatchSms, sendSms, sendDriverDispatchSms, TwilioRequestError } from "./twilio.js";
import { estimateFare, reverseGeocode, searchLocations } from "./fare-estimate.js";
import { getStripeClient, getStripePublicConfig, getStripeWebhookSecret } from "./stripe-client.js";

export const app = express();
const port = Number(process.env.PORT) || 5000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.set("trust proxy", 1);
app.post("/api/webhooks/stripe", express.raw({ type: "application/json", limit: "512kb" }), async (req, res) => {
  const signature = req.header("stripe-signature");
  if (!signature) return res.status(400).json({ error: "Missing Stripe signature." });
  try {
    const stripe = await getStripeClient();
    const event = stripe.webhooks.constructEvent(req.body, signature, await getStripeWebhookSecret());
    if (event.type.startsWith("payment_intent.")) {
      const intent = event.data.object as { id: string; status: string };
      const inquiry = await updateInquiryPaymentStatusByIntent(intent.id, intent.status);
      if (intent.status === "canceled" && inquiry && "id" in inquiry) {
        const ride = await getRideByInquiryId(inquiry.id);
        if (ride && ride.status !== "CANCELLED") await updateRide(ride.id, { status: "CANCELLED" });
      }
    }
    res.json({ received: true });
  } catch {
    res.status(400).json({ error: "Invalid Stripe webhook." });
  }
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));
app.use(cookieParser());
app.use(compression());
const inquiryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many reservation requests. Please try again shortly." } });
const publicReadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
const dispatchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many dispatch messages. Please try again shortly." } });
const webhookLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 240, standardHeaders: "draft-7", legacyHeaders: false });

const inquirySchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().min(7).max(30),
  serviceType: z.string().trim().min(2).max(80),
  pickupAt: z.string().datetime(),
  pickup: z.string().trim().min(2).max(180),
  destination: z.string().trim().min(2).max(180),
  passengers: z.coerce.number().int().min(1).max(50),
  notes: z.string().max(1000).optional().default(""),
  airportCode: z.enum(["ORD", "MDW", "DFW", "DAL"]).optional(),
  airportTerminal: z.string().trim().max(100).optional(),
  flightNumber: z.string().trim().max(20).optional(),
  flightScheduledAt: z.string().datetime().optional(),
  pickupPreference: z.string().trim().max(100).optional(),
  isPrivateFBO: z.boolean().optional().default(false),
  specificTailNumber: z.string().trim().max(40).optional(),
  principalName: z.string().trim().max(100).optional(),
  fboName: z.string().trim().max(100).optional(),
  tarmacInstructions: z.string().trim().max(400).optional(),
  rateTier: z.enum(["EXECUTIVE_SEDAN", "LUXURY_SUV", "SPRINTER_CLASS"]),
  estimatedFareCents: z.number().int().min(0).max(10000000).optional(),
  estimatedMiles: z.number().finite().min(0).max(10000).optional(),
  estimatedMinutes: z.number().finite().min(0).max(10000).optional(),
  rideTiming: z.enum(["RIDE_NOW", "RESERVE_LATER"]).optional(),
  promoCode: z.string().trim().max(40).optional(),
  promoDiscountCents: z.number().int().min(0).max(1500).optional(),
  bookingRequestId: z.string().uuid(),
  pickupLatitude: z.number().finite().min(-90).max(90).optional(),
  pickupLongitude: z.number().finite().min(-180).max(180).optional(),
  destinationLatitude: z.number().finite().min(-90).max(90).optional(),
  destinationLongitude: z.number().finite().min(-180).max(180).optional(),
});
const fareEstimateSchema = z.object({
  pickup: z.string().trim().min(2).max(180),
  destination: z.string().trim().min(2).max(180),
  tier: z.enum(["EXECUTIVE_SEDAN", "LUXURY_SUV", "SPRINTER_CLASS"]),
  pickupLat: z.coerce.number().finite().min(-90).max(90).optional(),
  pickupLon: z.coerce.number().finite().min(-180).max(180).optional(),
  destinationLat: z.coerce.number().finite().min(-90).max(90).optional(),
  destinationLon: z.coerce.number().finite().min(-180).max(180).optional(),
  isPrivateFBO: z.enum(["true", "false"]).transform(value => value === "true").optional().default(false),
});
const coordinatesSchema = z.object({
  lat: z.coerce.number().finite().min(-90).max(90),
  lon: z.coerce.number().finite().min(-180).max(180),
});
const trackingTokenHash = (token: string) => crypto.createHash("sha256").update(token).digest("hex");
const trustedPublicHosts = new Set([
  "allanlimousine.com",
  "www.allanlimousine.com",
  ...(process.env.REPLIT_DOMAINS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean),
  ...(process.env.REPLIT_DEV_DOMAIN || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean),
]);
const publicOrigin = (req: express.Request) => {
  const configured = process.env.PUBLIC_APP_ORIGIN?.trim();
  if (configured) {
    const parsed = new URL(configured);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")) {
      throw new Error("PUBLIC_APP_ORIGIN must be an HTTPS origin without credentials or query parameters.");
    }
    return parsed.origin;
  }
  const host = (req.get("host") || "").split(",")[0].trim().toLowerCase();
  const hostname = host.replace(/:\d+$/, "");
  const isKnownReplitHost = hostname.endsWith(".replit.app") || hostname.endsWith(".replit.dev");
  const isLocalHost = ["localhost", "127.0.0.1"].includes(hostname);
  if (!host || (!trustedPublicHosts.has(hostname) && !isKnownReplitHost && !(process.env.NODE_ENV !== "production" && isLocalHost))) {
    throw new Error("No trusted public app origin is configured for booking links.");
  }
  if (process.env.NODE_ENV === "production" || !isLocalHost) return `https://${host}`;
  return `${req.protocol}://${host}`;
};
const bookingTrackingUrl = (req: express.Request, token: string) => {
  const url = new URL("/", publicOrigin(req));
  url.searchParams.set("tracking", token);
  return url.toString();
};
const sendBookingTrackingSms = async (req: express.Request, inquiry: { id: string; phone: string; estimatedFareCents?: number | null }, trackingToken: string) => {
  const link = bookingTrackingUrl(req, trackingToken);
  const fare = inquiry.estimatedFareCents == null ? "" : ` Estimated fare: $${Math.round(inquiry.estimatedFareCents / 100)}.`;
  await sendSms(inquiry.phone, `ALLAN Livery: Booking ${inquiry.id.slice(-6).toUpperCase()} received.${fare} Follow your reservation and driver updates: ${link}`);
};
const stripeProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().email(),
});
const finalizeSetupSchema = z.object({
  setupIntentId: z.string().regex(/^seti_[A-Za-z0-9]+$/),
  customerId: z.string().regex(/^cus_[A-Za-z0-9]+$/),
  setupToken: z.string().min(40).max(500),
});
const paymentIntentSchema = z.object({
  bookingRequestId: z.string().uuid(),
  customerId: z.string().regex(/^cus_[A-Za-z0-9]+$/),
  paymentMethodId: z.string().regex(/^pm_[A-Za-z0-9]+$/),
  capability: z.string().min(40).max(2000),
  trackingToken: z.string().regex(/^[a-f0-9]{64}$/),
});
const paymentMethodAccessSchema = z.object({
  customerId: z.string().regex(/^cus_[A-Za-z0-9]+$/),
  email: z.string().trim().email(),
  capability: z.string().min(40).max(2000),
});
const deletePaymentMethodSchema = paymentMethodAccessSchema.extend({
  paymentMethodId: z.string().regex(/^pm_[A-Za-z0-9]+$/),
});
const flightLookupSchema = z.object({
  flightNumber: z.string().trim().max(20),
});
const flightRouteAirportSchema = z.object({
  iata_code: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  name: z.string().max(200).optional(),
});
const flightRouteResponseSchema = z.object({
  response: z.object({
    flightroute: z.object({
      callsign_iata: z.string().optional(),
      airline: z.object({
        name: z.string().max(160).optional(),
        iata: z.string().regex(/^[A-Za-z0-9]{2,3}$/).optional(),
      }).optional(),
      origin: flightRouteAirportSchema.optional(),
      destination: flightRouteAirportSchema.optional(),
    }).optional(),
  }).optional(),
});
const authSchema = z.object({ email: z.string().email(), password: z.string().min(8).max(200) });
const moneyCents = z.coerce.number().finite().min(0).max(10000000).transform(value => Math.round(value * 100));
const rideUpdateSchema = z.object({
  status: z.enum(["UNASSIGNED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional(),
  driverName: z.string().trim().max(100).nullable().optional(),
  driverPhone: z.string().trim().max(30).nullable().optional(),
  driverLatitude: z.number().finite().min(-90).max(90).nullable().optional(),
  driverLongitude: z.number().finite().min(-180).max(180).nullable().optional(),
  driverHeading: z.number().finite().min(0).max(360).nullable().optional(),
  locationUpdatedAt: z.string().datetime().nullable().optional(),
  vehicleId: z.string().trim().max(50).nullable().optional(),
  quote: moneyCents.optional(),
  deposit: moneyCents.optional(),
  collected: moneyCents.optional(),
  expense: moneyCents.optional(),
  dispatchNotes: z.string().max(1000).nullable().optional(),
}).superRefine((data, context) => {
  if (data.deposit !== undefined && data.quote !== undefined && data.deposit > data.quote) context.addIssue({ code: "custom", path: ["deposit"], message: "Deposit cannot exceed the quoted fare." });
  if (data.collected !== undefined && data.quote !== undefined && data.collected > data.quote) context.addIssue({ code: "custom", path: ["collected"], message: "Collected amount cannot exceed the quoted fare." });
  if ((data.driverLatitude === null) !== (data.driverLongitude === null)) context.addIssue({ code: "custom", path: ["driverLatitude"], message: "Clear both driver coordinates together." });
  if ((data.driverLatitude === undefined) !== (data.driverLongitude === undefined)) context.addIssue({ code: "custom", path: ["driverLatitude"], message: "Provide both driver latitude and longitude." });
});
async function captureAuthorizedPayment(bookingRequestId: string) {
  const inquiry = await getInquiryByBookingRequestId(bookingRequestId);
  if (!inquiry?.stripePaymentIntentId) throw new Error("No card authorization exists for this booking.");
  const stripe = await getStripeClient();
  const current = await stripe.paymentIntents.retrieve(inquiry.stripePaymentIntentId);
  if (current.status === "succeeded") {
    await updateInquiryPaymentStatusByIntent(current.id, current.status);
    return current;
  }
  if (current.status !== "requires_capture") throw new Error(`Payment cannot be captured while its status is ${current.status}.`);
  const captured = await stripe.paymentIntents.capture(
    current.id,
    {},
    { idempotencyKey: `capture-${current.id}` },
  );
  await updateInquiryPaymentStatusByIntent(captured.id, captured.status);
  return captured;
}
async function cancelAuthorizedPayment(bookingRequestId: string) {
  const inquiry = await getInquiryByBookingRequestId(bookingRequestId);
  if (!inquiry?.stripePaymentIntentId) throw new Error("No card authorization exists for this booking.");
  const stripe = await getStripeClient();
  const current = await stripe.paymentIntents.retrieve(inquiry.stripePaymentIntentId);
  if (current.status === "canceled") {
    await updateInquiryPaymentStatusByIntent(current.id, current.status);
    return current;
  }
  if (current.status === "succeeded") throw new Error("This payment was already captured. Refund it in Stripe before cancelling the completed payment.");
  if (current.status !== "requires_capture") throw new Error(`The authorization cannot be released while its status is ${current.status}.`);
  const canceled = await stripe.paymentIntents.cancel(current.id, {}, { idempotencyKey: `cancel-${current.id}` });
  await updateInquiryPaymentStatusByIntent(canceled.id, canceled.status);
  return canceled;
}
async function activateAuthorizedBooking(bookingRequestId: string, token: string, pickupAt: string, paymentIntentId: string) {
  const pickupExpiry = new Date(pickupAt).getTime() + 24 * 60 * 60 * 1000;
  const expiresAt = new Date(Math.min(Math.max(pickupExpiry, Date.now() + 24 * 60 * 60 * 1000), Date.now() + 30 * 24 * 60 * 60 * 1000));
  const activate = () => finalizeAuthorizedInquiry(bookingRequestId, trackingTokenHash(token), expiresAt.toISOString());
  try {
    return await activate();
  } catch (firstError) {
    const afterFirstAttempt = await getInquiryByBookingRequestId(bookingRequestId);
    if (afterFirstAttempt && afterFirstAttempt.status !== "PAYMENT_PENDING") return { inquiry: afterFirstAttempt, activatedNow: false };
    const promoConflict = firstError instanceof Error && firstError.message.startsWith("The first-ride credit was already used.");
    if (promoConflict) {
      const stripe = await getStripeClient();
      const current = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (current.status === "requires_capture") {
        const canceled = await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey: `activation-failed-${paymentIntentId}` });
        await updateInquiryPaymentStatusByIntent(canceled.id, canceled.status);
      }
      throw firstError;
    }
    try {
      return await activate();
    } catch (retryError) {
      const afterRetry = await getInquiryByBookingRequestId(bookingRequestId);
      if (afterRetry && afterRetry.status !== "PAYMENT_PENDING") return { inquiry: afterRetry, activatedNow: false };
      const retryPromoConflict = retryError instanceof Error && retryError.message.startsWith("The first-ride credit was already used.");
      if (retryPromoConflict) {
        const stripe = await getStripeClient();
        const current = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (current.status === "requires_capture") {
          const canceled = await stripe.paymentIntents.cancel(paymentIntentId, {}, { idempotencyKey: `activation-failed-${paymentIntentId}` });
          await updateInquiryPaymentStatusByIntent(canceled.id, canceled.status);
        }
      }
      throw retryError;
    }
  }
}
async function completeRideWithCapture(rideId: string, preCompletionUpdate: Parameters<typeof updateRide>[1] = {}) {
  let ride = await getRideById(rideId);
  if (!ride) return null;
  if (Object.keys(preCompletionUpdate).length) {
    ride = await updateRide(rideId, preCompletionUpdate);
    if (!ride) return null;
  }
  const inquiry = (await getInquiries()).find(item => item.id === ride!.inquiryId);
  if (ride.status === "COMPLETED") {
    if (inquiry?.bookingRequestId && inquiry.paymentStatus === "requires_capture") await captureAuthorizedPayment(inquiry.bookingRequestId);
    return ride;
  }
  if (inquiry?.bookingRequestId && (inquiry.stripePaymentIntentId || inquiry.paymentStatus === "authorization_pending")) {
    await captureAuthorizedPayment(inquiry.bookingRequestId);
  }
  return updateRide(rideId, { status: "COMPLETED" });
}
const admin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const user = await sessionUser(req.cookies.allan_session);
  if (!user) return res.status(401).json({ error: "Your session has expired. Please sign in again." });
  res.locals.user = user;
  next();
};
function normalizePhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (value.trim().startsWith("+") && digits.length >= 10 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  throw new Error("Enter a valid driver phone number, including country code when needed.");
}
function normalizeCustomerPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  throw new Error("Enter a valid passenger phone number.");
}
type PaymentCapability = {
  customerId: string;
  paymentMethodId: string;
  email: string;
  expiresAt: number;
};
function paymentCapabilitySignature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is required.");
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}
function createPaymentCapability(data: Omit<PaymentCapability, "expiresAt">) {
  const payload = Buffer.from(JSON.stringify({ ...data, expiresAt: Date.now() + 180 * 24 * 60 * 60 * 1000 })).toString("base64url");
  return `${payload}.${paymentCapabilitySignature(payload)}`;
}
function verifyPaymentCapability(token: string): PaymentCapability | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = paymentCapabilitySignature(payload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as PaymentCapability;
    return data.expiresAt > Date.now() ? data : null;
  } catch {
    return null;
  }
}
const superAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.locals.user?.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Super-admin access is required." });
  next();
};
type FlightLookupResult = {
  found: true;
  flightNumber: string;
  airline: string;
  originAirportCode: string;
  destinationAirportCode: string;
  arrivalTerminal: string | null;
};
const flightLookupCache = new Map<string, { expiresAt: number; result: FlightLookupResult | null }>();
const chicagoArrivalTerminals: Record<string, Record<string, string>> = {
  ORD: {
    UA: "Terminal 1",
    AC: "Terminal 2",
    AA: "Terminal 3",
    AS: "Terminal 3",
    NK: "Terminal 3",
    DL: "Terminal 5",
    BA: "Terminal 5",
    LH: "Terminal 5",
  },
  MDW: {
    WN: "Concourse B",
    F9: "Concourse A",
    PD: "Concourse A",
  },
};
const normalizedFlightNumber = (value: string) => {
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = normalized.match(/^([A-Z]{2}|[A-Z]\d|[A-Z]{3})(\d{1,4}[A-Z]?)$/);
  return match ? `${match[1]} ${match[2]}` : "";
};
const getFlightLookup = async (flightNumber: string): Promise<FlightLookupResult | null> => {
  const normalized = normalizedFlightNumber(flightNumber);
  if (!normalized) return null;
  const cached = flightLookupCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  try {
    const response = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(normalized.replace(" ", ""))}`, {
      headers: { Accept: "application/json", "User-Agent": "ALLAN-Livery/1.0 flight lookup" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      flightLookupCache.set(normalized, { expiresAt: Date.now() + 60_000, result: null });
      return null;
    }
    const parsed = flightRouteResponseSchema.safeParse(await response.json());
    const route = parsed.success ? parsed.data.response?.flightroute : undefined;
    const originAirportCode = route?.origin?.iata_code?.toUpperCase() || "";
    const destinationAirportCode = route?.destination?.iata_code?.toUpperCase() || "";
    if (!/^[A-Z]{3}$/.test(originAirportCode) || !/^[A-Z]{3}$/.test(destinationAirportCode)) {
      flightLookupCache.set(normalized, { expiresAt: Date.now() + 60_000, result: null });
      return null;
    }
    const airlineCode = route?.airline?.iata?.toUpperCase() || "";
    const result: FlightLookupResult = {
      found: true,
      flightNumber: route?.callsign_iata || normalized,
      airline: route?.airline?.name || airlineCode || normalized.split(" ")[0],
      originAirportCode,
      destinationAirportCode,
      arrivalTerminal: chicagoArrivalTerminals[destinationAirportCode]?.[airlineCode] || null,
    };
    flightLookupCache.set(normalized, { expiresAt: Date.now() + 5 * 60_000, result });
    return result;
  } catch {
    flightLookupCache.set(normalized, { expiresAt: Date.now() + 60_000, result: null });
    return null;
  }
};

app.post("/api/webhooks/twilio/status", webhookLimiter, async (req, res) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const callbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
  const suppliedSignature = req.header("x-twilio-signature") || "";
  if (!authToken || !callbackUrl) return res.status(503).json({ error: "Twilio status callbacks are not enabled." });
  const signaturePayload = Object.keys(req.body || {}).sort().reduce((value, key) => `${value}${key}${String(req.body[key])}`, callbackUrl);
  const expectedSignature = crypto.createHmac("sha1", authToken).update(signaturePayload).digest("base64");
  const expectedBuffer = Buffer.from(expectedSignature);
  const suppliedBuffer = Buffer.from(suppliedSignature);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(401).json({ error: "Invalid Twilio status callback." });
  }
  const parsed = z.object({
    MessageSid: z.string().regex(/^SM[0-9a-f]{32}$/i),
    MessageStatus: z.enum(["accepted", "scheduled", "queued", "sending", "sent", "delivered", "undelivered", "failed", "canceled", "read"]),
  }).passthrough().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Twilio status callback." });
  await updateDispatchDeliveryStatus(parsed.data.MessageSid, {
    providerStatus: parsed.data.MessageStatus.toLowerCase(),
    deliveryStatus: parsed.data.MessageStatus.toLowerCase(),
  });
  res.status(204).end();
});

app.get("/api/content", publicReadLimiter, async (_req, res) => res.json(await getPublicContent()));
app.get("/api/stripe/config", publicReadLimiter, async (_req, res) => res.json(await getStripePublicConfig()));
app.post("/api/create-setup-intent", inquiryLimiter, async (req, res) => {
  const parsed = stripeProfileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid name and email before adding a card." });
  try {
    const stripe = await getStripeClient();
    const email = parsed.data.email.toLowerCase();
    const profile = await getStripeCustomerProfile(email);
    let customerId: string | undefined;
    if (profile) {
      const existing = await stripe.customers.retrieve(profile.stripeCustomerId);
      if (!existing.deleted && existing.email?.toLowerCase() === email) {
        customerId = existing.id;
        if (existing.name !== parsed.data.fullName) {
          await stripe.customers.update(existing.id, { name: parsed.data.fullName });
        }
      }
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: parsed.data.fullName,
        email,
        metadata: { source: "allen-limousine-pwa", customer_key: email },
      });
      customerId = customer.id;
    }
    await saveStripeCustomerProfile({ email, fullName: parsed.data.fullName, stripeCustomerId: customerId });
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session",
      payment_method_types: ["card"],
      metadata: { source: "allen-limousine-pwa" },
    });
    const setupToken = crypto.randomBytes(32).toString("base64url");
    await createStripeSetupSession({
      tokenHash: crypto.createHash("sha256").update(setupToken).digest("hex"),
      setupIntentId: setupIntent.id,
      customerId,
      email,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });
    res.json({ clientSecret: setupIntent.client_secret, setupIntentId: setupIntent.id, customerId, setupToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Secure card setup is unavailable.";
    res.status(message === "Stripe is not configured yet." ? 503 : 422).json({ error: message });
  }
});
app.post("/api/finalize-setup-intent", inquiryLimiter, async (req, res) => {
  const parsed = finalizeSetupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid card setup response." });
  try {
    const stripe = await getStripeClient();
    const setupIntent = await stripe.setupIntents.retrieve(parsed.data.setupIntentId, { expand: ["payment_method"] });
    const setupCustomer = typeof setupIntent.customer === "string" ? setupIntent.customer : setupIntent.customer?.id;
    if (setupIntent.status !== "succeeded" || setupCustomer !== parsed.data.customerId || !setupIntent.payment_method) {
      return res.status(409).json({ error: "Card setup has not completed." });
    }
    const paymentMethod = typeof setupIntent.payment_method === "string"
      ? await stripe.paymentMethods.retrieve(setupIntent.payment_method)
      : setupIntent.payment_method;
    if (paymentMethod.type !== "card" || !paymentMethod.card) return res.status(422).json({ error: "A reusable card payment method is required." });
    const setupSession = await consumeStripeSetupSession(
      crypto.createHash("sha256").update(parsed.data.setupToken).digest("hex"),
      { setupIntentId: parsed.data.setupIntentId, customerId: parsed.data.customerId },
    );
    if (!setupSession) return res.status(403).json({ error: "This card setup session has expired or was already completed." });
    await stripe.customers.update(parsed.data.customerId, { invoice_settings: { default_payment_method: paymentMethod.id } });
    const customer = await stripe.customers.retrieve(parsed.data.customerId);
    if (customer.deleted || !customer.email || customer.email.toLowerCase() !== setupSession.email) return res.status(422).json({ error: "The Stripe customer profile is incomplete." });
    res.json({
      customerId: parsed.data.customerId,
      paymentMethodId: paymentMethod.id,
      cardBrand: paymentMethod.card.brand,
      cardLast4: paymentMethod.card.last4,
      cardExpMonth: paymentMethod.card.exp_month,
      cardExpYear: paymentMethod.card.exp_year,
      capability: createPaymentCapability({
        customerId: parsed.data.customerId,
        paymentMethodId: paymentMethod.id,
        email: customer.email.toLowerCase(),
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Card setup could not be finalized.";
    res.status(message === "Stripe is not configured yet." ? 503 : 422).json({ error: message });
  }
});
app.post("/api/create-payment-intent", inquiryLimiter, async (req, res) => {
  const parsed = paymentIntentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payment authorization request." });
  try {
    const inquiry = await getInquiryByBookingRequestId(parsed.data.bookingRequestId);
    if (!inquiry || inquiry.estimatedFareCents == null) return res.status(404).json({ error: "The priced booking could not be found." });
    if (inquiry.trackingTokenHash !== trackingTokenHash(parsed.data.trackingToken)) return res.status(403).json({ error: "This booking finalization token is invalid." });
    if (new Date(inquiry.pickupAt).getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000) {
      return res.status(409).json({ error: "Card holds can only be placed within six days of pickup. Choose a pickup time within that authorization window." });
    }
    const capability = verifyPaymentCapability(parsed.data.capability);
    if (!capability
      || capability.customerId !== parsed.data.customerId
      || capability.paymentMethodId !== parsed.data.paymentMethodId
      || capability.email !== inquiry.email.toLowerCase()) {
      return res.status(403).json({ error: "This saved card is not authorized for the passenger profile." });
    }
    if (inquiry.stripePaymentIntentId) {
      const stripe = await getStripeClient();
      const existing = await stripe.paymentIntents.retrieve(inquiry.stripePaymentIntentId);
      await updateInquiryPaymentStatusByIntent(existing.id, existing.status);
      if (!["canceled", "requires_payment_method"].includes(existing.status)) {
        if (existing.status === "requires_capture") {
          const activation = await activateAuthorizedBooking(parsed.data.bookingRequestId, parsed.data.trackingToken, inquiry.pickupAt, existing.id);
          if (activation?.activatedNow) void sendBookingTrackingSms(req, inquiry, parsed.data.trackingToken)
            .catch(error => console.warn("Booking authorized, but confirmation SMS outcome could not be confirmed:", error instanceof Error ? error.message : error));
        }
        return res.json({ paymentIntentId: existing.id, status: existing.status, amount: existing.amount, trackingToken: parsed.data.trackingToken });
      }
    }
    const stripe = await getStripeClient();
    const paymentMethod = await stripe.paymentMethods.retrieve(parsed.data.paymentMethodId);
    const methodCustomer = typeof paymentMethod.customer === "string" ? paymentMethod.customer : paymentMethod.customer?.id;
    if (methodCustomer !== parsed.data.customerId) return res.status(403).json({ error: "That card does not belong to this passenger profile." });
    const priorIntentId = inquiry.stripePaymentIntentId || "initial";
    const intent = await stripe.paymentIntents.create({
      amount: inquiry.estimatedFareCents,
      currency: "usd",
      customer: parsed.data.customerId,
      payment_method: parsed.data.paymentMethodId,
      capture_method: "manual",
      confirm: true,
      off_session: true,
      description: `Allen Limousine booking ${inquiry.id}`,
      metadata: { inquiryId: inquiry.id, bookingRequestId: parsed.data.bookingRequestId },
    }, { idempotencyKey: `booking-auth-${parsed.data.bookingRequestId}-${priorIntentId}` });
    await updateInquiryPayment(parsed.data.bookingRequestId, {
      stripeCustomerId: parsed.data.customerId,
      stripePaymentMethodId: parsed.data.paymentMethodId,
      stripePaymentIntentId: intent.id,
      paymentStatus: intent.status,
    });
    if (intent.status !== "requires_capture") throw new Error("The card authorization hold was not completed.");
    const activation = await activateAuthorizedBooking(parsed.data.bookingRequestId, parsed.data.trackingToken, inquiry.pickupAt, intent.id);
    if (activation?.activatedNow) void sendBookingTrackingSms(req, inquiry, parsed.data.trackingToken)
      .catch(error => console.warn("Booking authorized, but confirmation SMS outcome could not be confirmed:", error instanceof Error ? error.message : error));
    res.json({ paymentIntentId: intent.id, status: intent.status, amount: intent.amount, trackingToken: parsed.data.trackingToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Card authorization was unsuccessful.";
    res.status(message === "Stripe is not configured yet." ? 503 : 402).json({ error: message });
  }
});
const verifyPaymentMethodAccess = (data: z.infer<typeof paymentMethodAccessSchema>) => {
  const capability = verifyPaymentCapability(data.capability);
  return capability
    && capability.customerId === data.customerId
    && capability.email === data.email.toLowerCase()
    ? capability
    : null;
};
app.post("/api/payment-methods/list", inquiryLimiter, async (req, res) => {
  const parsed = paymentMethodAccessSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid wallet access." });
  if (!verifyPaymentMethodAccess(parsed.data)) return res.status(403).json({ error: "This wallet session is no longer authorized." });
  try {
    const stripe = await getStripeClient();
    const customer = await stripe.customers.retrieve(parsed.data.customerId);
    if (customer.deleted) return res.status(404).json({ error: "The payment profile is no longer available." });
    const defaultPaymentMethod = typeof customer.invoice_settings.default_payment_method === "string"
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings.default_payment_method?.id;
    const methods = await stripe.paymentMethods.list({ customer: parsed.data.customerId, type: "card" });
    res.json({
      cards: methods.data.filter(method => method.card).map(method => ({
        paymentMethodId: method.id,
        brand: method.card!.brand,
        last4: method.card!.last4,
        expMonth: method.card!.exp_month,
        expYear: method.card!.exp_year,
        isDefault: method.id === defaultPaymentMethod,
      })),
    });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Saved cards could not be loaded." });
  }
});
app.post("/api/payment-methods/delete", inquiryLimiter, async (req, res) => {
  const parsed = deletePaymentMethodSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid card removal request." });
  if (!verifyPaymentMethodAccess(parsed.data)) return res.status(403).json({ error: "This wallet session is no longer authorized." });
  try {
    const stripe = await getStripeClient();
    const paymentMethod = await stripe.paymentMethods.retrieve(parsed.data.paymentMethodId);
    const methodCustomer = typeof paymentMethod.customer === "string" ? paymentMethod.customer : paymentMethod.customer?.id;
    if (methodCustomer !== parsed.data.customerId) return res.status(403).json({ error: "That card does not belong to this wallet." });
    await stripe.paymentMethods.detach(parsed.data.paymentMethodId);
    res.json({ removed: parsed.data.paymentMethodId });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "That card could not be removed." });
  }
});
app.post("/api/admin/payments/:bookingRequestId/capture", admin, async (req, res) => {
  try {
    const bookingRequestId = Array.isArray(req.params.bookingRequestId) ? req.params.bookingRequestId[0] : req.params.bookingRequestId;
    const intent = await captureAuthorizedPayment(bookingRequestId);
    res.json({ paymentIntentId: intent.id, status: intent.status, amountReceived: intent.amount_received });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "The authorization could not be captured." });
  }
});
app.post("/api/admin/payments/:bookingRequestId/cancel", admin, async (req, res) => {
  try {
    const bookingRequestId = Array.isArray(req.params.bookingRequestId) ? req.params.bookingRequestId[0] : req.params.bookingRequestId;
    const inquiry = await getInquiryByBookingRequestId(bookingRequestId);
    if (!inquiry?.stripePaymentIntentId) return res.status(404).json({ error: "No card authorization exists for this booking." });
    const intent = await cancelAuthorizedPayment(bookingRequestId);
    const ride = await getRideByInquiryId(inquiry.id);
    if (ride && ride.status !== "CANCELLED") await updateRide(ride.id, { status: "CANCELLED" });
    else if (!ride && inquiry.status !== "CANCELLED") await updateInquiry(inquiry.id, { status: "CANCELLED" });
    res.json({ paymentIntentId: intent.id, status: intent.status });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "The authorization could not be cancelled." });
  }
});
const calculateFareHandler = async (req: express.Request, res: express.Response) => {
  const parsed = fareEstimateSchema.safeParse({
    pickup: req.query.pickup,
    destination: req.query.destination,
    tier: req.query.tier,
    pickupLat: req.query.pickupLat,
    pickupLon: req.query.pickupLon,
    destinationLat: req.query.destinationLat,
    destinationLon: req.query.destinationLon,
    isPrivateFBO: req.query.isPrivateFBO,
  });
  if (!parsed.success) return res.status(400).json({ error: "Enter both pickup and drop-off points to estimate the fare." });
  try {
    const pickupCoordinates = parsed.data.pickupLat !== undefined && parsed.data.pickupLon !== undefined
      ? { latitude: parsed.data.pickupLat, longitude: parsed.data.pickupLon }
      : undefined;
    const destinationCoordinates = parsed.data.destinationLat !== undefined && parsed.data.destinationLon !== undefined
      ? { latitude: parsed.data.destinationLat, longitude: parsed.data.destinationLon }
      : undefined;
    res.json(await estimateFare(parsed.data.pickup, parsed.data.destination, parsed.data.tier, {
      pickup: pickupCoordinates,
      destination: destinationCoordinates,
    }, parsed.data.isPrivateFBO));
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "We couldn’t calculate the fare for those locations." });
  }
};
app.get("/api/fare/calculate", publicReadLimiter, calculateFareHandler);
app.get("/api/fare-estimate", publicReadLimiter, calculateFareHandler);
app.get("/api/reverse-geocode", publicReadLimiter, async (req, res) => {
  const parsed = coordinatesSchema.safeParse({ lat: req.query.lat, lon: req.query.lon });
  if (!parsed.success) return res.status(400).json({ error: "A valid location is required." });
  try {
    res.json({ address: await reverseGeocode(parsed.data.lat, parsed.data.lon) });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "We couldn’t identify your current location." });
  }
});
app.get("/api/location-search", publicReadLimiter, async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 3) return res.json({ locations: [] });
  try {
    res.json({ locations: await searchLocations(query) });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Location suggestions are temporarily unavailable." });
  }
});
app.get("/api/flight-lookup", publicReadLimiter, async (req, res) => {
  const parsed = flightLookupSchema.safeParse({ flightNumber: String(req.query.flightNumber || "") });
  if (!parsed.success) return res.status(400).json({ found: false });
  const result = await getFlightLookup(parsed.data.flightNumber);
  res.json(result ? result : { found: false });
});
app.post("/api/inquiries", inquiryLimiter, async (req, res) => {
  const parsed = inquirySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check the highlighted fields and try again.", fields: parsed.error.flatten().fieldErrors });
  if (parsed.data.isPrivateFBO && (!parsed.data.specificTailNumber || !parsed.data.principalName || !parsed.data.fboName || !parsed.data.tarmacInstructions)) {
    return res.status(400).json({ error: "Complete all private aviation coordination fields before booking." });
  }
  if (new Date(parsed.data.pickupAt).getTime() > Date.now() + 6 * 24 * 60 * 60 * 1000) {
    return res.status(409).json({ error: "Card authorization holds can only be placed within six days of pickup." });
  }
  const {
    pickupLatitude: _pickupLatitude,
    pickupLongitude: _pickupLongitude,
    destinationLatitude: _destinationLatitude,
    destinationLongitude: _destinationLongitude,
    estimatedFareCents: _estimatedFareCents,
    estimatedMiles: _estimatedMiles,
    estimatedMinutes: _estimatedMinutes,
    promoDiscountCents: _promoDiscountCents,
    ...rawInput
  } = parsed.data;
  try {
    const input = { ...rawInput, email: rawInput.email.toLowerCase(), phone: normalizeCustomerPhone(rawInput.phone) };
    const bookingRequestFingerprint = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const priorRequest = await getInquiryByBookingRequestId(input.bookingRequestId);
    if (priorRequest) {
      if (priorRequest.bookingRequestFingerprint !== bookingRequestFingerprint) return res.status(409).json({ error: "This booking request was already used for different trip details." });
      return res.status(200).json({ ok: true, inquiry: { id: priorRequest.id, estimatedFareCents: priorRequest.estimatedFareCents, promoCode: priorRequest.promoCode, promoDiscountCents: priorRequest.promoDiscountCents }, smsNotification: "not_repeated" });
    }
    const canonicalEstimate = input.rateTier ? await estimateFare(input.pickup, input.destination, input.rateTier, {}, input.isPrivateFBO) : null;
    const trackingToken = crypto.randomBytes(32).toString("hex");
    const pickupExpiry = new Date(input.pickupAt).getTime() + 24 * 60 * 60 * 1000;
    const trackingExpiresAt = new Date(Math.min(Math.max(pickupExpiry, Date.now() + 24 * 60 * 60 * 1000), Date.now() + 30 * 24 * 60 * 60 * 1000));
    const { inquiry, created } = await addInquiry({
      ...input,
      bookingRequestFingerprint,
      estimatedFareCents: canonicalEstimate?.fareCents,
      grossFareCents: canonicalEstimate?.fareCents,
      estimatedMiles: canonicalEstimate?.miles,
      estimatedMinutes: canonicalEstimate?.minutes,
      promoDiscountCents: undefined,
      paymentStatus: "authorization_pending",
      trackingTokenHash: trackingTokenHash(trackingToken),
      trackingExpiresAt: trackingExpiresAt.toISOString(),
    });
    if (!created && inquiry.bookingRequestFingerprint !== bookingRequestFingerprint) {
      return res.status(409).json({ error: "This booking request was already used for different trip details." });
    }
    res.status(created ? 201 : 200).json({
      ok: true,
      inquiry: { id: inquiry.id, estimatedFareCents: inquiry.estimatedFareCents, promoCode: inquiry.promoCode, promoDiscountCents: inquiry.promoDiscountCents },
      trackingToken: created ? trackingToken : undefined,
      smsNotification: "pending_payment",
    });
  } catch (error) {
    const replay = parsed.data.bookingRequestId ? await getInquiryByBookingRequestId(parsed.data.bookingRequestId) : null;
    if (replay) {
      const {
        pickupLatitude: _a,
        pickupLongitude: _b,
        destinationLatitude: _c,
        destinationLongitude: _d,
        estimatedFareCents: _e,
        estimatedMiles: _f,
        estimatedMinutes: _g,
        promoDiscountCents: _h,
        ...rawReplayInput
      } = parsed.data;
      let normalizedReplayInput;
      try {
        normalizedReplayInput = { ...rawReplayInput, email: rawReplayInput.email.toLowerCase(), phone: normalizeCustomerPhone(rawReplayInput.phone) };
      } catch {
        return res.status(422).json({ error: "Enter a valid passenger phone number." });
      }
      const fingerprint = crypto.createHash("sha256").update(JSON.stringify(normalizedReplayInput)).digest("hex");
      if (replay.bookingRequestFingerprint !== fingerprint) return res.status(409).json({ error: "This booking request was already used for different trip details." });
      return res.status(200).json({ ok: true, inquiry: { id: replay.id, estimatedFareCents: replay.estimatedFareCents, promoCode: replay.promoCode, promoDiscountCents: replay.promoDiscountCents }, smsNotification: "not_repeated" });
    }
    res.status(422).json({ error: error instanceof Error ? error.message : "We couldn’t confirm the route and fare." });
  }
});
app.get("/api/tracking/:token", publicReadLimiter, async (req, res) => {
  const parsed = z.string().regex(/^[a-f0-9]{64}$/).safeParse(req.params.token);
  const inquiry = parsed.success ? await getInquiryByTrackingTokenHash(trackingTokenHash(parsed.data)) : null;
  if (inquiry?.status === "PAYMENT_PENDING") return res.status(404).json({ error: "Booking not found." });
  if (!inquiry || !inquiry.trackingExpiresAt || new Date(inquiry.trackingExpiresAt) <= new Date()) return res.status(404).json({ error: "Reservation tracking is unavailable." });
  const ride = await getRideByInquiryId(inquiry.id);
  res.json({
    reservation: {
      inquiryId: inquiry.id,
      reference: inquiry.id.slice(-6).toUpperCase(),
      status: ride?.status || inquiry.status,
      pickupAt: inquiry.pickupAt,
      pickup: inquiry.pickup,
      destination: inquiry.destination,
      fareCents: inquiry.estimatedFareCents,
      flightNumber: inquiry.flightNumber,
      vehicle: ride?.vehicle?.name || null,
      driverName: ride?.driverName || null,
      driverPhone: ride?.driverPhone || null,
      driverLatitude: ride?.driverLatitude ?? null,
      driverLongitude: ride?.driverLongitude ?? null,
      driverHeading: ride?.driverHeading ?? null,
      locationUpdatedAt: ride?.locationUpdatedAt || null,
      updatedAt: ride?.updatedAt || inquiry.updatedAt,
       pickupLatitude: null,
       pickupLongitude: null,
       destinationLatitude: null,
       destinationLongitude: null,
    },
  });
});
app.post("/api/admin/login", async (req, res) => {
  const parsed = authSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid email and password." });
  const result = await authenticate(parsed.data.email, parsed.data.password);
  if (!result) return res.status(401).json({ error: "That email and password combination was not recognized." });
  res.cookie("allan_session", result.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 12 });
  res.json({ user: result.user });
});
app.get("/api/admin/session", admin, (_req, res) => res.json({ user: res.locals.user }));
app.post("/api/admin/logout", (req, res) => { logout(req.cookies.allan_session); res.clearCookie("allan_session"); res.status(204).end(); });
app.get("/api/admin/dashboard", admin, async (_req, res) => res.json(await dashboardData()));
app.get("/api/admin/rides", admin, async (req, res) => {
  const status = String(req.query.status || "ALL");
  const date = req.query.date ? String(req.query.date) : undefined;
  const unassigned = String(req.query.unassigned || "") === "true";
  res.json({ rides: await getRides({ status, date, unassigned }), vehicles: (await getAdminContent()).fleet.filter(vehicle => vehicle.active).map(vehicle => ({ id: vehicle.id, name: vehicle.name, category: vehicle.category, description: vehicle.description, passengers: vehicle.passengers, luggage: vehicle.luggage, defaultDriverName: vehicle.defaultDriverName, defaultDriverPhone: vehicle.defaultDriverPhone })) });
});
app.patch("/api/admin/rides/:id", admin, async (req, res) => {
  const parsed = rideUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid ride update." });
  const { quote, deposit, collected, expense, driverPhone, ...rest } = parsed.data;
  try {
    const locationChanged = rest.driverLatitude !== undefined || rest.driverLongitude !== undefined;
    const rideData = { ...rest, ...(locationChanged ? { locationUpdatedAt: rest.driverLatitude === null ? null : new Date().toISOString() } : {}), ...(driverPhone !== undefined ? { driverPhone: normalizePhone(driverPhone) } : {}), ...(quote !== undefined ? { quoteCents: quote } : {}), ...(deposit !== undefined ? { depositCents: deposit } : {}), ...(collected !== undefined ? { collectedCents: collected } : {}), ...(expense !== undefined ? { expenseCents: expense } : {}) };
    const { status, ...preCompletionUpdate } = rideData;
    let item;
    if (status === "COMPLETED") item = await completeRideWithCapture(String(req.params.id), preCompletionUpdate);
    else {
      if (status === "CANCELLED") {
        const currentRide = await getRideById(String(req.params.id));
        if (!currentRide) return res.status(404).json({ error: "Ride not found." });
        await validateRideUpdate(currentRide.id, rideData);
        if (currentRide.inquiry.bookingRequestId && currentRide.inquiry.stripePaymentIntentId) await cancelAuthorizedPayment(currentRide.inquiry.bookingRequestId);
        item = await updateRide(currentRide.id, rideData);
      } else {
        item = await updateRide(String(req.params.id), rideData);
      }
    }
    if (!item) return res.status(404).json({ error: "Ride not found." });
    res.json({ ride: item });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Invalid ride update." });
  }
});
app.get("/api/admin/rides/:id/dispatch-brief", admin, async (req, res) => {
  const ride = await getRideById(String(req.params.id));
  if (!ride) return res.status(404).json({ error: "Ride not found." });
  res.json({ brief: dispatchBrief(ride), driverPhone: ride.driverPhone, ready: Boolean(ride.vehicleId && ride.driverName && ride.driverPhone), recentMessages: ride.dispatchMessages });
});
app.post("/api/admin/rides/:id/dispatch/:attemptId/reconcile", admin, dispatchLimiter, async (req, res) => {
  const attempt = await getDispatchAttempt(String(req.params.id), String(req.params.attemptId));
  if (!attempt) return res.status(404).json({ error: "Dispatch attempt not found." });
  if (attempt.status !== "PENDING") return res.status(409).json({ error: "This dispatch attempt has already been reconciled.", activity: attempt });
  const parsed = z.object({ providerMessageId: z.string().trim().regex(/^SM[0-9a-f]{32}$/i).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the Twilio message SID that begins with SM." });
  const providerMessageId = parsed.data.providerMessageId || attempt.providerMessageId;
  if (!providerMessageId) return res.status(400).json({ code: "MISSING_PROVIDER_ID", error: "Enter the Twilio message SID from the original send attempt. No new SMS will be sent." });

  let provider;
  try {
    provider = await getDriverDispatchSms(providerMessageId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Twilio could not verify this message.";
    return res.status(502).json({ status: "PENDING_RECONCILIATION", error: `${detail} The ride remains blocked from resending.` });
  }
  if (provider.toPhone !== attempt.toPhone || provider.body !== attempt.body) {
    return res.status(409).json({
      status: "PENDING_RECONCILIATION",
      error: "That Twilio SID belongs to a different destination or message. The original attempt remains blocked.",
    });
  }
  const boundAttempt = await getDispatchAttemptByProviderMessageId(provider.providerMessageId);
  if (boundAttempt && boundAttempt.id !== attempt.id) {
    return res.status(409).json({
      status: "PENDING_RECONCILIATION",
      error: "That Twilio SID is already attached to another dispatch. The original attempt remains blocked.",
    });
  }

  const providerOutcome = classifyTwilioMessageStatus(provider.providerStatus);
  if (providerOutcome === "PENDING") {
    let activity;
    try {
      activity = await updateDispatchProviderStatus(attempt.id, {
        providerMessageId: provider.providerMessageId,
        providerStatus: provider.providerStatus,
        deliveryStatus: provider.providerStatus,
      });
    } catch {
      return res.status(409).json({ status: "PENDING_RECONCILIATION", error: "That Twilio SID was attached elsewhere while reconciling. This attempt remains blocked." });
    }
    return res.status(409).json({
      code: "PROVIDER_PENDING",
      status: "PENDING_RECONCILIATION",
      providerStatus: provider.providerStatus,
      activity,
      error: `Twilio reports “${provider.providerStatus}”. The attempt remains blocked until Twilio confirms an accepted or failed outcome.`,
    });
  }

  const errorMessage = providerOutcome === "FAILED"
    ? provider.errorMessage || `Twilio reported ${provider.providerStatus}${provider.errorCode ? ` (${provider.errorCode})` : ""}.`
    : null;
  let activity;
  try {
    activity = await reconcileDispatchAttempt(String(req.params.id), attempt.id, {
      status: providerOutcome,
      providerMessageId: provider.providerMessageId,
      providerStatus: provider.providerStatus,
      deliveryStatus: provider.providerStatus,
      errorMessage,
      reconciledById: res.locals.user.id,
      reconciledByName: res.locals.user.name,
    });
  } catch {
    return res.status(409).json({ status: "PENDING_RECONCILIATION", error: "That Twilio SID was attached elsewhere while reconciling. This attempt remains blocked." });
  }
  if (!activity) return res.status(409).json({ error: "This dispatch attempt was reconciled by another administrator. Refresh the ride to see the result." });
  res.json({ status: providerOutcome, providerStatus: provider.providerStatus, activity });
});
app.post("/api/admin/rides/:id/dispatch", admin, dispatchLimiter, async (req, res) => {
  const ride = await getRideById(String(req.params.id));
  if (!ride) return res.status(404).json({ error: "Ride not found." });
  if (!ride.driverPhone) return res.status(400).json({ code: "MISSING_PHONE", error: "Add a driver phone number before sending the dispatch brief." });
  if (ride.inquiry.paymentStatus === "canceled") return res.status(409).json({ code: "PAYMENT_CANCELLED", error: "This booking’s card authorization was cancelled. Create a new authorization before dispatching it." });
  if (["COMPLETED", "CANCELLED"].includes(ride.status)) return res.status(409).json({ code: "RIDE_NOT_ACTIVE", error: "Dispatch messages cannot be sent for completed or cancelled rides." });
  if (!ride.vehicleId || !ride.vehicle?.active || !ride.driverName) return res.status(400).json({ code: "INCOMPLETE_ASSIGNMENT", error: "Assign an active vehicle and chauffeur before sending the dispatch brief." });
  const parsed = z.object({ message: z.string().trim().min(20).max(1600).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "The dispatch message must be between 20 and 1,600 characters." });
  const message = parsed.data.message || dispatchBrief(ride);
  if (await getPendingDispatchAttempt(ride.id)) return res.status(409).json({ status: "PENDING_RECONCILIATION", error: "A prior dispatch attempt still needs reconciliation. Do not resend this ride yet." });
  let attempt;
  try {
    attempt = await createDispatchAttempt({ rideId: ride.id, adminId: res.locals.user.id, toPhone: ride.driverPhone, body: message });
  } catch (error) {
    if (error instanceof Error && error.message === "PENDING_DISPATCH_EXISTS") return res.status(409).json({ status: "PENDING_RECONCILIATION", error: "A dispatch attempt is already in progress or awaiting reconciliation. Do not resend this ride yet." });
    console.error("Unable to create dispatch attempt:", error);
    return res.status(500).json({ error: "The dispatch attempt could not be started. No SMS was sent." });
  }
  if (!attempt) return res.status(404).json({ error: "Ride not found." });
  let providerMessageId: string | null = null;
  let providerStatus: string | null = null;
  try {
    const result = await sendDriverDispatchSms(ride.driverPhone, message);
    providerMessageId = result.providerMessageId;
    providerStatus = result.providerStatus;
  } catch (error) {
    const providerError = error instanceof Error ? error.message : "The SMS provider could not send this message.";
    if (!(error instanceof TwilioRequestError && error.definitivelyRejected)) {
      console.error("Twilio dispatch outcome is uncertain and remains pending:", error);
      return res.status(502).json({ status: "PENDING_RECONCILIATION", providerMessageId, error: "Twilio may have accepted this SMS, but its outcome could not be confirmed. Do not resend until the attempt is reconciled." });
    }
    try {
      const activity = await finishDispatchAttempt(attempt.id, { status: "FAILED", errorMessage: providerError });
      return res.status(502).json({ status: "FAILED", error: providerError, activity });
    } catch (auditError) {
      console.error("Unable to record failed dispatch attempt:", auditError);
      return res.status(502).json({ status: "PENDING_RECONCILIATION", error: `${providerError} The attempt remains pending and must be reconciled before resending.` });
    }
  }
  try {
    const activity = await finishDispatchAttempt(attempt.id, { status: "SENT", providerMessageId, providerStatus, deliveryStatus: providerStatus });
    return res.json({ status: "SENT", activity });
  } catch (auditError) {
    console.error("Twilio accepted a dispatch SMS, but its activity record failed:", auditError);
    return res.status(500).json({ status: "PENDING_RECONCILIATION", providerMessageId, error: "Twilio accepted this SMS, but its activity record remains pending. Do not resend until delivery is reconciled." });
  }
});
app.get("/api/admin/notifications", admin, async (req, res) => res.json({ notifications: await getNotifications(String(req.query.unread || "") === "true") }));
app.patch("/api/admin/notifications/:id/read", admin, async (req, res) => {
  const notification = await markNotificationRead(String(req.params.id));
  if (!notification) return res.status(404).json({ error: "Notification not found." });
  res.json({ notification });
});
app.get("/api/admin/inquiries", admin, async (req, res) => {
  const q = String(req.query.q || "").toLowerCase();
  const status = String(req.query.status || "ALL");
  const result = (await getInquiries()).filter(i => (!q || [i.fullName, i.email, i.serviceType, i.pickup, i.destination].join(" ").toLowerCase().includes(q)) && (status === "ALL" || i.status === status));
  res.json({ inquiries: result });
});
app.patch("/api/admin/inquiries/:id", admin, async (req, res) => {
  const parsed = z.object({ status: z.enum(["NEW", "CONTACTED", "CONFIRMED", "COMPLETED", "CANCELLED"]).optional(), notes: z.string().max(1000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid inquiry update." });
  if (parsed.data.status === "COMPLETED") {
    const inquiry = (await getInquiries()).find(item => item.id === String(req.params.id));
    if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });
    if (parsed.data.notes !== undefined) await updateInquiry(inquiry.id, { notes: parsed.data.notes });
    const ride = await getRideByInquiryId(inquiry.id);
    if (!ride) return res.status(409).json({ error: "Assign this inquiry to dispatch before completing it." });
    try {
      await completeRideWithCapture(ride.id);
    } catch (error) {
      return res.status(422).json({ error: error instanceof Error ? error.message : "Payment capture failed." });
    }
    const item = (await getInquiries()).find(value => value.id === inquiry.id);
    return res.json({ inquiry: item });
  }
  if (parsed.data.status === "CANCELLED") {
    const inquiry = (await getInquiries()).find(item => item.id === String(req.params.id));
    if (!inquiry) return res.status(404).json({ error: "Inquiry not found." });
    try {
      if (inquiry.bookingRequestId && inquiry.stripePaymentIntentId) await cancelAuthorizedPayment(inquiry.bookingRequestId);
      const ride = await getRideByInquiryId(inquiry.id);
      if (ride) await updateRide(ride.id, { status: "CANCELLED" });
      else await updateInquiry(inquiry.id, parsed.data);
      const item = (await getInquiries()).find(value => value.id === inquiry.id);
      return res.json({ inquiry: item });
    } catch (error) {
      return res.status(422).json({ error: error instanceof Error ? error.message : "The authorization could not be released." });
    }
  }
  const item = await updateInquiry(String(req.params.id), parsed.data);
  if (!item) return res.status(404).json({ error: "Inquiry not found." });
  res.json({ inquiry: item });
});
app.post("/api/admin/inquiries/:id/notes", admin, async (req, res) => {
  const body = z.string().trim().min(1).max(1000).safeParse(req.body.body);
  if (!body.success) return res.status(400).json({ error: "Note cannot be empty." });
  const item = await addInquiryNote(String(req.params.id), body.data, res.locals.user.id);
  if (!item) return res.status(404).json({ error: "Inquiry not found." });
  res.json({ inquiry: item });
});
app.get("/api/admin/content", admin, async (_req, res) => res.json(await getAdminContent()));
app.patch("/api/admin/content/site", admin, async (req, res) => {
  const parsed = z.object({ heroKicker: z.string().max(80), heroTitle: z.string().max(150), heroDescription: z.string().max(300), standardTitle: z.string().max(200), standardBody: z.string().max(500) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check the content fields." });
  res.json({ siteContent: await updateSiteContent(parsed.data) });
});
app.patch("/api/admin/content/services/:id", admin, async (req, res) => {
  const parsed = z.object({ title: z.string().min(2).max(100), description: z.string().min(2).max(500), active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check the service fields." });
  const item = await updateService(String(req.params.id), parsed.data);
  if (!item) return res.status(404).json({ error: "Service not found." });
  res.json({ service: item });
});
app.post("/api/admin/content/services", admin, async (req, res) => {
  const parsed = z.object({ slug: z.string().regex(/^[a-z0-9-]+$/), title: z.string().min(2), eyebrow: z.string().min(2), description: z.string().min(2), imageUrl: z.string().url(), active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every service field." });
  res.status(201).json({ service: await createService(parsed.data) });
});
app.delete("/api/admin/content/services/:id", admin, async (req, res) => {
  await deleteService(String(req.params.id)); res.status(204).end();
});
app.patch("/api/admin/content/fleet/:id", admin, async (req, res) => {
  const parsed = z.object({ name: z.string().min(2).max(100), description: z.string().min(2).max(500), active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please check the vehicle fields." });
  const item = await updateFleet(String(req.params.id), parsed.data);
  if (!item) return res.status(404).json({ error: "Vehicle not found." });
  res.json({ fleet: item });
});
app.post("/api/admin/content/fleet", admin, async (req, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(100), category: z.string().trim().min(2).max(100), description: z.string().trim().min(2).max(500), imageUrl: z.string().url(), passengers: z.string().trim().min(1).max(30), luggage: z.string().trim().min(1).max(30), defaultDriverName: z.string().trim().max(100).nullable().optional(), defaultDriverPhone: z.string().trim().max(30).nullable().optional(), active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete every fleet field." });
  try {
    const defaultDriverPhone = normalizePhone(parsed.data.defaultDriverPhone);
    res.status(201).json({ fleet: await createFleet({ ...parsed.data, defaultDriverName: parsed.data.defaultDriverName || null, defaultDriverPhone }) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Enter a valid driver phone number." });
  }
});
app.delete("/api/admin/content/fleet/:id", admin, async (req, res) => {
  await deleteFleet(String(req.params.id)); res.status(204).end();
});
app.get("/api/admin/users", admin, superAdmin, async (_req, res) => res.json({ users: await listAdmins() }));
app.post("/api/admin/users", admin, superAdmin, async (req, res) => {
  const parsed = z.object({ email: z.string().email(), name: z.string().min(2).max(100), password: z.string().min(12).max(200), role: z.enum(["SUPER_ADMIN", "ADMIN"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Use a valid email and a password of at least 12 characters." });
  res.status(201).json({ user: await createAdmin(parsed.data) });
});
app.patch("/api/admin/users/:id", admin, superAdmin, async (req, res) => {
  if (String(req.params.id) === res.locals.user.id && req.body.active === false) return res.status(400).json({ error: "You cannot disable your own account." });
  const parsed = z.object({ active: z.boolean().optional(), role: z.enum(["SUPER_ADMIN", "ADMIN"]).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid administrator update." });
  const updated = await updateAdmin(String(req.params.id), parsed.data);
  if (!updated) return res.status(404).json({ error: "Administrator not found." });
  if (updated === "LAST_SUPER_ADMIN") return res.status(409).json({ error: "At least one active super-admin is required." });
  res.json({ user: updated });
});
app.get("/api/admin/export.csv", admin, async (_req, res) => {
  const headers = ["Name", "Email", "Phone", "Service", "Pickup date", "Pickup", "Destination", "Passengers", "Status", "Created"];
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const rows = (await getInquiries()).map(i => [i.fullName, i.email, i.phone, i.serviceType, i.pickupAt, i.pickup, i.destination, i.passengers, i.status, i.createdAt].map(escape).join(","));
  res.type("text/csv").set("Content-Disposition", "attachment; filename=allan-inquiries.csv").send([headers.map(escape).join(","), ...rows].join("\n"));
});

let storeReady: Promise<void> | null = null;
export async function prepareApp() {
  storeReady ??= initializeStore();
  await storeReady;
}

async function start() {
  await prepareApp();
  if (process.env.NODE_ENV === "production") {
    const dist = path.resolve(__dirname, "../dist");
    app.use(express.static(dist, {
      maxAge: "1h",
      setHeaders: (res, filePath) => {
        const fileName = path.basename(filePath);
        if (fileName === "index.html" || fileName === "sw.js") {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (fileName === "manifest.json") {
          res.setHeader("Cache-Control", "no-cache");
        } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }));
    app.get("*splat", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(path.join(dist, "index.html"));
    });
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true, ws: { clientPort: 443 } },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }
  app.listen(port, "0.0.0.0", () => console.log(`ALLAN Livery listening on 0.0.0.0:${port}`));
}

if (!process.env.VERCEL) {
  start().catch(error => {
    console.error("Unable to start ALLAN Livery:", error);
    process.exit(1);
  });
}