ALTER TABLE "Ride" ADD COLUMN "driverAccessNonce" TEXT,
ADD COLUMN "driverAccessTokenHash" TEXT,
ADD COLUMN "driverAccessExpiresAt" TIMESTAMP(3),
ADD COLUMN "driverAccessAssignment" TEXT;
CREATE UNIQUE INDEX "Ride_driverAccessTokenHash_key" ON "Ride"("driverAccessTokenHash");
