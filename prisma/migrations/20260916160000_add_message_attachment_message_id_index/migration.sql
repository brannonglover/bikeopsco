-- Prisma resolves `include: { attachments: true }` as a WHERE "messageId" IN (...)
-- lookup. Without this index that relation load was a sequential scan on every
-- message page fetch and every SSE payload rebuild.
-- CreateIndex
CREATE INDEX "MessageAttachment_messageId_idx" ON "MessageAttachment"("messageId");
