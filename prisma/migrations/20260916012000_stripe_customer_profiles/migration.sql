CREATE TABLE "StripeCustomerProfile" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeCustomerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeCustomerProfile_email_key" ON "StripeCustomerProfile"("email");
CREATE UNIQUE INDEX "StripeCustomerProfile_stripeCustomerId_key" ON "StripeCustomerProfile"("stripeCustomerId");