-- Hold suspected spam bookings for review instead of letting them onto the board.
--
-- In September 2026 an automated form filler submitted bookings with random
-- letters in every field. They carried valid Turnstile tokens, so the CAPTCHA
-- never saw them as bots; they landed in Pending approval, created Customer
-- rows, and triggered staff notifications plus a confirmation email to whatever
-- address they supplied.
--
-- A held booking reuses WaitlistEntry because the shape is already exactly
-- right — full contact snapshot, bikes, services, dates — and releasing one is
-- the same work as promoting off the waitlist. It gets its own status so it
-- stays out of every existing waitlist query, all of which filter on WAITING.
-- The status value itself is added in the preceding migration.

ALTER TABLE "WaitlistEntry" ADD COLUMN "spamScore" INTEGER;
ALTER TABLE "WaitlistEntry" ADD COLUMN "spamSignals" JSONB;
ALTER TABLE "WaitlistEntry" ADD COLUMN "submittedIp" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN "submittedUserAgent" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN "reviewedAt" TIMESTAMP(3);

-- The review screen reads "entries for this shop with this status, newest
-- first", which the existing (status, createdAt) index cannot serve without
-- scanning other shops' rows.
CREATE INDEX "WaitlistEntry_shopId_status_createdAt_idx"
  ON "WaitlistEntry"("shopId", "status", "createdAt");
