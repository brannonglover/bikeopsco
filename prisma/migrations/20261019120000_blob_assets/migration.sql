-- CreateTable
CREATE TABLE "BlobAsset" (
    "id" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "customerId" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlobAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlobAsset_pathname_key" ON "BlobAsset"("pathname");

-- CreateIndex
CREATE INDEX "BlobAsset_shopId_idx" ON "BlobAsset"("shopId");

-- AddForeignKey
ALTER TABLE "BlobAsset" ADD CONSTRAINT "BlobAsset_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
