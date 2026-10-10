import { z } from "zod";

export const CORPORATE_BRAND = "Allen Express, LLC (dba Allan Limousine)";
export const CORPORATE_BILLING_TERMS = `I authorize ${CORPORATE_BRAND} to save the company's payment method with Stripe and charge it for each completed ride's reviewed fare and gratuity. Billing is per ride, not a monthly invoice.`;
export const CORPORATE_BILLING_VERSION = "corporate-per-ride-v1";
export const corporateApplicationSchema = z.object({
  companyLegalName: z.string().trim().min(2).max(200),
  contactName: z.string().trim().min(2).max(100),
  contactEmail: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  contactPhone: z.string().trim().min(10).max(30),
  monthlyRideVolume: z.number().int().min(1).max(100000),
  billingPreference: z.enum(["EMAIL_RECEIPTS", "ITEMIZED_PO_RECEIPTS"]),
  billingName: z.string().trim().min(2).max(200),
  billingEmail: z.string().trim().email().max(254).transform(v => v.toLowerCase()),
  billingAddress: z.string().trim().min(8).max(500),
  billingConsent: z.literal(true),
  applicationToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export type CorporateApplicationInput = z.infer<typeof corporateApplicationSchema>;
export const corporateTripSchema = z.object({
  bookingRequestId: z.string().uuid(),
  fullName: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(10).max(30),
  pickup: z.string().trim().min(3).max(300),
  destination: z.string().trim().min(3).max(300),
  pickupAt: z.string().datetime(),
  passengers: z.number().int().min(1).max(14),
  rateTier: z.enum(["EXECUTIVE_SEDAN", "LUXURY_SUV", "SPRINTER_CLASS"]),
  poNumber: z.string().trim().min(1).max(100),
  costCenterCode: z.string().trim().min(1).max(100),
  notes: z.string().trim().max(1000).default(""),
  airportCode: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
  flightNumber: z.string().trim().max(20).optional(),
  flightScheduledAt: z.string().datetime().optional(),
}).strict();
export type CorporateTripInput = z.infer<typeof corporateTripSchema>;
export type CorporateAccountView = Omit<CorporateApplicationInput, "billingConsent" | "applicationToken"> & {
  id: string; status: "PENDING" | "ACTIVE" | "REJECTED"; createdAt: string;
  paymentReady: boolean; mustChangePassword: boolean; credentialsEmailStatus: string;
  rejectionReason: string | null; approvedAt: string | null;
};
export type CorporateBookingView = {
  id: string; reference: string; pickup: string; destination: string; pickupAt: string;
  fullName: string; status: string; fareCents: number; gratuityCents: number;
  authorizedTotalCents: number; paymentStatus: string | null; poNumber: string; costCenterCode: string;
};
