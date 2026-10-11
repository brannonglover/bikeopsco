-- AlterTable
-- "cancellationReason" becomes the internal-only record; this column holds the
-- optional customer-facing explanation shown on the status page and in email.
ALTER TABLE "Job" ADD COLUMN "customerCancellationMessage" TEXT;
