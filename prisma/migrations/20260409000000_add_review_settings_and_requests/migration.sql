-- CreateTable
CREATE TABLE "ReviewSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "googleReviewUrl" TEXT,
    "yelpReviewUrl" TEXT,

    CONSTRAINT "ReviewSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewRequest" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customerId" TEXT,
    "jobId" TEXT,
    "recipientEmail" TEXT NOT NULL,
    "recipientName" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "googleClickedAt" TIMESTAMP(3),
    "yelpClickedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReviewRequest_token_key" ON "ReviewRequest"("token");

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
