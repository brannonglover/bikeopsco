-- Add booking capacity settings
ALTER TABLE "AppSettings"
ADD COLUMN     "bookingsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "maxActiveBikes" INTEGER NOT NULL DEFAULT 5;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'PROMOTED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "WaitlistEntry" (
  "id" TEXT NOT NULL,
  "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
  "customerId" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "address" TEXT,
  "deliveryType" "DeliveryType" NOT NULL DEFAULT 'DROP_OFF_AT_SHOP',
  "dropOffDate" TIMESTAMP(3),
  "pickupDate" TIMESTAMP(3),
  "collectionAddress" TEXT,
  "collectionWindowStart" TEXT,
  "collectionWindowEnd" TEXT,
  "customerNotes" TEXT,
  "serviceIds" JSONB DEFAULT '[]'::jsonb,
  "promotedJobId" TEXT,
  "promotedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WaitlistBike" (
  "id" TEXT NOT NULL,
  "waitlistEntryId" TEXT NOT NULL,
  "make" TEXT NOT NULL,
  "model" TEXT,
  "bikeType" "BikeType",
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WaitlistBike_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "WaitlistEntry"
ADD CONSTRAINT "WaitlistEntry_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry"
ADD CONSTRAINT "WaitlistEntry_promotedJobId_fkey"
FOREIGN KEY ("promotedJobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistBike"
ADD CONSTRAINT "WaitlistBike_waitlistEntryId_fkey"
FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WaitlistEntry_status_createdAt_idx" ON "WaitlistEntry"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WaitlistEntry_customerId_idx" ON "WaitlistEntry"("customerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WaitlistBike_waitlistEntryId_idx" ON "WaitlistBike"("waitlistEntryId");

