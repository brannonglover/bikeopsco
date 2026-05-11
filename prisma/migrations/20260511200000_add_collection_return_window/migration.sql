ALTER TABLE "Job" ADD COLUMN "collectionReturnWindowStart" TEXT;
ALTER TABLE "Job" ADD COLUMN "collectionReturnWindowEnd" TEXT;

ALTER TABLE "WaitlistEntry" ADD COLUMN "collectionReturnWindowStart" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN "collectionReturnWindowEnd" TEXT;
