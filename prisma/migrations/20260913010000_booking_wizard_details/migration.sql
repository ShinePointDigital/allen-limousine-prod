ALTER TABLE "Inquiry"
ADD COLUMN "rateTier" TEXT,
ADD COLUMN "estimatedFareCents" INTEGER,
ADD COLUMN "estimatedMiles" DOUBLE PRECISION,
ADD COLUMN "estimatedMinutes" DOUBLE PRECISION,
ADD COLUMN "rideTiming" TEXT;