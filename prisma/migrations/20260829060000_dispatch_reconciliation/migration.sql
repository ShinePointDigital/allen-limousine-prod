-- Preserve the provider's last known state and the administrator who resolved an uncertain dispatch.
ALTER TABLE "DispatchMessage"
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "deliveryStatus" TEXT,
  ADD COLUMN "reconciledAt" TIMESTAMP(3),
  ADD COLUMN "reconciledById" TEXT;

ALTER TABLE "DispatchMessage"
  ADD CONSTRAINT "DispatchMessage_reconciledById_fkey"
  FOREIGN KEY ("reconciledById") REFERENCES "AdminUser"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "DispatchMessage_providerMessageId_idx"
  ON "DispatchMessage"("providerMessageId");