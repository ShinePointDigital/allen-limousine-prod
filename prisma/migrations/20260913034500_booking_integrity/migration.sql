ALTER TABLE "Inquiry"
ADD COLUMN "grossFareCents" INTEGER,
ADD COLUMN "bookingRequestId" TEXT;

CREATE UNIQUE INDEX "Inquiry_bookingRequestId_key" ON "Inquiry"("bookingRequestId");