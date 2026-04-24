ALTER TABLE "Customer"
ADD COLUMN "smsConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "smsConsentSource" TEXT,
ADD COLUMN "smsConsentUpdatedAt" TIMESTAMP(3);
