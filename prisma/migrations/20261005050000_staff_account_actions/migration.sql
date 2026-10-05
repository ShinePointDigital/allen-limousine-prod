-- Staff accounts can be removed without deleting operational history.
ALTER TABLE "InquiryNote" ADD COLUMN "authorName" TEXT;
ALTER TABLE "InquiryNote" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "InquiryNote" DROP CONSTRAINT "InquiryNote_authorId_fkey";
ALTER TABLE "InquiryNote" ADD CONSTRAINT "InquiryNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DispatchMessage" ADD COLUMN "adminName" TEXT;
ALTER TABLE "DispatchMessage" ADD COLUMN "reconciledByName" TEXT;
ALTER TABLE "DispatchMessage" ALTER COLUMN "adminId" DROP NOT NULL;
ALTER TABLE "DispatchMessage" DROP CONSTRAINT "DispatchMessage_adminId_fkey";
ALTER TABLE "DispatchMessage" ADD CONSTRAINT "DispatchMessage_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
