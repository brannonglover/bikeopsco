ALTER TABLE "Message" ADD COLUMN "smsProvider" TEXT;
ALTER TABLE "Message" ADD COLUMN "smsDeliveryStatus" TEXT;
ALTER TABLE "Message" ADD COLUMN "smsDeliveryStatusName" TEXT;
ALTER TABLE "Message" ADD COLUMN "smsDeliveryStatusDescription" TEXT;
ALTER TABLE "Message" ADD COLUMN "smsDeliveryError" TEXT;
ALTER TABLE "Message" ADD COLUMN "smsDeliveredAt" TIMESTAMP(3);
