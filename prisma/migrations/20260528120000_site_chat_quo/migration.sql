-- CreateEnum
CREATE TYPE "SiteChatSender" AS ENUM ('VISITOR', 'STAFF');

-- CreateEnum
CREATE TYPE "SiteChatMessageSource" AS ENUM ('WIDGET', 'QUO');

-- CreateTable
CREATE TABLE "SiteChatConversation" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "visitorName" TEXT NOT NULL,
    "visitorPhone" TEXT NOT NULL,
    "smsConsent" BOOLEAN NOT NULL DEFAULT false,
    "smsConsentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "SiteChatSender" NOT NULL,
    "body" TEXT NOT NULL,
    "quoMessageId" TEXT,
    "source" "SiteChatMessageSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteChatConversation_sessionToken_key" ON "SiteChatConversation"("sessionToken");

-- CreateIndex
CREATE INDEX "SiteChatConversation_visitorPhone_idx" ON "SiteChatConversation"("visitorPhone");

-- CreateIndex
CREATE UNIQUE INDEX "SiteChatMessage_quoMessageId_key" ON "SiteChatMessage"("quoMessageId");

-- CreateIndex
CREATE INDEX "SiteChatMessage_conversationId_createdAt_idx" ON "SiteChatMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "SiteChatMessage" ADD CONSTRAINT "SiteChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SiteChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
