-- Track when a bike was received at the shop for FCFS service queue ordering.
ALTER TABLE "Job" ADD COLUMN "receivedAt" TIMESTAMP(3);

UPDATE "Job"
SET "receivedAt" = "updatedAt"
WHERE "stage" = 'RECEIVED' AND "receivedAt" IS NULL;
