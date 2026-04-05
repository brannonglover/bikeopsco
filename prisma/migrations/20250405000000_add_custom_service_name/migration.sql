-- AlterTable: make serviceId optional and add customServiceName
ALTER TABLE "JobService" ALTER COLUMN "serviceId" DROP NOT NULL;
ALTER TABLE "JobService" ADD COLUMN "customServiceName" TEXT;
