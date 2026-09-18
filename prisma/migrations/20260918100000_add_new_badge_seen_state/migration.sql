-- AlterTable
ALTER TABLE "Customer" ADD COLUMN "provisionalSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Call" ADD COLUMN "staffSeenAt" TIMESTAMP(3);
