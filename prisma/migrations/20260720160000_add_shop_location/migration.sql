-- AlterTable
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "address" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;

-- Seed Basement Bike Mechanic (bbm) public location for nearby search.
UPDATE "Shop"
SET
  "address" = '2272 Melinda Dr NE, Atlanta, GA 30345',
  "latitude" = 33.855,
  "longitude" = -84.285,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "subdomain" = 'bbm'
  AND ("latitude" IS NULL OR "longitude" IS NULL);
