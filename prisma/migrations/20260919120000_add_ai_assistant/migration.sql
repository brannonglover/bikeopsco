-- AI assistant: shop-level settings, per-conversation kill switch, and the
-- provenance flags that let staff tell an assistant reply from their own.

CREATE TYPE "AiAssistantState" AS ENUM ('OFF', 'ACTIVE', 'PAUSED', 'DONE');

ALTER TABLE "AppSettings"
  ADD COLUMN "aiAssistantEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aiAssistantWebsiteUrl" TEXT,
  ADD COLUMN "aiAssistantKnowledge" TEXT,
  ADD COLUMN "aiAssistantKnowledgeAt" TIMESTAMP(3);

ALTER TABLE "Conversation"
  ADD COLUMN "aiAssistantState" "AiAssistantState" NOT NULL DEFAULT 'OFF',
  ADD COLUMN "aiAssistantSummary" TEXT;

ALTER TABLE "Message"
  ADD COLUMN "aiGenerated" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Call"
  ADD COLUMN "aiOutreachAt" TIMESTAMP(3);
