ALTER TABLE "Inquiry"
ADD COLUMN "airportCode" TEXT,
ADD COLUMN "airportTerminal" TEXT,
ADD COLUMN "flightNumber" TEXT,
ADD COLUMN "flightScheduledAt" TIMESTAMP(3),
ADD COLUMN "pickupPreference" TEXT;