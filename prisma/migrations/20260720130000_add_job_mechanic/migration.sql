-- AlterTable
ALTER TABLE "Job" ADD COLUMN "mechanicId" TEXT;

-- CreateIndex
CREATE INDEX "Job_mechanicId_idx" ON "Job"("mechanicId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_mechanicId_fkey" FOREIGN KEY ("mechanicId") REFERENCES "Mechanic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
