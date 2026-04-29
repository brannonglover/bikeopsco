ALTER TABLE "Shop"
  ADD COLUMN "billingStatus" TEXT NOT NULL DEFAULT 'trialing',
  ADD COLUMN "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN "stripeCustomerId" TEXT,
  ADD COLUMN "stripeSubscriptionId" TEXT,
  ADD COLUMN "stripePriceId" TEXT,
  ADD COLUMN "stripeCurrentPeriodEnd" TIMESTAMP(3),
  ADD COLUMN "stripeCancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripeSubscriptionUpdatedAt" TIMESTAMP(3);

UPDATE "Shop"
SET "trialEndsAt" = COALESCE("trialEndsAt", "createdAt" + INTERVAL '14 days')
WHERE "billingStatus" = 'trialing';

CREATE UNIQUE INDEX "Shop_stripeCustomerId_key" ON "Shop"("stripeCustomerId");
CREATE UNIQUE INDEX "Shop_stripeSubscriptionId_key" ON "Shop"("stripeSubscriptionId");
