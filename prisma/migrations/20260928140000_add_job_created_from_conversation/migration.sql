-- Where a job came from, when staff built it out of a chat thread.
--
-- Deliberately not reusing "Conversation"."jobId": a general conversation is
-- identified by jobId IS NULL throughout the app, so pointing it at a job
-- removes the thread from the inbox and causes an empty one to be created in
-- its place. This is a separate, nullable link in the other direction.
--
-- ON DELETE SET NULL: deleting a conversation must not take the job with it.

ALTER TABLE "Job" ADD COLUMN "createdFromConversationId" TEXT;

ALTER TABLE "Job"
  ADD CONSTRAINT "Job_createdFromConversationId_fkey"
  FOREIGN KEY ("createdFromConversationId") REFERENCES "Conversation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Job_createdFromConversationId_idx" ON "Job"("createdFromConversationId");
