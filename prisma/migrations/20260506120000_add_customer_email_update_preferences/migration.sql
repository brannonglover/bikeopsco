ALTER TABLE "Customer"
ADD COLUMN "emailUpdatesConsent" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "emailUpdatesConsentSource" TEXT,
ADD COLUMN "emailUpdatesConsentUpdatedAt" TIMESTAMP(3);
