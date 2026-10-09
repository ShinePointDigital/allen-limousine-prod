import { z } from "zod";

export const GRATUITY_PERCENTAGES = [10, 15, 20] as const;
export const MAX_GRATUITY_CENTS = 100_000;
export const gratuitySelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("percentage"), percent: z.union([z.literal(10), z.literal(15), z.literal(20)]) }).strict(),
  z.object({ kind: z.literal("custom"), amountCents: z.number().int().min(0).max(MAX_GRATUITY_CENTS) }).strict(),
]);
export type GratuitySelection = z.infer<typeof gratuitySelectionSchema>;

export function customGratuityCents(dollars: string): number {
  if (!/^\d{1,4}(?:\.\d{1,2})?$/.test(dollars)) throw new Error("Enter a dollar amount with no more than two decimal places.");
  const [whole, fraction = ""] = dollars.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents > MAX_GRATUITY_CENTS) throw new Error("Gratuity cannot exceed $1,000.00.");
  return cents;
}

export function bookingAmounts(grossFareCents: number, discountCents: number, selection: GratuitySelection = { kind: "none" }, expectedTotalCents?: number) {
  for (const cents of [grossFareCents, discountCents]) {
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > 10_000_000) throw new Error("Invalid fare amount.");
  }
  if (discountCents > grossFareCents) throw new Error("Discount cannot exceed the fare.");
  const chosen = gratuitySelectionSchema.parse(selection);
  const fareCents = grossFareCents - discountCents;
  // Percentage gratuity is calculated on the discounted fare, rounded once to cents.
  const gratuityCents = chosen.kind === "none" ? 0 : chosen.kind === "custom" ? chosen.amountCents : Math.floor((fareCents * chosen.percent + 50) / 100);
  if (gratuityCents > MAX_GRATUITY_CENTS) throw new Error("Gratuity cannot exceed $1,000.00.");
  const authorizedTotalCents = fareCents + gratuityCents;
  if (expectedTotalCents !== undefined && expectedTotalCents !== authorizedTotalCents) {
    throw new Error("The fare or discount changed. Review the current total before authorizing your card.");
  }
  return { fareCents, gratuityCents, authorizedTotalCents };
}

export function storedAuthorizationAmount(booking: { estimatedFareCents?: number | null; gratuityCents?: number | null; authorizedTotalCents?: number | null }) {
  const fare = booking.estimatedFareCents;
  const tip = booking.gratuityCents ?? 0;
  if (fare == null || !Number.isSafeInteger(fare) || fare < 0 || !Number.isSafeInteger(tip) || tip < 0 || tip > MAX_GRATUITY_CENTS) throw new Error("Invalid stored booking amount.");
  const total = fare + tip;
  if (booking.authorizedTotalCents != null && booking.authorizedTotalCents !== total) throw new Error("The stored authorization total does not match the fare and gratuity.");
  return total;
}
