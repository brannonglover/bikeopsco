-- CreateEnum
CREATE TYPE "BikeType" AS ENUM ('REGULAR', 'E_BIKE');

-- AlterTable
ALTER TABLE "Bike" ADD COLUMN "bikeType" "BikeType";

-- AlterTable
ALTER TABLE "JobBike" ADD COLUMN "bikeType" "BikeType";

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "slug" TEXT,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Service_slug_key" ON "Service"("slug");

-- Backfill JobBike for legacy widget jobs that only had bikeMake/bikeModel on Job
INSERT INTO "JobBike" ("id", "jobId", "make", "model", "sortOrder", "createdAt")
SELECT 'jb' || replace(gen_random_uuid()::text, '-', ''), j."id", j."bikeMake", j."bikeModel", 0, j."createdAt"
FROM "Job" j
WHERE NOT EXISTS (SELECT 1 FROM "JobBike" jb WHERE jb."jobId" = j."id");
