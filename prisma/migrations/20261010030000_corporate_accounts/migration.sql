CREATE TYPE "CorporateAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

ALTER TABLE "Inquiry"
ADD COLUMN "companyName" TEXT,
ADD COLUMN "corporateAccountId" TEXT,
ADD COLUMN "corporateChargeStartedAt" TIMESTAMP(3),
ADD COLUMN "costCenterCode" TEXT,
ADD COLUMN "poNumber" TEXT;

CREATE TABLE "CorporateAccount" (
  "id" TEXT NOT NULL,
  "companyLegalName" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "contactEmail" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "monthlyRideVolume" INTEGER NOT NULL,
  "billingPreference" TEXT NOT NULL,
  "billingName" TEXT NOT NULL,
  "billingEmail" TEXT NOT NULL,
  "billingAddress" TEXT NOT NULL,
  "billingConsentAt" TIMESTAMP(3) NOT NULL,
  "billingConsentVersion" TEXT NOT NULL,
  "status" "CorporateAccountStatus" NOT NULL DEFAULT 'PENDING',
  "applicationTokenHash" TEXT NOT NULL,
  "applicationTokenExpiresAt" TIMESTAMP(3) NOT NULL,
  "stripeCustomerId" TEXT,
  "stripePaymentMethodId" TEXT,
  "stripeSetupSessionId" TEXT,
  "userId" TEXT,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  "credentialsExpiresAt" TIMESTAMP(3),
  "credentialsEmailStatus" TEXT NOT NULL DEFAULT 'NOT_SENT',
  "approvedAt" TIMESTAMP(3),
  "approvedById" TEXT,
  "rejectionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CorporateAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CorporateAccount_contactEmail_key" ON "CorporateAccount"("contactEmail");
CREATE UNIQUE INDEX "CorporateAccount_applicationTokenHash_key" ON "CorporateAccount"("applicationTokenHash");
CREATE UNIQUE INDEX "CorporateAccount_stripeCustomerId_key" ON "CorporateAccount"("stripeCustomerId");
CREATE UNIQUE INDEX "CorporateAccount_userId_key" ON "CorporateAccount"("userId");
CREATE INDEX "CorporateAccount_status_createdAt_idx" ON "CorporateAccount"("status", "createdAt");
CREATE INDEX "Inquiry_corporateAccountId_createdAt_idx" ON "Inquiry"("corporateAccountId", "createdAt");
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_corporateAccountId_fkey"
FOREIGN KEY ("corporateAccountId") REFERENCES "CorporateAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CorporateAccount" ADD CONSTRAINT "CorporateAccount_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
