CREATE TABLE "StripeSetupSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "setupIntentId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeSetupSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeSetupSession_tokenHash_key" ON "StripeSetupSession"("tokenHash");
CREATE UNIQUE INDEX "StripeSetupSession_setupIntentId_key" ON "StripeSetupSession"("setupIntentId");
CREATE INDEX "StripeSetupSession_expiresAt_idx" ON "StripeSetupSession"("expiresAt");