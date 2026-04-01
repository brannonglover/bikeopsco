-- AlterTable
ALTER TABLE "Job" ADD COLUMN "workingOnJobBikeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Job_workingOnJobBikeId_key" ON "Job"("workingOnJobBikeId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_workingOnJobBikeId_fkey" FOREIGN KEY ("workingOnJobBikeId") REFERENCES "JobBike"("id") ON DELETE SET NULL ON UPDATE CASCADE;
