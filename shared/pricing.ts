export type RateTier = "EXECUTIVE_SEDAN" | "LUXURY_SUV" | "SPRINTER_CLASS";

export type RateTierPricing = {
  label: string;
  baseFareCents: number;
  perMileCents: number;
  perMinuteCents: number;
  minimumFareCents: number;
};

export const PRIVATE_FBO_PRICING = {
  baseFareCents: 6500,
  perMileCents: 425,
  perMinuteCents: 85,
  handlingSurchargeCents: 3500,
  minimumFareCents: 15000,
} as const;

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

export function calculateFare(tier: RateTier, miles: number, minutes: number, isPrivateFBO = false) {
  const standardRate = RATE_TIER_PRICING[tier];
  const rate = isPrivateFBO ? {
    ...standardRate,
    baseFareCents: PRIVATE_FBO_PRICING.baseFareCents,
    perMileCents: PRIVATE_FBO_PRICING.perMileCents,
    perMinuteCents: PRIVATE_FBO_PRICING.perMinuteCents,
    minimumFareCents: PRIVATE_FBO_PRICING.minimumFareCents,
  } : standardRate;
  const validMiles = Number.isFinite(miles) && miles >= 0 ? miles : 0;
  const validMinutes = Number.isFinite(minutes) && minutes >= 0 ? minutes : 0;
  const meteredFareCents = Math.round(
    rate.baseFareCents
      + validMiles * rate.perMileCents
      + validMinutes * rate.perMinuteCents
      + (isPrivateFBO ? PRIVATE_FBO_PRICING.handlingSurchargeCents : 0),
  );

  return {
    ...rate,
    tier,
    miles: validMiles,
    minutes: validMinutes,
    isPrivateFBO,
    handlingSurchargeCents: isPrivateFBO ? PRIVATE_FBO_PRICING.handlingSurchargeCents : 0,
    fareCents: Math.max(rate.minimumFareCents, meteredFareCents),
  };
}