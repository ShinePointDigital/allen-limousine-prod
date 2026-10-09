ALTER TABLE "Inquiry"
  ADD COLUMN "gratuitySelection" JSONB,
  ADD COLUMN "gratuityCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "authorizedTotalCents" INTEGER;
