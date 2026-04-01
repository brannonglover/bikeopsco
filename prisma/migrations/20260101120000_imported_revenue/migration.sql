-- CreateTable
CREATE TABLE "ImportedRevenue" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SQUARE',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "description" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedRevenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImportedRevenue_externalId_key" ON "ImportedRevenue"("externalId");

-- CreateIndex
CREATE INDEX "ImportedRevenue_occurredAt_idx" ON "ImportedRevenue"("occurredAt");

-- CreateIndex
CREATE INDEX "ImportedRevenue_source_idx" ON "ImportedRevenue"("source");
