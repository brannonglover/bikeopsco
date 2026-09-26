-- New WaitlistStatus for booking requests the spam scorer held back.
--
-- Kept in its own migration because a Postgres enum value cannot be *used* in
-- the transaction that adds it. Nothing here references the new value, and the
-- columns that go with it land in the next migration, once this has committed.

ALTER TYPE "WaitlistStatus" ADD VALUE 'HELD_FOR_REVIEW';
