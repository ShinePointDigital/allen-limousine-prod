ALTER TABLE "Inquiry"
ADD COLUMN "isPrivateFBO" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "specificTailNumber" TEXT,
ADD COLUMN "principalName" TEXT,
ADD COLUMN "fboName" TEXT,
ADD COLUMN "tarmacInstructions" TEXT;