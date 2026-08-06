-- CreateEnum
CREATE TYPE "RentalCategory" AS ENUM ('MOUNTAIN', 'HYBRID', 'ROAD', 'ELECTRIC', 'OTHER');

-- CreateEnum
CREATE TYPE "RentalReservationStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'CONFIRMED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "RentalBike" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "category" "RentalCategory" NOT NULL DEFAULT 'MOUNTAIN',
    "size" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalBike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalRate" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "category" "RentalCategory",
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalAddon" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalAddon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalReservation" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "customerPhone" TEXT,
    "rentalBikeId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "status" "RentalReservationStatus" NOT NULL DEFAULT 'REQUESTED',
    "pickupTime" TEXT,
    "notes" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RentalReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RentalActivity" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RentalActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RentalBike_shopId_idx" ON "RentalBike"("shopId");

-- CreateIndex
CREATE INDEX "RentalBike_shopId_category_idx" ON "RentalBike"("shopId", "category");

-- CreateIndex
CREATE INDEX "RentalRate_shopId_idx" ON "RentalRate"("shopId");

-- CreateIndex
CREATE INDEX "RentalAddon_shopId_idx" ON "RentalAddon"("shopId");

-- CreateIndex
CREATE INDEX "RentalReservation_shopId_idx" ON "RentalReservation"("shopId");

-- CreateIndex
CREATE INDEX "RentalReservation_rentalBikeId_idx" ON "RentalReservation"("rentalBikeId");

-- CreateIndex
CREATE INDEX "RentalReservation_customerId_idx" ON "RentalReservation"("customerId");

-- CreateIndex
CREATE INDEX "RentalReservation_shopId_startDate_endDate_idx" ON "RentalReservation"("shopId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "RentalReservation_shopId_status_idx" ON "RentalReservation"("shopId", "status");

-- CreateIndex
CREATE INDEX "RentalActivity_shopId_createdAt_idx" ON "RentalActivity"("shopId", "createdAt");

-- AddForeignKey
ALTER TABLE "RentalBike" ADD CONSTRAINT "RentalBike_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalRate" ADD CONSTRAINT "RentalRate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalAddon" ADD CONSTRAINT "RentalAddon_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalReservation" ADD CONSTRAINT "RentalReservation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalReservation" ADD CONSTRAINT "RentalReservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalReservation" ADD CONSTRAINT "RentalReservation_rentalBikeId_fkey" FOREIGN KEY ("rentalBikeId") REFERENCES "RentalBike"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RentalActivity" ADD CONSTRAINT "RentalActivity_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
