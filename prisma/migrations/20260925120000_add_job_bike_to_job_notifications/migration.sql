-- Bike-level customer notifications: a parts hold is bike-level state, so one bike of a
-- multi-bike job can be notified on without the job stage moving. Scoping the sent-history
-- rows to a bike keeps per-job dedup working per bike instead of collapsing to one send.

ALTER TABLE "JobEmail" ADD COLUMN "jobBikeId" TEXT;
ALTER TABLE "JobSms" ADD COLUMN "jobBikeId" TEXT;

CREATE INDEX "JobEmail_jobBikeId_idx" ON "JobEmail"("jobBikeId");
CREATE INDEX "JobSms_jobBikeId_idx" ON "JobSms"("jobBikeId");

ALTER TABLE "JobEmail" ADD CONSTRAINT "JobEmail_jobBikeId_fkey"
  FOREIGN KEY ("jobBikeId") REFERENCES "JobBike"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "JobSms" ADD CONSTRAINT "JobSms_jobBikeId_fkey"
  FOREIGN KEY ("jobBikeId") REFERENCES "JobBike"("id") ON DELETE SET NULL ON UPDATE CASCADE;
