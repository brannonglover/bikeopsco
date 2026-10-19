-- CreateEnum
CREATE TYPE "ComponentReplacementState" AS ENUM ('NONE', 'PLANNED', 'INSTALLED');

-- CreateEnum
CREATE TYPE "BikeComponentRecordKind" AS ENUM ('INSTALLED', 'OBSERVED');

-- AlterTable
ALTER TABLE "Bike" ADD COLUMN     "catalogConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "catalogConfirmedBy" TEXT,
ADD COLUMN     "catalogConfirmedJobId" TEXT;

-- AlterTable
ALTER TABLE "JobBikeComponentOverride" ADD COLUMN     "replacementInstalledAt" TIMESTAMP(3),
ADD COLUMN     "replacementState" "ComponentReplacementState" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "replacementValue" TEXT,
ADD COLUMN     "updatedBy" TEXT;

-- CreateTable
CREATE TABLE "BikeInstalledComponent" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "kind" "BikeComponentRecordKind" NOT NULL,
    "notes" TEXT,
    "jobId" TEXT,
    "jobBikeId" TEXT,
    "overrideId" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BikeInstalledComponent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BikeInstalledComponent_overrideId_key" ON "BikeInstalledComponent"("overrideId");

-- CreateIndex
CREATE INDEX "BikeInstalledComponent_bikeId_slot_idx" ON "BikeInstalledComponent"("bikeId", "slot");

-- CreateIndex
CREATE INDEX "BikeInstalledComponent_shopId_idx" ON "BikeInstalledComponent"("shopId");

-- CreateIndex
CREATE INDEX "BikeInstalledComponent_jobId_idx" ON "BikeInstalledComponent"("jobId");

-- AddForeignKey
ALTER TABLE "BikeInstalledComponent" ADD CONSTRAINT "BikeInstalledComponent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikeInstalledComponent" ADD CONSTRAINT "BikeInstalledComponent_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BikeInstalledComponent" ADD CONSTRAINT "BikeInstalledComponent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

