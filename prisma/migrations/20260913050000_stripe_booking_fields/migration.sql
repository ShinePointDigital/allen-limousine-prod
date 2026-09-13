ALTER TABLE "Inquiry"
ADD COLUMN "stripeCustomerId" TEXT,
ADD COLUMN "stripePaymentMethodId" TEXT,
ADD COLUMN "stripePaymentIntentId" TEXT,
ADD COLUMN "paymentStatus" TEXT;

CREATE INDEX "Inquiry_stripeCustomerId_idx" ON "Inquiry"("stripeCustomerId");
CREATE INDEX "Inquiry_stripePaymentIntentId_idx" ON "Inquiry"("stripePaymentIntentId");