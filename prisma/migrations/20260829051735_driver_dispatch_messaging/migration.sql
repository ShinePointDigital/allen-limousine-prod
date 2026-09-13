-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "driverPhone" TEXT;

-- CreateTable
CREATE TABLE "DispatchMessage" (
    "id" TEXT NOT NULL,
    "rideId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DispatchMessage_rideId_createdAt_idx" ON "DispatchMessage"("rideId", "createdAt");

-- CreateIndex
CREATE INDEX "DispatchMessage_status_createdAt_idx" ON "DispatchMessage"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "DispatchMessage" ADD CONSTRAINT "DispatchMessage_rideId_fkey" FOREIGN KEY ("rideId") REFERENCES "Ride"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchMessage" ADD CONSTRAINT "DispatchMessage_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
