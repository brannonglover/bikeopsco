-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN     "collectionRadiusMiles" DOUBLE PRECISION NOT NULL DEFAULT 5;
ALTER TABLE "AppSettings" ADD COLUMN     "collectionFeeRegular" DECIMAL(10,2) NOT NULL DEFAULT 20;
ALTER TABLE "AppSettings" ADD COLUMN     "collectionFeeEbike" DECIMAL(10,2) NOT NULL DEFAULT 30;

