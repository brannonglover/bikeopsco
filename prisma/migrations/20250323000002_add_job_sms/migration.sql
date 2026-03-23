-- CreateTable
CREATE TABLE "JobSms" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "templateSlug" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipient" TEXT NOT NULL,

    CONSTRAINT "JobSms_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "JobSms" ADD CONSTRAINT "JobSms_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
