-- CreateIndex
CREATE INDEX "Job_shopId_archivedAt_stage_idx" ON "Job"("shopId", "archivedAt", "stage");

-- CreateIndex
CREATE INDEX "JobService_jobId_idx" ON "JobService"("jobId");

-- CreateIndex
CREATE INDEX "JobProduct_jobId_idx" ON "JobProduct"("jobId");

-- CreateIndex
CREATE INDEX "Payment_jobId_idx" ON "Payment"("jobId");
