ALTER TABLE "Inquiry"
ADD COLUMN "trackingTokenHash" TEXT,
ADD COLUMN "trackingExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Inquiry_trackingTokenHash_key" ON "Inquiry"("trackingTokenHash");

ALTER TABLE "Ride"
ADD COLUMN "driverLatitude" DOUBLE PRECISION,
ADD COLUMN "driverLongitude" DOUBLE PRECISION,
ADD COLUMN "driverHeading" DOUBLE PRECISION,
ADD COLUMN "locationUpdatedAt" TIMESTAMP(3);