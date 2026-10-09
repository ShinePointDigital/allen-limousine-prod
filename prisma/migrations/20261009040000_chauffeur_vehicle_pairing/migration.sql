ALTER TABLE "Chauffeur"
  ADD COLUMN "fleetVehicleId" TEXT;

CREATE UNIQUE INDEX "Chauffeur_fleetVehicleId_key"
  ON "Chauffeur"("fleetVehicleId");

ALTER TABLE "Chauffeur"
  ADD CONSTRAINT "Chauffeur_fleetVehicleId_fkey"
  FOREIGN KEY ("fleetVehicleId") REFERENCES "FleetVehicle"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
