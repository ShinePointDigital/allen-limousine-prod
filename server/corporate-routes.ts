import express, { type Request, type RequestHandler } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { accountLoginLimiter, staffGuard } from "./account-routes.js";
import { authenticate, logout, sessionUser } from "./store.js";
import { estimateFare } from "./fare-estimate.js";
import { getStripePublicConfig } from "./stripe-client.js";
import { CorporateError, CorporateService, accountView, corporateBookingView, readCorporateQuote, signCorporateQuote } from "./corporate-service.js";
import { corporateApplicationSchema, corporateTripSchema } from "../shared/corporate.js";
import { validateIntent } from "./corporate-billing.js";

export function createCorporateRouter({ origin, service = new CorporateService(), estimate = estimateFare, admin = staffGuard }: {
  origin: (req: Request) => string; service?: CorporateService; estimate?: typeof estimateFare; admin?: RequestHandler;
}) {
  const router = express.Router();
  const applicationLimit = rateLimit({ windowMs: 3600000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
  const quoteLimit = rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
  const run = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      if (error instanceof CorporateError) return void res.status(error.status).json({ error: error.message });
      const code = (error as { code?: string }).code;
      if (code === "P2002") return void res.status(409).json({ error: "This application or booking already exists. Reopen it instead of creating a duplicate." });
      if (code === "P2034") return void res.status(409).json({ error: "The account changed concurrently. Refresh and retry the same action." });
      res.status(503).json({ error: "The corporate service could not complete this action. Retry the same request or contact dispatch." });
    }
  };
  router.use(["/api/corporate", "/api/admin/corporate"], (req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.header("sec-fetch-site") === "cross-site") return res.status(403).json({ error: "Cross-site changes are not allowed." });
      const supplied = req.header("origin");
      if (supplied) {
        try {
          const host = `${req.protocol}://${req.get("host")}`;
          if (![new URL(origin(req)).origin, new URL(host).origin].includes(new URL(supplied).origin)) return res.status(403).json({ error: "Invalid request origin." });
        } catch { return res.status(403).json({ error: "Invalid request origin." }); }
      }
    }
    next();
  });
  const customer: RequestHandler = run(async (req, res, next) => {
    const user = await sessionUser(req.cookies?.allan_customer_session);
    if (!user || user.role !== "USER") throw new CorporateError(401, "Sign in to your corporate account.");
    res.locals.customer = user;
    res.locals.corporate = await service.account(user.id);
    next();
  });
  const ready: RequestHandler = (_req, res, next) => {
    if (res.locals.corporate.mustChangePassword) return res.status(403).json({ error: "Replace your temporary password before booking or managing billing." });
    next();
  };
  const applicantInput = z.object({ applicationToken: z.string().regex(/^[a-f0-9]{64}$/), sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/).optional() }).strict();
  router.post("/api/corporate/applications", applicationLimit, run(async (req, res) => {
    const parsed = corporateApplicationSchema.safeParse(req.body);
    if (!parsed.success) throw new CorporateError(400, "Complete the company/contact/billing details and authorize per-ride billing. Do not send raw card details.");
    res.status(201).json(await service.apply(parsed.data));
  }));
  router.post("/api/corporate/applications/:id/payment-setup", applicationLimit, run(async (req, res) => {
    const parsed = applicantInput.safeParse(req.body);
    if (!parsed.success) throw new CorporateError(400, "A valid application access token is required.");
    const a = await service.applicant(String(req.params.id), parsed.data.applicationToken);
    res.json(await service.setup(a, origin(req), true));
  }));
  router.post("/api/corporate/applications/:id/payment-confirm", applicationLimit, run(async (req, res) => {
    const parsed = applicantInput.safeParse(req.body);
    if (!parsed.success || !parsed.data.sessionId) throw new CorporateError(400, "A valid application token and Stripe setup session are required.");
    const a = await service.applicant(String(req.params.id), parsed.data.applicationToken);
    res.json(await service.confirmPayment(a, parsed.data.sessionId));
  }));
  router.post("/api/corporate/login", accountLoginLimiter, run(async (req, res) => {
    const parsed = z.object({ email: z.string().trim().email().transform(v => v.toLowerCase()), password: z.string().min(1).max(200) }).strict().safeParse(req.body);
    if (!parsed.success) throw new CorporateError(400, "Enter your corporate contact email and password.");
    const result = await authenticate(parsed.data.email, parsed.data.password, "customer");
    if (!result) throw new CorporateError(401, "Your corporate login was not recognized or its temporary access expired.");
    let a;
    try { a = await service.account(result.user.id); }
    catch (error) { await logout(result.token); throw error; }
    await logout(req.cookies?.allan_customer_session);
    res.cookie("allan_customer_session", result.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600000 });
    res.json({ user: result.user, account: accountView(a) });
  }));
  router.get("/api/corporate/session", customer, (_req, res) => res.json({ user: res.locals.customer, account: accountView(res.locals.corporate) }));
  router.post("/api/corporate/logout", run(async (req, res) => {
    await logout(req.cookies?.allan_customer_session);
    res.clearCookie("allan_customer_session", { path: "/" }); res.status(204).end();
  }));
  router.post("/api/corporate/password", accountLoginLimiter, customer, run(async (req, res) => {
    const parsed = z.object({ currentPassword: z.string().min(1).max(200), password: z.string().min(12).max(200) }).strict().safeParse(req.body);
    if (!parsed.success || parsed.data.password === parsed.data.currentPassword) throw new CorporateError(400, "Choose a different password with at least 12 characters.");
    const newHash = await bcrypt.hash(parsed.data.password, 12);
    await service.db.$transaction(async db => {
      const user = await db.adminUser.findUnique({ where: { id: res.locals.customer.id } });
      if (!user?.active || user.role !== "USER" || !await bcrypt.compare(parsed.data.currentPassword, user.passwordHash)) throw new CorporateError(400, "The current password was not recognized.");
      await db.adminUser.update({ where: { id: user.id }, data: { passwordHash: newHash } });
      await db.corporateAccount.update({ where: { id: res.locals.corporate.id }, data: { mustChangePassword: false, credentialsExpiresAt: null } });
      await db.adminSession.deleteMany({ where: { userId: user.id } });
    }, { isolationLevel: "Serializable" });
    res.clearCookie("allan_customer_session", { path: "/" });
    res.json({ message: "Password updated. Sign in with your permanent password." });
  }));
  router.get("/api/corporate/bookings", customer, ready, run(async (_req, res) => {
    const bookings = await service.db.inquiry.findMany({
      where: { corporateAccountId: res.locals.corporate.id, customerUserId: res.locals.customer.id },
      include: { ride: true }, orderBy: { createdAt: "desc" }, take: 200,
    });
    res.json({ bookings: bookings.map(corporateBookingView) });
  }));
  router.post("/api/corporate/quotes", quoteLimit, customer, ready, run(async (req, res) => {
    const parsed = corporateTripSchema.safeParse(req.body);
    if (!parsed.success) throw new CorporateError(400, "Complete the ride details, required PO number and cost center.");
    if (!res.locals.corporate.stripePaymentMethodId) throw new CorporateError(409, "Save a verified company payment method before booking.");
    if (Date.parse(parsed.data.pickupAt) <= Date.now()) throw new CorporateError(400, "Pickup must be in the future.");
    const capacity = { EXECUTIVE_SEDAN: 3, LUXURY_SUV: 6, SPRINTER_CLASS: 14 };
    if (parsed.data.passengers > capacity[parsed.data.rateTier]) throw new CorporateError(400, "Choose a vehicle class that can accommodate every passenger.");
    const quote = await estimate(parsed.data.pickup, parsed.data.destination, parsed.data.rateTier);
    if (!Number.isSafeInteger(quote.fareCents) || quote.fareCents < 1 || quote.fareCents > 10000000) throw new CorporateError(503, "A valid fare could not be calculated.");
    const quoteToken = signCorporateQuote({ accountId: res.locals.corporate.id, userId: res.locals.customer.id, trip: parsed.data, fareCents: quote.fareCents, expiresAt: Date.now() + 10 * 60000 });
    res.json({ quoteToken, fareCents: quote.fareCents, gratuityCents: 0, totalCents: quote.fareCents });
  }));
  router.post("/api/corporate/bookings", customer, ready, run(async (req, res) => {
    const parsed = z.object({ quoteToken: z.string().min(40).max(16000) }).strict().safeParse(req.body);
    if (!parsed.success) throw new CorporateError(400, "Review the ride quote first.");
    const quote = readCorporateQuote(parsed.data.quoteToken);
    if (!corporateTripSchema.safeParse(quote.trip).success) throw new CorporateError(400, "The reviewed ride is invalid.");
    res.status(201).json(await service.book(res.locals.corporate, res.locals.customer.id, parsed.data.quoteToken));
  }));
  router.post("/api/corporate/payment-setup", customer, ready, run(async (req, res) => {
    if (!z.object({ billingConsent: z.literal(true) }).strict().safeParse(req.body).success) throw new CorporateError(400, "Authorize per-ride saved-method billing.");
    res.json(await service.setup(res.locals.corporate, origin(req)));
  }));
  router.post("/api/corporate/payment-confirm", customer, ready, run(async (req, res) => {
    const parsed = z.object({ sessionId: z.string().regex(/^cs_[A-Za-z0-9_]+$/) }).strict().safeParse(req.body);
    if (!parsed.success) throw new CorporateError(400, "A Stripe setup session is required.");
    res.json(await service.confirmPayment(res.locals.corporate, parsed.data.sessionId));
  }));
  router.post("/api/corporate/bookings/:id/payment-action", customer, ready, run(async (req, res) => {
    const b = await service.db.inquiry.findFirst({ where: { id: String(req.params.id), corporateAccountId: res.locals.corporate.id, customerUserId: res.locals.customer.id } });
    if (!b?.stripePaymentIntentId || !b.stripeCustomerId || !b.authorizedTotalCents) throw new CorporateError(404, "No corporate charge is available for this ride.");
    const stripe = await service.stripe(); const intent = await stripe.paymentIntents.retrieve(b.stripePaymentIntentId);
    validateIntent(intent, b.stripeCustomerId, b.authorizedTotalCents, b.id);
    if (intent.status === "succeeded" && intent.amount_received === b.authorizedTotalCents) return void res.json({ alreadyPaid: true });
    if (intent.status !== "requires_action" || !intent.client_secret) throw new CorporateError(409, "This payment does not require bank authentication.");
    const config = await getStripePublicConfig();
    if (!config.configured) throw new CorporateError(503, "Stripe authentication is unavailable.");
    res.json({ clientSecret: intent.client_secret, publishableKey: config.publishableKey });
  }));
  router.post("/api/corporate/bookings/:id/payment-sync", customer, ready, run(async (req, res) => {
    const b = await service.db.inquiry.findFirst({ where: { id: String(req.params.id), corporateAccountId: res.locals.corporate.id, customerUserId: res.locals.customer.id } });
    if (!b?.stripePaymentIntentId || !b.stripeCustomerId || !b.authorizedTotalCents) throw new CorporateError(404, "No corporate charge is available for this ride.");
    const stripe = await service.stripe(); const intent = await stripe.paymentIntents.retrieve(b.stripePaymentIntentId);
    validateIntent(intent, b.stripeCustomerId, b.authorizedTotalCents, b.id);
    if (intent.status !== "succeeded" || intent.amount_received !== b.authorizedTotalCents) throw new CorporateError(409, "The original corporate charge has not succeeded.");
    await service.db.$transaction([
      service.db.inquiry.update({ where: { id: b.id }, data: { paymentStatus: "succeeded" } }),
      service.db.ride.update({ where: { inquiryId: b.id }, data: { collectedCents: b.authorizedTotalCents } }),
    ]);
    res.json({ paymentStatus: "succeeded", message: "The original charge is verified. Dispatch or your chauffeur can now retry completing the ride." });
  }));
  router.get("/api/admin/corporate/accounts", admin, run(async (req, res) => {
    const parsed = z.object({ status: z.enum(["ALL", "PENDING", "ACTIVE", "REJECTED"]).default("PENDING"), cursor: z.string().max(100).optional() }).safeParse(req.query);
    if (!parsed.success) throw new CorporateError(400, "Choose a valid corporate account status.");
    const rows = await service.db.corporateAccount.findMany({
      where: parsed.data.status === "ALL" ? {} : { status: parsed.data.status },
      orderBy: { id: "desc" }, take: 51, ...(parsed.data.cursor ? { cursor: { id: parsed.data.cursor }, skip: 1 } : {}),
    });
    res.json({ accounts: rows.slice(0, 50).map(accountView), nextCursor: rows.length > 50 ? rows[49].id : null });
  }));
  router.post("/api/admin/corporate/accounts/:id/approve", admin, run(async (req, res) => {
    res.json(await service.approve(String(req.params.id), res.locals.user.id, origin(req)));
  }));
  router.post("/api/admin/corporate/accounts/:id/reject", admin, run(async (req, res) => {
    const parsed = z.object({ reason: z.string().trim().min(3).max(1000) }).strict().safeParse(req.body);
    if (!parsed.success) throw new CorporateError(400, "Enter a rejection reason.");
    const result = await service.db.corporateAccount.updateMany({ where: { id: String(req.params.id), status: "PENDING" }, data: { status: "REJECTED", rejectionReason: parsed.data.reason } });
    if (!result.count) throw new CorporateError(409, "Only pending applications can be rejected.");
    res.json({ account: accountView(await service.db.corporateAccount.findUniqueOrThrow({ where: { id: String(req.params.id) } })) });
  }));
  router.post("/api/admin/corporate/accounts/:id/resend", admin, run(async (req, res) => {
    res.json(await service.resend(String(req.params.id), origin(req)));
  }));
  return router;
}
