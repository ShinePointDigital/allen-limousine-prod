ALTER TABLE "AdminUser" ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Preserve existing staff access; new account permissions are explicit.
UPDATE "AdminUser" SET "permissions" = ARRAY['dashboard','rides','inquiries','services','fleet','content','settings','payments','export'] WHERE "role" = 'ADMIN';
ALTER TABLE "Inquiry" ADD COLUMN "customerUserId" TEXT;
CREATE INDEX "Inquiry_customerUserId_idx" ON "Inquiry"("customerUserId");
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
