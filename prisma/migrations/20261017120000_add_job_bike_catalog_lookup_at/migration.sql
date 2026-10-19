-- AlterTable
ALTER TABLE "JobBike" ADD COLUMN "catalogLookupAt" TIMESTAMP(3),
ADD COLUMN "catalogLookupAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "catalogLookupNextAt" TIMESTAMP(3);

-- Finished jobs don't need a parts lookup. Bikes on active jobs are left owed
-- so the sweep can enrich them (it only looks at bikes from the last 14 days,
-- within the daily lookup budget).
UPDATE "JobBike" AS jb
SET "catalogLookupAt" = CURRENT_TIMESTAMP
FROM "Job" AS j
WHERE jb."jobId" = j."id" AND j."stage" IN ('COMPLETED', 'CANCELLED');
