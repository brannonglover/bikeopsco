-- AlterTable Bike: add year + catalogBikeId
ALTER TABLE "Bike" ADD COLUMN "year" INTEGER;
ALTER TABLE "Bike" ADD COLUMN "catalogBikeId" TEXT;

-- AlterTable JobBike: replace 99 Spokes cache with catalog match + year
ALTER TABLE "JobBike" ADD COLUMN "year" INTEGER;
ALTER TABLE "JobBike" ADD COLUMN "catalogBikeId" TEXT;
ALTER TABLE "JobBike" ADD COLUMN "catalogMatchedAt" TIMESTAMP(3);

ALTER TABLE "JobBike" DROP COLUMN IF EXISTS "ninetyNineSpokesId";
ALTER TABLE "JobBike" DROP COLUMN IF EXISTS "ninetyNineSpokesSpecs";
ALTER TABLE "JobBike" DROP COLUMN IF EXISTS "ninetyNineSpokesSpecsFetchedAt";

CREATE INDEX "Bike_catalogBikeId_idx" ON "Bike"("catalogBikeId");
CREATE INDEX "JobBike_catalogBikeId_idx" ON "JobBike"("catalogBikeId");

-- CreateEnum
CREATE TYPE "ComponentConfirmation" AS ENUM ('UNREVIEWED', 'MATCHES_CATALOG', 'CUSTOMIZED');

-- CreateTable
CREATE TABLE "JobBikeComponentOverride" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "jobBikeId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "confirmation" "ComponentConfirmation" NOT NULL DEFAULT 'UNREVIEWED',
    "customValue" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobBikeComponentOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JobBikeComponentOverride_jobBikeId_slot_key" ON "JobBikeComponentOverride"("jobBikeId", "slot");
CREATE INDEX "JobBikeComponentOverride_shopId_idx" ON "JobBikeComponentOverride"("shopId");
CREATE INDEX "JobBikeComponentOverride_jobBikeId_idx" ON "JobBikeComponentOverride"("jobBikeId");

ALTER TABLE "JobBikeComponentOverride" ADD CONSTRAINT "JobBikeComponentOverride_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobBikeComponentOverride" ADD CONSTRAINT "JobBikeComponentOverride_jobBikeId_fkey" FOREIGN KEY ("jobBikeId") REFERENCES "JobBike"("id") ON DELETE CASCADE ON UPDATE CASCADE;
