-- CreateEnum
CREATE TYPE "ChatReminderKind" AS ENUM ('NUDGE_CUSTOMER', 'NUDGE_STAFF');

-- CreateTable
CREATE TABLE "ChatReminderEmail" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" "ChatReminderKind" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatReminderEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatReminderEmail_conversationId_messageId_kind_key" ON "ChatReminderEmail"("conversationId", "messageId", "kind");

-- CreateIndex
CREATE INDEX "ChatReminderEmail_conversationId_idx" ON "ChatReminderEmail"("conversationId");

-- AddForeignKey
ALTER TABLE "ChatReminderEmail" ADD CONSTRAINT "ChatReminderEmail_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatReminderEmail" ADD CONSTRAINT "ChatReminderEmail_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
