import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

export type InquiryStatus = "PAYMENT_PENDING" | "NEW" | "CONTACTED" | "CONFIRMED" | "COMPLETED" | "CANCELLED";
export type RideStatus = "UNASSIGNED" | "ASSIGNED" | "EN_ROUTE" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type Inquiry = {
  id: string; fullName: string; email: string; phone: string; serviceType: string;
  pickupAt: string; pickup: string; destination: string; passengers: number;
  notes?: string; airportCode?: string | null; airportTerminal?: string | null;
  flightNumber?: string | null; flightScheduledAt?: string | null; pickupPreference?: string | null;
  isPrivateFBO?: boolean; specificTailNumber?: string | null; principalName?: string | null;
  fboName?: string | null; tarmacInstructions?: string | null;
  rateTier?: string | null; estimatedFareCents?: number | null; estimatedMiles?: number | null;
  estimatedMinutes?: number | null; rideTiming?: string | null;
  promoCode?: string | null; promoDiscountCents?: number | null;
  grossFareCents?: number | null; bookingRequestId?: string | null; bookingRequestFingerprint?: string | null;
  trackingTokenHash?: string | null; trackingExpiresAt?: string | null;
  stripeCustomerId?: string | null; stripePaymentMethodId?: string | null;
  stripePaymentIntentId?: string | null; paymentStatus?: string | null;
  status: InquiryStatus; createdAt: string; updatedAt: string;
  history: { body: string; author: string; createdAt: string }[];
};
export type Service = { id: string; slug: string; title: string; eyebrow: string; description: string; imageUrl: string; active: boolean };
export type FleetVehicle = { id: string; name: string; category: string; description: string; imageUrl: string; passengers: string; luggage: string; defaultDriverName: string | null; defaultDriverPhone: string | null; active: boolean };
export type Ride = {
  id: string; inquiryId: string; status: RideStatus; driverName: string | null; driverPhone: string | null; vehicleId: string | null;
  driverLatitude: number | null; driverLongitude: number | null; driverHeading: number | null; locationUpdatedAt: string | null;
  quoteCents: number; depositCents: number; collectedCents: number; expenseCents: number;
  dispatchNotes: string | null; createdAt: string; updatedAt: string;
  inquiry: Pick<Inquiry, "fullName" | "serviceType" | "pickupAt" | "pickup" | "destination" | "passengers" | "notes" | "isPrivateFBO" | "specificTailNumber" | "principalName" | "fboName" | "tarmacInstructions">
    & Partial<Pick<Inquiry, "email" | "estimatedFareCents" | "bookingRequestId" | "stripePaymentIntentId" | "paymentStatus">>;
  vehicle: Pick<FleetVehicle, "id" | "name" | "category" | "active"> | null;
  dispatchMessages: DispatchActivity[];
};
export type DispatchActivity = {
  id: string;
  status: string;
  toPhone: string;
  body: string;
  providerMessageId: string | null;
  providerStatus: string | null;
  deliveryStatus: string | null;
  errorMessage: string | null;
  createdAt: string;
  adminName?: string;
  reconciledAt?: string | null;
  reconciledByName?: string | null;
};
export type AdminNotification = { id: string; type: string; title: string; body: string; inquiryId: string | null; readAt: string | null; createdAt: string };

export const prisma = new PrismaClient();
export const databaseConfigured = Boolean(process.env.DATABASE_URL);
const production = process.env.NODE_ENV === "production";
const demoAdminEnabled = !production && process.env.ALLOW_IN_MEMORY_DEMO === "true";

export const services: Service[] = [
  { id: "svc-airport", slug: "airport-transfers", title: "Airport Transfers", eyebrow: "01 / Seamless arrivals", description: "A calm, considered welcome to Chicago. We monitor your flight, meet you curbside, and move you quietly home or onward.", imageUrl: "https://images.unsplash.com/photo-1516939884455-1445c8652f83?auto=format&fit=crop&w=1200&q=85", active: true },
  { id: "svc-executive", slug: "executive-travel", title: "Executive Travel", eyebrow: "02 / Time, protected", description: "A private cabin between commitments. Work, reset, and arrive prepared with a chauffeur who understands the value of every minute.", imageUrl: "https://images.unsplash.com/photo-1493238792000-8113da705763?auto=format&fit=crop&w=1200&q=85", active: true },
  { id: "svc-events", slug: "important-evenings", title: "Important Evenings", eyebrow: "03 / Make an entrance", description: "Dinner, a gala, the first pitch. Every transition is choreographed so the evening can remain yours.", imageUrl: "https://images.unsplash.com/photo-1519167758481-83f550bb49b3?auto=format&fit=crop&w=1200&q=85", active: true },
  { id: "svc-roadshows", slug: "corporate-roadshows", title: "Corporate Roadshows", eyebrow: "04 / Across the city", description: "One point of contact, an exacting itinerary, and a fleet that moves as one. Built for teams with places to be.", imageUrl: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1200&q=85", active: true },
  { id: "svc-hourly", slug: "hourly-chauffeur", title: "Hourly Chauffeur", eyebrow: "05 / At your disposal", description: "Keep the car close. Flexible hourly service gives you the freedom to move through the day without watching the clock.", imageUrl: "https://images.unsplash.com/photo-1504215680853-026ed2a45def?auto=format&fit=crop&w=1200&q=85", active: true },
];

export const fleet: FleetVehicle[] = [
  { id: "fleet-s-class", name: "Mercedes-Benz S-Class", category: "The Executive", description: "The quiet benchmark. Hand-finished comfort for one to three guests.", imageUrl: "https://static.wixstatic.com/media/0f5f80_f61199c2913641b8ae166fbeedba63e3~mv2.jpg/v1/fill/w_1200,h_600,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/class-s-1.jpg", passengers: "1–3", luggage: "2 large", defaultDriverName: null, defaultDriverPhone: null, active: true },
  { id: "fleet-escalade", name: "Cadillac Escalade", category: "The Residence", description: "A little more room without sacrificing the atmosphere of a private suite.", imageUrl: "https://cdn.pixabay.com/photo/2020/06/06/02/00/cadillac-escalade-5264974_1280.jpg", passengers: "1–6", luggage: "4 large", defaultDriverName: null, defaultDriverPhone: null, active: true },
  { id: "fleet-sprinter", name: "Executive Sprinter", category: "The Collective", description: "A refined cabin for groups who would rather arrive together.", imageUrl: "https://www.chauffeureverywhere.com/wp-content/uploads/2025/01/Sprinter-Van-Chicago-2.webp", passengers: "6–14", luggage: "8 large", defaultDriverName: null, defaultDriverPhone: null, active: true },
];

export const siteContent = {
  heroKicker: "CHICAGO · EST. 2014",
  heroTitle: "The city, on your schedule.",
  heroDescription: "Exceptional ground transportation for the people and moments that do not leave room for approximation.",
  standardTitle: "Discretion is not a feature. It is the standard.",
  standardBody: "The right car. The right route. A chauffeur who knows when to speak and when to let the city pass by. ALLAN is a more considered way through Chicago.",
};

const inquiries: Inquiry[] = [
  { id: "inq-001", fullName: "Sofia Mercer", email: "sofia.mercer@example.com", phone: "+1 312 555 0114", serviceType: "Executive Travel", pickupAt: "2026-08-29T14:30:00.000Z", pickup: "The Langham Chicago", destination: "O'Hare International Airport", passengers: 1, notes: "Flight UA 1842. Quiet ride preferred.", status: "NEW", createdAt: "2026-08-28T08:42:00.000Z", updatedAt: "2026-08-28T08:42:00.000Z", history: [] },
  { id: "inq-002", fullName: "Marcus Chen", email: "marcus.chen@example.com", phone: "+1 773 555 0196", serviceType: "Important Evenings", pickupAt: "2026-09-04T23:00:00.000Z", pickup: "787 N. State Street", destination: "Adler Planetarium", passengers: 2, notes: "", status: "CONTACTED", createdAt: "2026-08-27T17:15:00.000Z", updatedAt: "2026-08-28T09:10:00.000Z", history: [{ body: "Left voicemail — awaiting preferred vehicle.", author: "A. Reed", createdAt: "2026-08-28T09:10:00.000Z" }] },
  { id: "inq-003", fullName: "Northstar Capital", email: "travel@northstar.example", phone: "+1 312 555 0177", serviceType: "Corporate Roadshows", pickupAt: "2026-09-11T13:00:00.000Z", pickup: "312 W. Chestnut St", destination: "Multiple stops", passengers: 8, notes: "Two-day itinerary attached in follow-up.", status: "CONFIRMED", createdAt: "2026-08-26T11:25:00.000Z", updatedAt: "2026-08-27T15:40:00.000Z", history: [{ body: "Itinerary confirmed with client.", author: "A. Reed", createdAt: "2026-08-27T15:40:00.000Z" }] },
];
const rides: Ride[] = [{
  id: "ride-001", inquiryId: "inq-003", status: "UNASSIGNED", driverName: null, driverPhone: null, vehicleId: null, driverLatitude: null, driverLongitude: null, driverHeading: null, locationUpdatedAt: null,
  quoteCents: 185000, depositCents: 50000, collectedCents: 50000, expenseCents: 42000,
  dispatchNotes: "Two-day itinerary attached in follow-up.", createdAt: "2026-08-27T15:40:00.000Z", updatedAt: "2026-08-27T15:40:00.000Z",
  inquiry: { fullName: "Northstar Capital", email: "travel@northstar.example", serviceType: "Corporate Roadshows", pickupAt: "2026-09-11T13:00:00.000Z", pickup: "312 W. Chestnut St", destination: "Multiple stops", passengers: 8, notes: "Two-day itinerary attached in follow-up.", estimatedFareCents: 185000, bookingRequestId: null, stripePaymentIntentId: null, paymentStatus: null },
  vehicle: null,
  dispatchMessages: [],
}];
const notifications: AdminNotification[] = [{
  id: "notification-001", type: "NEW_INQUIRY", title: "New reservation request", body: "Sofia Mercer requested Executive Travel for Aug 29.", inquiryId: "inq-001", readAt: null, createdAt: "2026-08-28T08:42:00.000Z",
}];

const fallbackPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD || crypto.randomBytes(48).toString("hex");
const fallbackAdmin = { id: "admin-001", email: process.env.ADMIN_EMAIL || "admin@allanlimousine.com", name: "Avery Reed", passwordHash: bcrypt.hashSync(fallbackPassword, 10), role: "SUPER_ADMIN", active: true };
const sessions = new Map<string, { userId: string; expiresAt: number }>();

export async function initializeStore() {
  if (production && !databaseConfigured) throw new Error("DATABASE_URL is required in production.");
  if (!databaseConfigured) return;
  await prisma.$connect();
  const [serviceCount, fleetCount] = await Promise.all([prisma.service.count(), prisma.fleetVehicle.count()]);
  if (!serviceCount) await prisma.service.createMany({ data: services.map((s, sortOrder) => ({ ...s, sortOrder })) });
  if (!fleetCount) await prisma.fleetVehicle.createMany({ data: fleet.map((v, sortOrder) => ({ ...v, sortOrder })) });
  await Promise.all(Object.entries(siteContent).map(([key, value]) => prisma.siteContent.upsert({ where: { key }, update: {}, create: { key, value, group: key.startsWith("hero") ? "hero" : "standard" } })));
  const dispatchableWithoutRides = await prisma.inquiry.findMany({
    where: {
      status: { in: ["NEW", "CONFIRMED"] },
      OR: [{ paymentStatus: null }, { paymentStatus: { not: "canceled" } }],
      ride: null,
    },
    select: { id: true },
  });
  if (dispatchableWithoutRides.length) await prisma.ride.createMany({ data: dispatchableWithoutRides.map(item => ({ inquiryId: item.id })) });
  if (!await prisma.adminNotification.count()) {
    const newInquiries = await prisma.inquiry.findMany({ where: { status: "NEW" }, select: { id: true, fullName: true, serviceType: true, pickupAt: true } });
    if (newInquiries.length) await prisma.adminNotification.createMany({ data: newInquiries.map(item => ({ type: "NEW_INQUIRY", title: "New reservation request", body: `${item.fullName} requested ${item.serviceType} for ${item.pickupAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`, inquiryId: item.id })) });
  }
}

export async function getPublicContent() {
  if (!databaseConfigured) return { services: services.filter(s => s.active), fleet: fleet.filter(v => v.active), siteContent };
  const [dbServices, dbFleet, content] = await Promise.all([
    prisma.service.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.fleetVehicle.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    prisma.siteContent.findMany(),
  ]);
  const mappedContent = { ...siteContent };
  content.forEach(item => { if (item.key in mappedContent) (mappedContent as Record<string, string>)[item.key] = item.value; });
  return { services: dbServices, fleet: dbFleet, siteContent: mappedContent };
}
const mapInquiry = (item: any): Inquiry => ({ ...item, pickupAt: item.pickupAt.toISOString(), flightScheduledAt: item.flightScheduledAt?.toISOString() || null, trackingExpiresAt: item.trackingExpiresAt?.toISOString() || null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString(), history: (item.inquiryNotes || []).map((note: any) => ({ body: note.body, author: note.author.name, createdAt: note.createdAt.toISOString() })) });
export async function getInquiries() {
  if (!databaseConfigured) return inquiries.filter(item => item.status !== "PAYMENT_PENDING").sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  return (await prisma.inquiry.findMany({ where: { status: { not: "PAYMENT_PENDING" } }, include: { inquiryNotes: { include: { author: true }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } })).map(mapInquiry);
}
export async function getInquiryByBookingRequestId(bookingRequestId: string) {
  if (!databaseConfigured) return inquiries.find(item => item.bookingRequestId === bookingRequestId) || null;
  const where: Prisma.InquiryWhereUniqueInput = { bookingRequestId };
  const item = await prisma.inquiry.findUnique({ where, include: { inquiryNotes: { include: { author: true } } } });
  return item ? mapInquiry(item) : null;
}
export async function getInquiryByTrackingTokenHash(trackingTokenHash: string) {
  if (databaseConfigured) {
    const where: Prisma.InquiryWhereUniqueInput = { trackingTokenHash };
    const item = await prisma.inquiry.findUnique({ where, include: { inquiryNotes: { include: { author: true } } } });
    return item ? mapInquiry(item) : null;
  }
  return inquiries.find(item => item.trackingTokenHash === trackingTokenHash) || null;
}
export async function updateInquiryPayment(bookingRequestId: string, data: {
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  stripePaymentIntentId: string;
  paymentStatus: string;
}) {
  if (!databaseConfigured) {
    const item = inquiries.find(inquiry => inquiry.bookingRequestId === bookingRequestId);
    if (!item) return null;
    Object.assign(item, data, { updatedAt: new Date().toISOString() });
    const ride = rides.find(value => value.inquiryId === item.id);
    if (ride) Object.assign(ride.inquiry, data);
    return item;
  }
  const where: Prisma.InquiryWhereUniqueInput = { bookingRequestId };
  const item = await prisma.inquiry.update({
    where,
    data,
    include: { inquiryNotes: { include: { author: true } } },
  });
  return mapInquiry(item);
}
export async function updateInquiryPaymentStatusByIntent(stripePaymentIntentId: string, paymentStatus: string) {
  if (!databaseConfigured) {
    const item = inquiries.find(inquiry => inquiry.stripePaymentIntentId === stripePaymentIntentId);
    if (!item) return null;
    Object.assign(item, { paymentStatus, updatedAt: new Date().toISOString() });
    const ride = rides.find(value => value.inquiryId === item.id);
    if (ride) ride.inquiry.paymentStatus = paymentStatus;
    return item;
  }
  const item = await prisma.inquiry.findFirst({ where: { stripePaymentIntentId } });
  if (!item) return null;
  const updated = await prisma.inquiry.update({ where: { id: item.id }, data: { paymentStatus }, include: { inquiryNotes: { include: { author: true } } } });
  return mapInquiry(updated);
}
const setupSessions = new Map<string, { setupIntentId: string; customerId: string; email: string; expiresAt: Date; consumedAt: Date | null }>();
const stripeCustomerProfiles = new Map<string, { email: string; fullName: string; stripeCustomerId: string }>();
export async function getStripeCustomerProfile(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!databaseConfigured) return stripeCustomerProfiles.get(normalizedEmail) || null;
  return prisma.stripeCustomerProfile.findUnique({ where: { email: normalizedEmail } });
}
export async function saveStripeCustomerProfile(input: { email: string; fullName: string; stripeCustomerId: string }) {
  const normalizedEmail = input.email.trim().toLowerCase();
  if (!databaseConfigured) {
    const profile = { ...input, email: normalizedEmail };
    stripeCustomerProfiles.set(normalizedEmail, profile);
    return profile;
  }
  return prisma.stripeCustomerProfile.upsert({
    where: { email: normalizedEmail },
    update: { fullName: input.fullName, stripeCustomerId: input.stripeCustomerId },
    create: { ...input, email: normalizedEmail },
  });
}
export async function createStripeSetupSession(input: {
  tokenHash: string;
  setupIntentId: string;
  customerId: string;
  email: string;
  expiresAt: Date;
}) {
  if (!databaseConfigured) {
    setupSessions.set(input.tokenHash, { ...input, consumedAt: null });
    return;
  }
  await prisma.stripeSetupSession.create({ data: input });
}
export async function consumeStripeSetupSession(tokenHash: string, expected: {
  setupIntentId: string;
  customerId: string;
}) {
  if (!databaseConfigured) {
    const session = setupSessions.get(tokenHash);
    if (!session || session.consumedAt || session.expiresAt <= new Date()
      || session.setupIntentId !== expected.setupIntentId || session.customerId !== expected.customerId) return null;
    session.consumedAt = new Date();
    return session;
  }
  const consumedAt = new Date();
  const result = await prisma.stripeSetupSession.updateMany({
    where: {
      tokenHash,
      setupIntentId: expected.setupIntentId,
      customerId: expected.customerId,
      consumedAt: null,
      expiresAt: { gt: consumedAt },
    },
    data: { consumedAt },
  });
  if (result.count !== 1) return null;
  return prisma.stripeSetupSession.findUnique({ where: { tokenHash } });
}
export async function addInquiry(input: Omit<Inquiry, "id" | "status" | "createdAt" | "updatedAt" | "history">) {
  if (databaseConfigured) {
    if (input.bookingRequestId) {
      const existing = await prisma.inquiry.findUnique({ where: { bookingRequestId: input.bookingRequestId }, include: { inquiryNotes: { include: { author: true } } } });
      if (existing) return { inquiry: mapInquiry(existing), created: false };
    }
    const created = await prisma.$transaction(async tx => {
      const welcomePromo = !input.isPrivateFBO && (input.promoCode === "WELCOME15" || input.promoCode === "FIRST15");
      const priorPromo = welcomePromo ? await tx.inquiry.findFirst({
        where: { status: { not: "PAYMENT_PENDING" }, promoCode: { in: ["WELCOME15", "FIRST15"] }, OR: [{ email: input.email }, { phone: input.phone }] },
        select: { id: true },
      }) : null;
      const promoDiscountCents = welcomePromo && !priorPromo ? Math.min(1500, input.grossFareCents || 0) : 0;
      const canonicalInput = {
        ...input,
        promoCode: promoDiscountCents > 0 ? "WELCOME15" : null,
        promoDiscountCents,
        estimatedFareCents: input.grossFareCents != null ? input.grossFareCents - promoDiscountCents : null,
      };
      const paymentPending = input.paymentStatus === "authorization_pending";
      const inquiry = await tx.inquiry.create({ data: { ...canonicalInput, status: paymentPending ? "PAYMENT_PENDING" : "NEW", pickupAt: new Date(input.pickupAt), flightScheduledAt: input.flightScheduledAt ? new Date(input.flightScheduledAt) : null } });
      if (!paymentPending && input.isPrivateFBO) await tx.ride.create({ data: { inquiryId: inquiry.id, quoteCents: canonicalInput.estimatedFareCents || 0 } });
      if (!paymentPending) await tx.adminNotification.create({ data: { type: "NEW_INQUIRY", title: "New reservation request", body: `${input.fullName} requested ${input.serviceType} for ${new Date(input.pickupAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`, inquiryId: inquiry.id } });
      return tx.inquiry.findUniqueOrThrow({ where: { id: inquiry.id }, include: { inquiryNotes: { include: { author: true } } } });
    }, { isolationLevel: "Serializable" });
    return { inquiry: mapInquiry(created), created: true };
  }
  if (input.bookingRequestId) {
    const existing = inquiries.find(item => item.bookingRequestId === input.bookingRequestId);
    if (existing) return { inquiry: existing, created: false };
  }
  const welcomePromo = !input.isPrivateFBO && (input.promoCode === "WELCOME15" || input.promoCode === "FIRST15");
  const priorPromo = welcomePromo && inquiries.some(item => item.status !== "PAYMENT_PENDING" && (item.promoCode === "WELCOME15" || item.promoCode === "FIRST15") && (item.email === input.email || item.phone === input.phone));
  const promoDiscountCents = welcomePromo && !priorPromo ? Math.min(1500, input.grossFareCents || 0) : 0;
  const now = new Date().toISOString();
  const paymentPending = input.paymentStatus === "authorization_pending";
  const inquiry: Inquiry = { ...input, promoCode: promoDiscountCents ? "WELCOME15" : null, promoDiscountCents, estimatedFareCents: input.grossFareCents != null ? input.grossFareCents - promoDiscountCents : null, id: `inq-${crypto.randomUUID().slice(0, 8)}`, status: paymentPending ? "PAYMENT_PENDING" : "NEW", createdAt: now, updatedAt: now, history: [] };
  inquiries.unshift(inquiry);
  if (!paymentPending && input.isPrivateFBO) rides.push({ id: `ride-${crypto.randomUUID().slice(0, 8)}`, inquiryId: inquiry.id, status: "UNASSIGNED", driverName: null, driverPhone: null, vehicleId: null, driverLatitude: null, driverLongitude: null, driverHeading: null, locationUpdatedAt: null, quoteCents: inquiry.estimatedFareCents || 0, depositCents: 0, collectedCents: 0, expenseCents: 0, dispatchNotes: null, createdAt: now, updatedAt: now, inquiry: { fullName: inquiry.fullName, serviceType: inquiry.serviceType, pickupAt: inquiry.pickupAt, pickup: inquiry.pickup, destination: inquiry.destination, passengers: inquiry.passengers, notes: inquiry.notes, isPrivateFBO: true, specificTailNumber: inquiry.specificTailNumber, principalName: inquiry.principalName, fboName: inquiry.fboName, tarmacInstructions: inquiry.tarmacInstructions }, vehicle: null, dispatchMessages: [] });
  if (!paymentPending) notifications.unshift({ id: `notification-${crypto.randomUUID().slice(0, 8)}`, type: "NEW_INQUIRY", title: "New reservation request", body: `${input.fullName} requested ${input.serviceType}.`, inquiryId: inquiry.id, readAt: null, createdAt: now });
  return { inquiry, created: true };
}
export async function finalizeAuthorizedInquiry(bookingRequestId: string, trackingTokenHash: string, trackingExpiresAt: string) {
  if (databaseConfigured) {
    const result = await prisma.$transaction(async tx => {
      const inquiry = await tx.inquiry.findUnique({ where: { bookingRequestId } });
      if (!inquiry) return null;
      if (inquiry.status !== "PAYMENT_PENDING") return { inquiry, activatedNow: false };
      if (inquiry.promoCode === "WELCOME15") {
        const priorPromo = await tx.inquiry.findFirst({
          where: {
            id: { not: inquiry.id },
            status: { not: "PAYMENT_PENDING" },
            promoCode: { in: ["WELCOME15", "FIRST15"] },
            OR: [{ email: inquiry.email }, { phone: inquiry.phone }],
          },
          select: { id: true },
        });
        if (priorPromo) throw new Error("The first-ride credit was already used. Restart the booking to authorize the current fare.");
      }
      const updated = await tx.inquiry.update({ where: { id: inquiry.id }, data: { status: "NEW", trackingTokenHash, trackingExpiresAt: new Date(trackingExpiresAt) } });
      await tx.ride.upsert({ where: { inquiryId: updated.id }, update: {}, create: { inquiryId: updated.id, quoteCents: updated.estimatedFareCents || 0 } });
      await tx.adminNotification.create({ data: { type: "NEW_INQUIRY", title: "New reservation request", body: `${updated.fullName} requested ${updated.serviceType} for ${updated.pickupAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}.`, inquiryId: updated.id } });
      return { inquiry: updated, activatedNow: true };
    }, { isolationLevel: "Serializable" });
    return result;
  }
  const inquiry = inquiries.find(item => item.bookingRequestId === bookingRequestId);
  if (!inquiry) return null;
  if (inquiry.status !== "PAYMENT_PENDING") return { inquiry, activatedNow: false };
  if (inquiry.promoCode === "WELCOME15" && inquiries.some(item => item.id !== inquiry.id && item.status !== "PAYMENT_PENDING" && (item.promoCode === "WELCOME15" || item.promoCode === "FIRST15") && (item.email === inquiry.email || item.phone === inquiry.phone))) {
    throw new Error("The first-ride credit was already used. Restart the booking to authorize the current fare.");
  }
  Object.assign(inquiry, { status: "NEW", trackingTokenHash, trackingExpiresAt, updatedAt: new Date().toISOString() });
  if (!rides.some(ride => ride.inquiryId === inquiry.id)) rides.push({ id: `ride-${crypto.randomUUID().slice(0, 8)}`, inquiryId: inquiry.id, status: "UNASSIGNED", driverName: null, driverPhone: null, vehicleId: null, driverLatitude: null, driverLongitude: null, driverHeading: null, locationUpdatedAt: null, quoteCents: inquiry.estimatedFareCents || 0, depositCents: 0, collectedCents: 0, expenseCents: 0, dispatchNotes: null, createdAt: inquiry.updatedAt, updatedAt: inquiry.updatedAt, inquiry: { fullName: inquiry.fullName, serviceType: inquiry.serviceType, pickupAt: inquiry.pickupAt, pickup: inquiry.pickup, destination: inquiry.destination, passengers: inquiry.passengers, notes: inquiry.notes, isPrivateFBO: inquiry.isPrivateFBO, specificTailNumber: inquiry.specificTailNumber, principalName: inquiry.principalName, fboName: inquiry.fboName, tarmacInstructions: inquiry.tarmacInstructions }, vehicle: null, dispatchMessages: [] });
  notifications.unshift({ id: `notification-${crypto.randomUUID().slice(0, 8)}`, type: "NEW_INQUIRY", title: "New reservation request", body: `${inquiry.fullName} requested ${inquiry.serviceType}.`, inquiryId: inquiry.id, readAt: null, createdAt: inquiry.updatedAt });
  return { inquiry, activatedNow: true };
}
export async function updateInquiry(id: string, patch: Partial<Pick<Inquiry, "status" | "notes">>) {
  if (databaseConfigured) {
    const updated = await prisma.$transaction(async tx => {
      const current = await tx.inquiry.findUnique({ where: { id } });
      if (!current) throw new Error("Inquiry not found.");
      if (current.status === "CANCELLED" && patch.status && patch.status !== "CANCELLED" && current.paymentStatus === "canceled") throw new Error("This cancelled booking needs a new card authorization before it can be reopened.");
      const item = await tx.inquiry.update({ where: { id }, data: patch, include: { inquiryNotes: { include: { author: true } } } });
      if (patch.status === "CONFIRMED") {
        const existingRide = await tx.ride.findUnique({ where: { inquiryId: id }, select: { id: true } });
        if (!existingRide) await tx.ride.create({ data: { inquiryId: id, quoteCents: item.estimatedFareCents || 0 } });
      }
      return item;
    });
    return mapInquiry(updated);
  }
  const item = inquiries.find(i => i.id === id);
  if (!item) return null;
  if (item.status === "CANCELLED" && patch.status && patch.status !== "CANCELLED" && item.paymentStatus === "canceled") throw new Error("This cancelled booking needs a new card authorization before it can be reopened.");
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  if (patch.status === "CONFIRMED" && !rides.some(ride => ride.inquiryId === id)) {
    rides.push({ id: `ride-${crypto.randomUUID().slice(0, 8)}`, inquiryId: id, status: "UNASSIGNED", driverName: null, driverPhone: null, vehicleId: null, driverLatitude: null, driverLongitude: null, driverHeading: null, locationUpdatedAt: null, quoteCents: item.estimatedFareCents || 0, depositCents: 0, collectedCents: 0, expenseCents: 0, dispatchNotes: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), inquiry: { fullName: item.fullName, serviceType: item.serviceType, pickupAt: item.pickupAt, pickup: item.pickup, destination: item.destination, passengers: item.passengers, notes: item.notes, isPrivateFBO: item.isPrivateFBO, specificTailNumber: item.specificTailNumber, principalName: item.principalName, fboName: item.fboName, tarmacInstructions: item.tarmacInstructions }, vehicle: null, dispatchMessages: [] });
  }
  const linkedRide = rides.find(ride => ride.inquiryId === id);
  return item;
}
export async function addInquiryNote(id: string, body: string, authorId: string) {
  if (databaseConfigured) {
    await prisma.inquiryNote.create({ data: { inquiryId: id, authorId, body } });
    return mapInquiry(await prisma.inquiry.findUniqueOrThrow({ where: { id }, include: { inquiryNotes: { include: { author: true } } } }));
  }
  const item = inquiries.find(i => i.id === id);
  if (!item) return null;
  item.history.push({ body, author: "Avery Reed", createdAt: new Date().toISOString() });
  item.updatedAt = new Date().toISOString();
  return item;
}
const tokenHash = (token: string) => crypto.createHmac("sha256", process.env.SESSION_SECRET || "development-only-session-secret").update(token).digest("hex");
export async function authenticate(email: string, password: string) {
  if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) return null;
  if (!databaseConfigured && (!demoAdminEnabled || !process.env.ADMIN_BOOTSTRAP_PASSWORD)) return null;
  const admin = databaseConfigured ? await prisma.adminUser.findUnique({ where: { email } }) : fallbackAdmin;
  if (!admin || admin.email !== email || !admin.active || !(await bcrypt.compare(password, admin.passwordHash))) return null;
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 12);
  if (databaseConfigured) await prisma.adminSession.create({ data: { tokenHash: tokenHash(token), userId: admin.id, expiresAt } });
  else sessions.set(tokenHash(token), { userId: admin.id, expiresAt: expiresAt.getTime() });
  return { token, user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } };
}
export async function sessionUser(token?: string) {
  if (production && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) return null;
  if (!token) return null;
  const hash = tokenHash(token);
  if (databaseConfigured) {
    const session = await prisma.adminSession.findUnique({ where: { tokenHash: hash }, include: { user: true } });
    if (!session || session.expiresAt < new Date() || !session.user.active) return null;
    return { id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role };
  }
  const session = sessions.get(hash);
  if (!session || session.expiresAt < Date.now()) { sessions.delete(hash); return null; }
  return { id: fallbackAdmin.id, name: fallbackAdmin.name, email: fallbackAdmin.email, role: fallbackAdmin.role };
}
export async function logout(token?: string) {
  if (!token) return;
  const hash = tokenHash(token);
  if (databaseConfigured) await prisma.adminSession.deleteMany({ where: { tokenHash: hash } });
  else sessions.delete(hash);
}
export async function dashboardData() {
  const all = await getInquiries();
  const allRides = await getRides();
  const activeRides = allRides.filter(ride => ride.status !== "CANCELLED");
  const financials = activeRides.reduce((summary, ride) => ({
    revenueCents: summary.revenueCents + ride.quoteCents,
    collectedCents: summary.collectedCents + ride.collectedCents,
    expenseCents: summary.expenseCents + ride.expenseCents,
  }), { revenueCents: 0, collectedCents: 0, expenseCents: 0 });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcoming = allRides.filter(ride => !["COMPLETED", "CANCELLED"].includes(ride.status) && new Date(ride.inquiry.pickupAt) >= today);
  const notifications = await getNotifications();
  return {
    stats: {
      total: all.length,
      new: all.filter(i => i.status === "NEW").length,
      confirmed: all.filter(i => i.status === "CONFIRMED").length,
      completionRate: Math.round((all.filter(i => i.status === "COMPLETED").length / Math.max(all.length, 1)) * 100),
      upcoming: upcoming.length,
      unassigned: allRides.filter(ride => !["COMPLETED", "CANCELLED"].includes(ride.status) && (ride.status === "UNASSIGNED" || !ride.vehicleId)).length,
      revenueCents: financials.revenueCents,
      collectedCents: financials.collectedCents,
      outstandingCents: Math.max(financials.revenueCents - financials.collectedCents, 0),
      expenseCents: financials.expenseCents,
      profitCents: financials.revenueCents - financials.expenseCents,
    },
    recent: all.slice(0, 5),
    upcomingRides: upcoming.slice(0, 6),
    notifications,
  };
}

const mapRide = (item: any): Ride => ({
  id: item.id,
  inquiryId: item.inquiryId,
  status: item.status,
  driverName: item.driverName,
  driverPhone: item.driverPhone,
  driverLatitude: item.driverLatitude ?? null,
  driverLongitude: item.driverLongitude ?? null,
  driverHeading: item.driverHeading ?? null,
  locationUpdatedAt: item.locationUpdatedAt instanceof Date ? item.locationUpdatedAt.toISOString() : item.locationUpdatedAt || null,
  vehicleId: item.vehicleId,
  quoteCents: item.quoteCents,
  depositCents: item.depositCents,
  collectedCents: item.collectedCents,
  expenseCents: item.expenseCents,
  dispatchNotes: item.dispatchNotes,
  createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
  updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
  inquiry: {
    fullName: item.inquiry.fullName,
    email: item.inquiry.email,
    serviceType: item.inquiry.serviceType,
    pickupAt: item.inquiry.pickupAt instanceof Date ? item.inquiry.pickupAt.toISOString() : item.inquiry.pickupAt,
    pickup: item.inquiry.pickup,
    destination: item.inquiry.destination,
    passengers: item.inquiry.passengers,
    notes: item.inquiry.notes,
    isPrivateFBO: item.inquiry.isPrivateFBO,
    specificTailNumber: item.inquiry.specificTailNumber,
    principalName: item.inquiry.principalName,
    fboName: item.inquiry.fboName,
    tarmacInstructions: item.inquiry.tarmacInstructions,
    estimatedFareCents: item.inquiry.estimatedFareCents,
    bookingRequestId: item.inquiry.bookingRequestId,
    stripePaymentIntentId: item.inquiry.stripePaymentIntentId,
    paymentStatus: item.inquiry.paymentStatus,
  },
  vehicle: item.vehicle ? { id: item.vehicle.id, name: item.vehicle.name, category: item.vehicle.category, active: item.vehicle.active } : null,
  dispatchMessages: (item.dispatchMessages || []).map((message: any) => ({
    id: message.id,
    status: message.status,
    toPhone: message.toPhone,
    body: message.body,
    providerMessageId: message.providerMessageId || null,
    providerStatus: message.providerStatus || null,
    deliveryStatus: message.deliveryStatus || null,
    errorMessage: message.errorMessage || null,
    createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
    adminName: message.admin?.name,
    reconciledAt: message.reconciledAt instanceof Date ? message.reconciledAt.toISOString() : message.reconciledAt || null,
    reconciledByName: message.reconciledBy?.name || null,
  })),
});
const hydrateMemoryRide = (ride: Ride) => {
  const inquiry = inquiries.find(item => item.id === ride.inquiryId);
  if (!inquiry) return ride;
  return {
    ...ride,
    inquiry: {
      ...ride.inquiry,
      email: inquiry.email,
      estimatedFareCents: inquiry.estimatedFareCents,
      bookingRequestId: inquiry.bookingRequestId,
      stripePaymentIntentId: inquiry.stripePaymentIntentId,
      paymentStatus: inquiry.paymentStatus,
    },
  };
};

export async function getRides(filters: { status?: string; date?: string; unassigned?: boolean } = {}) {
  if (!databaseConfigured) {
    return rides
      .filter(ride => (!filters.status || filters.status === "ALL" || ride.status === filters.status) && (!filters.date || ride.inquiry.pickupAt.startsWith(filters.date)) && (!filters.unassigned || (!["COMPLETED", "CANCELLED"].includes(ride.status) && (ride.status === "UNASSIGNED" || !ride.vehicleId))))
      .sort((a, b) => +new Date(a.inquiry.pickupAt) - +new Date(b.inquiry.pickupAt))
      .map(hydrateMemoryRide);
  }
  const where: any = {};
  if (filters.status && filters.status !== "ALL") where.status = filters.status;
  if (filters.unassigned) where.AND = [{ status: { notIn: ["COMPLETED", "CANCELLED"] } }, { OR: [{ status: "UNASSIGNED" }, { vehicleId: null }] }];
  if (filters.date) {
    const start = new Date(`${filters.date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    where.inquiry = { pickupAt: { gte: start, lt: end } };
  }
  const result = await prisma.ride.findMany({ where, include: { inquiry: true, vehicle: true, dispatchMessages: { include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 10 } }, orderBy: { inquiry: { pickupAt: "asc" } } });
  return result.map(mapRide);
}

export async function getRideByInquiryId(inquiryId: string) {
  if (!databaseConfigured) {
    const ride = rides.find(item => item.inquiryId === inquiryId);
    return ride ? hydrateMemoryRide(ride) : null;
  }
  const result = await prisma.ride.findUnique({
    where: { inquiryId },
    include: { inquiry: true, vehicle: true },
  });
  return result ? mapRide(result) : null;
}

type RideUpdate = Partial<Pick<Ride, "status" | "driverName" | "driverPhone" | "vehicleId" | "quoteCents" | "depositCents" | "collectedCents" | "expenseCents" | "dispatchNotes" | "driverLatitude" | "driverLongitude" | "driverHeading" | "locationUpdatedAt">>;

const rideStatusTransitions: Record<string, string[]> = {
  UNASSIGNED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["EN_ROUTE", "CANCELLED"],
  EN_ROUTE: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

function validateRideStatusTransition(currentStatus: string, nextStatus?: string) {
  if (!nextStatus || nextStatus === currentStatus) return;
  if (!rideStatusTransitions[currentStatus]?.includes(nextStatus)) {
    throw new Error(`This ride must advance from ${currentStatus.toLowerCase().replaceAll("_", " ")} to its next operational status.`);
  }
}

export async function validateRideUpdate(id: string, data: RideUpdate) {
  if (databaseConfigured) {
    const current = await prisma.ride.findUnique({ where: { id }, include: { inquiry: true } });
    if (!current) return false;
    validateRideStatusTransition(current.status, data.status);
    const next = { ...current, ...data };
    if (next.depositCents > next.quoteCents || next.collectedCents > next.quoteCents) throw new Error("Deposit and collected amounts cannot exceed the quoted fare.");
    if (next.depositCents > next.collectedCents) throw new Error("Total collected must include the recorded deposit.");
    if (next.vehicleId && !await prisma.fleetVehicle.findFirst({ where: { id: next.vehicleId, active: true } })) throw new Error("Choose an active vehicle from the fleet.");
    if (next.status === "UNASSIGNED" && (next.vehicleId || next.driverName || next.driverPhone)) throw new Error("Confirm the vehicle and driver together to assign this ride.");
    if (current.inquiry.paymentStatus === "canceled" && (data.status === undefined || !["CANCELLED", "COMPLETED"].includes(data.status))) throw new Error("This cancelled booking needs a new card authorization before it can be changed or reopened.");
    if (next.status !== "UNASSIGNED" && !["CANCELLED", "COMPLETED"].includes(next.status) && (!next.vehicleId || !next.driverName)) throw new Error("Assign a vehicle and chauffeur before advancing this ride.");
    return true;
  }
  const current = rides.find(item => item.id === id);
  if (!current) return false;
  validateRideStatusTransition(current.status, data.status);
  const inquiry = inquiries.find(item => item.id === current.inquiryId);
  const next = { ...current, ...data };
  if (next.depositCents > next.quoteCents || next.collectedCents > next.quoteCents) throw new Error("Deposit and collected amounts cannot exceed the quoted fare.");
  if (next.depositCents > next.collectedCents) throw new Error("Total collected must include the recorded deposit.");
  if (next.vehicleId && !fleet.some(vehicle => vehicle.id === next.vehicleId && vehicle.active)) throw new Error("Choose an active vehicle from the fleet.");
  if (next.status === "UNASSIGNED" && (next.vehicleId || next.driverName || next.driverPhone)) throw new Error("Confirm the vehicle and driver together to assign this ride.");
  if (inquiry?.paymentStatus === "canceled" && (data.status === undefined || !["CANCELLED", "COMPLETED"].includes(data.status))) throw new Error("This cancelled booking needs a new card authorization before it can be changed or reopened.");
  if (next.status !== "UNASSIGNED" && !["CANCELLED", "COMPLETED"].includes(next.status) && (!next.vehicleId || !next.driverName)) throw new Error("Assign a vehicle and chauffeur before advancing this ride.");
  return true;
}

export async function updateRide(id: string, data: RideUpdate) {
  if (databaseConfigured) {
    return prisma.$transaction(async tx => {
      const current = await tx.ride.findUnique({ where: { id } });
      if (!current) return null;
      validateRideStatusTransition(current.status, data.status);
      const inquiry = await tx.inquiry.findUnique({ where: { id: current.inquiryId } });
      if (inquiry?.paymentStatus === "canceled" && (data.status === undefined || !["CANCELLED", "COMPLETED"].includes(data.status))) throw new Error("This cancelled booking needs a new card authorization before it can be changed or reopened.");
      const next = { ...current, ...data };
      if (next.depositCents > next.quoteCents || next.collectedCents > next.quoteCents) throw new Error("Deposit and collected amounts cannot exceed the quoted fare.");
      if (next.depositCents > next.collectedCents) throw new Error("Total collected must include the recorded deposit.");
      if (next.vehicleId && !await tx.fleetVehicle.findFirst({ where: { id: next.vehicleId, active: true } })) throw new Error("Choose an active vehicle from the fleet.");
      if (next.status === "UNASSIGNED" && (next.vehicleId || next.driverName || next.driverPhone)) throw new Error("Confirm the vehicle and driver together to assign this ride.");
      if (next.status !== "UNASSIGNED" && !["CANCELLED", "COMPLETED"].includes(next.status) && (!next.vehicleId || !next.driverName)) throw new Error("Assign a vehicle and chauffeur before advancing this ride.");
       const result = await tx.ride.update({ where: { id }, data, include: { inquiry: true, vehicle: true, dispatchMessages: { include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 10 } } });
      if (data.status === "COMPLETED" || data.status === "CANCELLED") await tx.inquiry.update({ where: { id: current.inquiryId }, data: { status: data.status } });
      else if (data.status && ["COMPLETED", "CANCELLED"].includes(result.inquiry.status)) await tx.inquiry.update({ where: { id: current.inquiryId }, data: { status: "CONFIRMED" } });
      return mapRide(result);
    }, { isolationLevel: "Serializable" });
  }
  const ride = rides.find(item => item.id === id);
  if (!ride) return null;
  validateRideStatusTransition(ride.status, data.status);
  const linkedInquiry = inquiries.find(item => item.id === ride.inquiryId);
  if (linkedInquiry?.paymentStatus === "canceled" && (data.status === undefined || !["CANCELLED", "COMPLETED"].includes(data.status))) throw new Error("This cancelled booking needs a new card authorization before it can be changed or reopened.");
  const next = { ...ride, ...data };
  if (next.depositCents > next.quoteCents || next.collectedCents > next.quoteCents) throw new Error("Deposit and collected amounts cannot exceed the quoted fare.");
  if (next.depositCents > next.collectedCents) throw new Error("Total collected must include the recorded deposit.");
  if (next.vehicleId && !fleet.some(vehicle => vehicle.id === next.vehicleId && vehicle.active)) throw new Error("Choose an active vehicle from the fleet.");
  if (next.status === "UNASSIGNED" && (next.vehicleId || next.driverName || next.driverPhone)) throw new Error("Confirm the vehicle and driver together to assign this ride.");
  if (next.status !== "UNASSIGNED" && !["CANCELLED", "COMPLETED"].includes(next.status) && (!next.vehicleId || !next.driverName)) throw new Error("Assign a vehicle and chauffeur before advancing this ride.");
  Object.assign(ride, data, { updatedAt: new Date().toISOString() });
  const inquiry = inquiries.find(item => item.id === ride.inquiryId);
  if (inquiry && (data.status === "COMPLETED" || data.status === "CANCELLED")) inquiry.status = data.status;
  else if (inquiry && data.status && ["COMPLETED", "CANCELLED"].includes(inquiry.status)) inquiry.status = "CONFIRMED";
  if (ride.vehicleId) ride.vehicle = fleet.find(vehicle => vehicle.id === ride.vehicleId) || null;
  return ride;
}

export function dispatchBrief(ride: Ride) {
  const lines = [
    `Allan Limousine — Dispatch`,
    `Customer: ${ride.inquiry.fullName}`,
    `Pickup: ${formatDispatchDate(ride.inquiry.pickupAt)}`,
    `From: ${ride.inquiry.pickup}`,
    `To: ${ride.inquiry.destination}`,
    `Service: ${ride.inquiry.serviceType}`,
    `Passengers: ${ride.inquiry.passengers}`,
    ride.inquiry.isPrivateFBO ? `FBO / Jet Center: ${ride.inquiry.fboName}` : "",
    ride.inquiry.isPrivateFBO ? `Tail number: ${ride.inquiry.specificTailNumber}` : "",
    ride.inquiry.isPrivateFBO ? `Passenger / principal: ${ride.inquiry.principalName}` : "",
    ride.inquiry.isPrivateFBO ? `Ramp escort: ${ride.inquiry.tarmacInstructions}` : "",
  ].filter(Boolean);
  let brief = lines.join("\n");
  for (const note of [
    ride.inquiry.notes ? `Booking notes: ${ride.inquiry.notes}` : "",
    ride.dispatchNotes ? `Dispatch notes: ${ride.dispatchNotes}` : "",
  ].filter(Boolean)) {
    const available = 1600 - brief.length - 1;
    if (available <= 0) break;
    brief += `\n${note.slice(0, available)}`;
  }
  return brief;
}

function formatDispatchDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" }).format(new Date(value));
}

export async function getRideById(id: string) {
  if (!databaseConfigured) {
    const ride = rides.find(item => item.id === id);
    return ride ? hydrateMemoryRide(ride) : null;
  }
  const item = await prisma.ride.findUnique({ where: { id }, include: { inquiry: true, vehicle: true, dispatchMessages: { include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 10 } } });
  return item ? mapRide(item) : null;
}

export async function recordDispatchMessage(data: { rideId: string; adminId: string; toPhone: string; body: string; status: "SENT" | "FAILED"; providerMessageId?: string | null; providerStatus?: string | null; deliveryStatus?: string | null; errorMessage?: string | null }) {
  const createdAt = new Date().toISOString();
  if (!databaseConfigured) {
    const ride = rides.find(item => item.id === data.rideId);
    if (!ride) return null;
    const activity: DispatchActivity = { id: `dispatch-${crypto.randomUUID().slice(0, 8)}`, ...data, providerMessageId: data.providerMessageId || null, providerStatus: data.providerStatus || null, deliveryStatus: data.deliveryStatus || null, errorMessage: data.errorMessage || null, createdAt };
    ride.dispatchMessages.unshift(activity);
    return activity;
  }
  const message = await prisma.dispatchMessage.create({ data, include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } } });
  return mapDispatchMessage(message);
}

export async function getPendingDispatchAttempt(rideId: string) {
  if (!databaseConfigured) return rides.find(ride => ride.id === rideId)?.dispatchMessages.find(message => message.status === "PENDING") || null;
  const message = await prisma.dispatchMessage.findFirst({ where: { rideId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
  return message ? { ...message, createdAt: message.createdAt.toISOString() } : null;
}

export async function createDispatchAttempt(data: { rideId: string; adminId: string; toPhone: string; body: string }) {
  const createdAt = new Date().toISOString();
  if (!databaseConfigured) {
    const ride = rides.find(item => item.id === data.rideId);
    if (!ride) return null;
    if (ride.dispatchMessages.some(message => message.status === "PENDING")) throw new Error("A dispatch attempt is already awaiting reconciliation.");
    const activity: DispatchActivity = { id: `dispatch-${crypto.randomUUID().slice(0, 8)}`, ...data, status: "PENDING", providerMessageId: null, providerStatus: null, deliveryStatus: null, errorMessage: null, createdAt };
    ride.dispatchMessages.unshift(activity);
    return activity;
  }
  try {
    const message = await prisma.dispatchMessage.create({ data: { ...data, status: "PENDING" } });
    return mapDispatchMessage(message);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new Error("PENDING_DISPATCH_EXISTS");
    throw error;
  }
}

function mapDispatchMessage(message: any): DispatchActivity {
  return {
    id: message.id,
    status: message.status,
    toPhone: message.toPhone,
    body: message.body,
    providerMessageId: message.providerMessageId || null,
    providerStatus: message.providerStatus || null,
    deliveryStatus: message.deliveryStatus || null,
    errorMessage: message.errorMessage || null,
    createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : message.createdAt,
    adminName: message.admin?.name,
    reconciledAt: message.reconciledAt instanceof Date ? message.reconciledAt.toISOString() : message.reconciledAt || null,
    reconciledByName: message.reconciledBy?.name || null,
  };
}
export async function finishDispatchAttempt(id: string, data: { status: "SENT" | "FAILED"; providerMessageId?: string | null; providerStatus?: string | null; deliveryStatus?: string | null; errorMessage?: string | null }) {
  if (!databaseConfigured) {
    const activity = rides.flatMap(ride => ride.dispatchMessages).find(message => message.id === id);
    if (!activity) return null;
    Object.assign(activity, data, { providerMessageId: data.providerMessageId ?? activity.providerMessageId, providerStatus: data.providerStatus ?? activity.providerStatus, deliveryStatus: data.deliveryStatus ?? activity.deliveryStatus });
    return activity;
  }
  const message = await prisma.dispatchMessage.update({ where: { id }, data, include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } } });
  return mapDispatchMessage(message);
}

export async function getDispatchAttempt(rideId: string, id: string) {
  if (!databaseConfigured) return rides.find(ride => ride.id === rideId)?.dispatchMessages.find(message => message.id === id) || null;
  const message = await prisma.dispatchMessage.findFirst({ where: { id, rideId }, include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } } });
  return message ? mapDispatchMessage(message) : null;
}
export async function getNotifications(unreadOnly = false) {
  if (!databaseConfigured) return notifications.filter(item => !unreadOnly || !item.readAt).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)).slice(0, 20);
  const result = await prisma.adminNotification.findMany({ where: unreadOnly ? { readAt: null } : undefined, orderBy: { createdAt: "desc" }, take: 20 });
  return result.map(item => ({ ...item, readAt: item.readAt?.toISOString() || null, createdAt: item.createdAt.toISOString() }));
}

export async function markNotificationRead(id: string) {
  if (databaseConfigured) {
    const item = await prisma.adminNotification.update({ where: { id }, data: { readAt: new Date() } });
    return { ...item, readAt: item.readAt?.toISOString() || null, createdAt: item.createdAt.toISOString() };
  }
  const item = notifications.find(notification => notification.id === id);
  if (!item) return null;
  item.readAt = new Date().toISOString();
  return item;
}
export async function getAdminContent() {
  if (!databaseConfigured) return { services, fleet, siteContent };
  const publicContent = await getPublicContent();
  return {
    services: await prisma.service.findMany({ orderBy: { sortOrder: "asc" } }),
    fleet: await prisma.fleetVehicle.findMany({ orderBy: { sortOrder: "asc" } }),
    siteContent: publicContent.siteContent,
  };
}
export async function updateSiteContent(values: typeof siteContent) {
  if (!databaseConfigured) { Object.assign(siteContent, values); return siteContent; }
  await prisma.$transaction(Object.entries(values).map(([key, value]) => prisma.siteContent.upsert({ where: { key }, update: { value }, create: { key, value } })));
  return values;
}
export async function updateService(id: string, data: Pick<Service, "title" | "description" | "active">) {
  if (databaseConfigured) return prisma.service.update({ where: { id }, data });
  const item = services.find(s => s.id === id); if (!item) return null; Object.assign(item, data); return item;
}
export async function updateFleet(id: string, data: Pick<FleetVehicle, "name" | "description" | "active">) {
  if (databaseConfigured) return prisma.fleetVehicle.update({ where: { id }, data });
  const item = fleet.find(v => v.id === id); if (!item) return null; Object.assign(item, data); return item;
}
export async function createService(data: Omit<Service, "id">) {
  if (databaseConfigured) return prisma.service.create({ data: { ...data, sortOrder: await prisma.service.count() } });
  const item = { ...data, id: `svc-${crypto.randomUUID().slice(0, 8)}` }; services.push(item); return item;
}
export async function deleteService(id: string) {
  if (databaseConfigured) return prisma.service.delete({ where: { id } });
  const index = services.findIndex(item => item.id === id); if (index < 0) return null; return services.splice(index, 1)[0];
}
export async function createFleet(data: Omit<FleetVehicle, "id">) {
  if (databaseConfigured) return prisma.fleetVehicle.create({ data: { ...data, sortOrder: await prisma.fleetVehicle.count() } });
  const item = { ...data, id: `fleet-${crypto.randomUUID().slice(0, 8)}` }; fleet.push(item); return item;
}
export async function deleteFleet(id: string) {
  if (databaseConfigured) return prisma.fleetVehicle.delete({ where: { id } });
  const index = fleet.findIndex(item => item.id === id); if (index < 0) return null; return fleet.splice(index, 1)[0];
}
export async function listAdmins() {
  if (!databaseConfigured) return [{ id: fallbackAdmin.id, email: fallbackAdmin.email, name: fallbackAdmin.name, role: fallbackAdmin.role, active: true, createdAt: new Date().toISOString() }];
  return prisma.adminUser.findMany({ select: { id: true, email: true, name: true, role: true, active: true, createdAt: true }, orderBy: { createdAt: "asc" } });
}
export async function createAdmin(data: { email: string; name: string; password: string; role: string }) {
  const passwordHash = await bcrypt.hash(data.password, 12);
  if (!databaseConfigured) throw new Error("Administrator creation requires PostgreSQL.");
  return prisma.adminUser.create({ data: { email: data.email, name: data.name, passwordHash, role: data.role }, select: { id: true, email: true, name: true, role: true, active: true, createdAt: true } });
}
export async function updateAdmin(id: string, data: { active?: boolean; role?: string }) {
  if (!databaseConfigured) throw new Error("Administrator updates require PostgreSQL.");
  return prisma.$transaction(async tx => {
    const target = await tx.adminUser.findUnique({ where: { id } });
    if (!target) return null;
    const removesSuperAccess = target.role === "SUPER_ADMIN" && target.active && (data.active === false || (data.role && data.role !== "SUPER_ADMIN"));
    if (removesSuperAccess && await tx.adminUser.count({ where: { role: "SUPER_ADMIN", active: true } }) <= 1) return "LAST_SUPER_ADMIN" as const;
    return tx.adminUser.update({ where: { id }, data, select: { id: true, email: true, name: true, role: true, active: true, createdAt: true } });
  });
}

export async function updateDispatchProviderStatus(id: string, data: { providerMessageId?: string | null; providerStatus?: string | null; deliveryStatus?: string | null }) {
  if (!databaseConfigured) {
    const activity = rides.flatMap(ride => ride.dispatchMessages).find(message => message.id === id);
    if (!activity) return null;
    Object.assign(activity, data);
    return activity;
  }
  const message = await prisma.dispatchMessage.update({ where: { id }, data, include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } } });
  return mapDispatchMessage(message);
}

export async function reconcileDispatchAttempt(rideId: string, id: string, data: {
  status: "SENT" | "FAILED";
  providerMessageId?: string | null;
  providerStatus: string;
  deliveryStatus?: string | null;
  errorMessage?: string | null;
  reconciledById: string;
  reconciledByName?: string;
}) {
  const reconciledAt = new Date().toISOString();
  if (!databaseConfigured) {
    const activity = rides.find(ride => ride.id === rideId)?.dispatchMessages.find(message => message.id === id);
    if (!activity || activity.status !== "PENDING") return null;
    Object.assign(activity, data, { reconciledAt, reconciledByName: data.reconciledByName || null });
    return activity;
  }
  const { reconciledByName: _reconciledByName, ...databaseData } = data;
  const updated = await prisma.dispatchMessage.updateMany({
    where: { id, rideId, status: "PENDING" },
    data: { ...databaseData, reconciledAt: new Date(reconciledAt) },
  });
  if (!updated.count) return null;
  return getDispatchAttempt(rideId, id);
}

export async function getDispatchAttemptByProviderMessageId(providerMessageId: string) {
  if (!databaseConfigured) return rides.flatMap(ride => ride.dispatchMessages).find(message => message.providerMessageId === providerMessageId) || null;
  const message = await prisma.dispatchMessage.findUnique({ where: { providerMessageId }, include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } } });
  return message ? mapDispatchMessage(message) : null;
}

export async function updateDispatchDeliveryStatus(providerMessageId: string, data: { providerStatus?: string | null; deliveryStatus: string }) {
  const statusRank: Record<string, number> = {
    accepted: 1, scheduled: 1, queued: 1, sending: 2, sent: 3,
    delivered: 4, failed: 4, undelivered: 4, canceled: 4, read: 5,
  };
  if (!databaseConfigured) {
    const activity = rides.flatMap(ride => ride.dispatchMessages).find(message => message.providerMessageId === providerMessageId);
    if (!activity) return null;
    if ((statusRank[activity.deliveryStatus || ""] || 0) > (statusRank[data.deliveryStatus] || 0)) return activity;
    if ((statusRank[activity.deliveryStatus || ""] || 0) === 4 && (statusRank[data.deliveryStatus] || 0) === 4 && activity.deliveryStatus !== data.deliveryStatus) return activity;
    Object.assign(activity, data);
    return activity;
  }
  const message = await prisma.dispatchMessage.findFirst({ where: { providerMessageId } });
  if (!message) return null;
  const currentRank = statusRank[message.deliveryStatus || ""] || 0;
  const incomingRank = statusRank[data.deliveryStatus] || 0;
  if (currentRank > incomingRank || (currentRank === 4 && incomingRank === 4 && message.deliveryStatus !== data.deliveryStatus)) {
    return getDispatchAttempt(message.rideId, message.id);
  }
  const nextStatus = ["failed", "undelivered", "canceled"].includes(data.deliveryStatus.toLowerCase()) && message.status !== "PENDING" ? "FAILED" : undefined;
  const updated = await prisma.dispatchMessage.update({ where: { id: message.id }, data: { ...data, ...(nextStatus ? { status: nextStatus } : {}) }, include: { admin: { select: { name: true } }, reconciledBy: { select: { name: true } } } });
  return mapDispatchMessage(updated);
}
