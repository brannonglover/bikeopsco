-- AlterTable
ALTER TABLE "Shop"
  ADD COLUMN "billingProvider" TEXT,
  ADD COLUMN "appleOriginalTransactionId" TEXT,
  ADD COLUMN "appleProductId" TEXT,
  ADD COLUMN "appleCurrentPeriodEnd" TIMESTAMP(3),
  ADD COLUMN "appleSubscriptionUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_appleOriginalTransactionId_key" ON "Shop"("appleOriginalTransactionId");
