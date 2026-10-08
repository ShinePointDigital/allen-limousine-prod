ALTER TABLE "Inquiry"
  ADD COLUMN "dispatchStep" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "dispatchStatus" TEXT NOT NULL DEFAULT 'NEW',
  ADD COLUMN "dispatchVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dispatchReviewedAt" TIMESTAMP(3);

CREATE TABLE "Chauffeur" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Chauffeur_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Chauffeur_phone_key" ON "Chauffeur"("phone");
ALTER TABLE "Ride" ADD COLUMN "driverId" TEXT;
ALTER TABLE "Ride" ADD CONSTRAINT "Ride_driverId_fkey"
  FOREIGN KEY ("driverId") REFERENCES "Chauffeur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Ride_driverId_status_idx" ON "Ride"("driverId", "status");
ALTER TABLE "DispatchMessage" ADD COLUMN "dispatchRecipient" TEXT;
CREATE INDEX "DispatchMessage_rideId_dispatchRecipient_status_idx"
  ON "DispatchMessage"("rideId", "dispatchRecipient", "status");

-- Preserve genuine, existing fleet driver defaults in the new roster.
INSERT INTO "Chauffeur" ("id", "name", "phone", "updatedAt")
SELECT DISTINCT ON (normalized_phone)
  'chauffeur-' || md5(normalized_phone), "defaultDriverName", normalized_phone, CURRENT_TIMESTAMP
FROM (
  SELECT *, CASE WHEN length(digits) = 10 THEN '+1' || digits ELSE '+' || digits END AS normalized_phone
  FROM (
    SELECT *, regexp_replace("defaultDriverPhone", '[^0-9]', '', 'g') AS digits
    FROM "FleetVehicle"
    WHERE "defaultDriverName" IS NOT NULL AND trim("defaultDriverName") <> ''
      AND "defaultDriverPhone" IS NOT NULL
  ) source
) normalized
WHERE normalized_phone ~ '^\+[1-9][0-9]{7,14}$'
ORDER BY normalized_phone, "sortOrder", "id";

UPDATE "Ride" r SET "driverId" = c."id"
FROM "Chauffeur" c
WHERE c."phone" = CASE
  WHEN length(regexp_replace(r."driverPhone", '[^0-9]', '', 'g')) = 10
    THEN '+1' || regexp_replace(r."driverPhone", '[^0-9]', '', 'g')
  ELSE '+' || regexp_replace(r."driverPhone", '[^0-9]', '', 'g') END;

-- Legacy assignments already completed the assignment step; do not invent a review timestamp.
UPDATE "Inquiry" i SET "dispatchStep" = 3, "dispatchStatus" = 'ASSIGNED'
FROM "Ride" r
WHERE r."inquiryId" = i."id" AND r."status" IN ('ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS')
  AND r."vehicleId" IS NOT NULL AND r."driverName" IS NOT NULL AND r."driverPhone" IS NOT NULL;
