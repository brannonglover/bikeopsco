-- Multi-tenant: introduce shops and scope all data by shopId.
--
-- Data safety:
-- - No tables are dropped.
-- - All existing rows are assigned to a default shop ("shop_default").
-- - Global uniques (email/slug/etc) are replaced with shop-scoped uniques.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Shop" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "subdomain" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Shop_subdomain_key" ON "Shop"("subdomain");

-- Seed default shop (existing data will belong here)
INSERT INTO "Shop" ("id", "name", "subdomain", "createdAt", "updatedAt")
VALUES ('shop_default', 'Basement Bike Mechanic', 'bbm', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE
SET "name" = EXCLUDED."name",
    "subdomain" = EXCLUDED."subdomain",
    "updatedAt" = EXCLUDED."updatedAt";

-- Allow multiple settings rows (one per shop)
ALTER TABLE "AppSettings" ALTER COLUMN "id" DROP DEFAULT;
ALTER TABLE "ReviewSettings" ALTER COLUMN "id" DROP DEFAULT;

-- DropIndex (global uniques that become shop-scoped)
DROP INDEX IF EXISTS "EmailTemplate_slug_key";
DROP INDEX IF EXISTS "ImportedRevenue_externalId_key";
DROP INDEX IF EXISTS "Message_smsSid_key";
DROP INDEX IF EXISTS "Payment_stripePaymentIntentId_key";
DROP INDEX IF EXISTS "Service_slug_key";
DROP INDEX IF EXISTS "User_email_key";

-- Add shopId columns (backfill existing rows to the default shop)
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "Bike" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "ChatReminderEmail" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "ChatSession" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "EmailTemplate" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "ImportedRevenue" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "JobBike" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "JobEmail" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "JobProduct" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "JobService" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "JobSms" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "MagicLinkToken" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "MessageAttachment" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "MessageReaction" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "PushToken" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "ReviewRequest" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "ReviewSettings" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "WaitlistBike" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "shopId" TEXT NOT NULL DEFAULT 'shop_default';

-- Enforce that new writes always specify shopId explicitly
ALTER TABLE "AppSettings" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Bike" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "ChatReminderEmail" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "ChatSession" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Conversation" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Customer" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "EmailTemplate" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "ImportedRevenue" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Job" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "JobBike" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "JobEmail" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "JobProduct" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "JobService" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "JobSms" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "MagicLinkToken" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Message" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "MessageAttachment" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "MessageReaction" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Product" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "PushToken" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "ReviewRequest" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "ReviewSettings" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "Service" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "WaitlistBike" ALTER COLUMN "shopId" DROP DEFAULT;
ALTER TABLE "WaitlistEntry" ALTER COLUMN "shopId" DROP DEFAULT;

-- CreateIndex / CreateUniqueIndex
CREATE INDEX IF NOT EXISTS "AppSettings_shopId_idx" ON "AppSettings"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "AppSettings_shopId_key" ON "AppSettings"("shopId");

CREATE INDEX IF NOT EXISTS "Bike_shopId_idx" ON "Bike"("shopId");
CREATE INDEX IF NOT EXISTS "ChatReminderEmail_shopId_idx" ON "ChatReminderEmail"("shopId");
CREATE INDEX IF NOT EXISTS "ChatSession_shopId_idx" ON "ChatSession"("shopId");
CREATE INDEX IF NOT EXISTS "Conversation_shopId_idx" ON "Conversation"("shopId");
CREATE INDEX IF NOT EXISTS "Customer_shopId_idx" ON "Customer"("shopId");

CREATE INDEX IF NOT EXISTS "EmailTemplate_shopId_idx" ON "EmailTemplate"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "EmailTemplate_shopId_slug_key" ON "EmailTemplate"("shopId", "slug");

CREATE INDEX IF NOT EXISTS "ImportedRevenue_shopId_idx" ON "ImportedRevenue"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "ImportedRevenue_shopId_externalId_key" ON "ImportedRevenue"("shopId", "externalId");

CREATE INDEX IF NOT EXISTS "Job_shopId_idx" ON "Job"("shopId");
CREATE INDEX IF NOT EXISTS "JobBike_shopId_idx" ON "JobBike"("shopId");
CREATE INDEX IF NOT EXISTS "JobEmail_shopId_idx" ON "JobEmail"("shopId");
CREATE INDEX IF NOT EXISTS "JobProduct_shopId_idx" ON "JobProduct"("shopId");
CREATE INDEX IF NOT EXISTS "JobService_shopId_idx" ON "JobService"("shopId");
CREATE INDEX IF NOT EXISTS "JobSms_shopId_idx" ON "JobSms"("shopId");

CREATE INDEX IF NOT EXISTS "MagicLinkToken_shopId_idx" ON "MagicLinkToken"("shopId");

CREATE INDEX IF NOT EXISTS "Message_shopId_idx" ON "Message"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "Message_shopId_smsSid_key" ON "Message"("shopId", "smsSid");

CREATE INDEX IF NOT EXISTS "MessageAttachment_shopId_idx" ON "MessageAttachment"("shopId");
CREATE INDEX IF NOT EXISTS "MessageReaction_shopId_idx" ON "MessageReaction"("shopId");

CREATE INDEX IF NOT EXISTS "Payment_shopId_idx" ON "Payment"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "Payment_shopId_stripePaymentIntentId_key" ON "Payment"("shopId", "stripePaymentIntentId");

CREATE INDEX IF NOT EXISTS "Product_shopId_idx" ON "Product"("shopId");
CREATE INDEX IF NOT EXISTS "PushToken_shopId_idx" ON "PushToken"("shopId");
CREATE INDEX IF NOT EXISTS "ReviewRequest_shopId_idx" ON "ReviewRequest"("shopId");

CREATE INDEX IF NOT EXISTS "ReviewSettings_shopId_idx" ON "ReviewSettings"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "ReviewSettings_shopId_key" ON "ReviewSettings"("shopId");

CREATE INDEX IF NOT EXISTS "Service_shopId_idx" ON "Service"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "Service_shopId_slug_key" ON "Service"("shopId", "slug");

CREATE INDEX IF NOT EXISTS "User_shopId_idx" ON "User"("shopId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_shopId_email_key" ON "User"("shopId", "email");

CREATE INDEX IF NOT EXISTS "WaitlistBike_shopId_idx" ON "WaitlistBike"("shopId");
CREATE INDEX IF NOT EXISTS "WaitlistEntry_shopId_idx" ON "WaitlistEntry"("shopId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Bike" ADD CONSTRAINT "Bike_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobBike" ADD CONSTRAINT "JobBike_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Job" ADD CONSTRAINT "Job_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Service" ADD CONSTRAINT "Service_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobService" ADD CONSTRAINT "JobService_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobEmail" ADD CONSTRAINT "JobEmail_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobSms" ADD CONSTRAINT "JobSms_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobProduct" ADD CONSTRAINT "JobProduct_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatReminderEmail" ADD CONSTRAINT "ChatReminderEmail_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "User" ADD CONSTRAINT "User_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MagicLinkToken" ADD CONSTRAINT "MagicLinkToken_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewSettings" ADD CONSTRAINT "ReviewSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaitlistBike" ADD CONSTRAINT "WaitlistBike_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReviewRequest" ADD CONSTRAINT "ReviewRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportedRevenue" ADD CONSTRAINT "ImportedRevenue_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
