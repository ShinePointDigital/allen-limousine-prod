-- Store optional driver details with each fleet vehicle so ride assignments can be pre-filled.
ALTER TABLE "FleetVehicle" ADD COLUMN "defaultDriverName" TEXT;
ALTER TABLE "FleetVehicle" ADD COLUMN "defaultDriverPhone" TEXT;