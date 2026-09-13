export type RateTier = "EXECUTIVE_SEDAN" | "LUXURY_SUV" | "SPRINTER_CLASS";

export type RateTierPricing = {
  label: string;
  baseFareCents: number;
  perMileCents: number;
  perMinuteCents: number;
  minimumFareCents: number;
};

export const RATE_TIER_PRICING: Record<RateTier, RateTierPricing> = {
  EXECUTIVE_SEDAN: {
    label: "Executive Sedan",
    baseFareCents: 1000,
    perMileCents: 310,
    perMinuteCents: 55,
    minimumFareCents: 2500,
  },
  LUXURY_SUV: {
    label: "Luxury SUV",
    baseFareCents: 1500,
    perMileCents: 425,
    perMinuteCents: 75,
    minimumFareCents: 3500,
  },
  SPRINTER_CLASS: {
    label: "Sprinter Class",
    baseFareCents: 2500,
    perMileCents: 650,
    perMinuteCents: 110,
    minimumFareCents: 7500,
  },
};

export function calculateFare(tier: RateTier, miles: number, minutes: number) {
  const rate = RATE_TIER_PRICING[tier];
  const validMiles = Number.isFinite(miles) && miles >= 0 ? miles : 0;
  const validMinutes = Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
  const meteredFareCents = Math.round(
    rate.baseFareCents
      + validMiles * rate.perMileCents
      + validMinutes * rate.perMinuteCents,
  );

  return {
    ...rate,
    tier,
    miles: validMiles,
    minutes: validMinutes,
    fareCents: Math.max(rate.minimumFareCents, meteredFareCents),
  };
}