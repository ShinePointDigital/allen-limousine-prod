ALTER TABLE "Inquiry"
  ADD COLUMN "airlineName" TEXT,
  ADD COLUMN "flightStatus" TEXT,
  ADD COLUMN "arrivalTime" TIMESTAMP(3),
  ADD COLUMN "departureTime" TIMESTAMP(3),
  ADD COLUMN "arrivalTerminal" TEXT,
  ADD COLUMN "departureTerminal" TEXT,
  ADD COLUMN "baggageBelt" TEXT,
  ADD COLUMN "flightUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "flightDetails" JSONB;
