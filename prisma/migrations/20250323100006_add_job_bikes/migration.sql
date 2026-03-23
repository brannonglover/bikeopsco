-- CreateTable
CREATE TABLE "JobBike" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "nickname" TEXT,
    "imageUrl" TEXT,
    "bikeId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobBike_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobBike_jobId_idx" ON "JobBike"("jobId");

-- AddForeignKey
ALTER TABLE "JobBike" ADD CONSTRAINT "JobBike_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobBike" ADD CONSTRAINT "JobBike_bikeId_fkey" FOREIGN KEY ("bikeId") REFERENCES "Bike"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate existing jobs: create JobBike from bikeMake/bikeModel
INSERT INTO "JobBike" ("id", "jobId", "make", "model", "sortOrder", "createdAt")
SELECT 'jb' || replace(gen_random_uuid()::text, '-', ''), "id", "bikeMake", "bikeModel", 0, "createdAt"
FROM "Job";
