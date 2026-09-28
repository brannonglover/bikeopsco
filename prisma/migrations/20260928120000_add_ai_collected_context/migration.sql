-- Structured record of what the AI assistant collected from a conversation:
-- the customer's name and email, the bikes they described, the symptoms they
-- reported, what they suspect and what they asked for.
--
-- Until now the only durable trace of a collected detail was the value itself,
-- written onto the customer row, and one prose line in aiAssistantSummary.
-- That loses which layer a value came from, and loses everything the customer
-- row has no column for. Nullable with no default: a conversation the
-- assistant never handled simply has none.

ALTER TABLE "Conversation" ADD COLUMN "aiCollectedContext" JSONB;
