-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "aiVoiceEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "aiVoiceName" TEXT;

-- AlterTable
ALTER TABLE "Call" ADD COLUMN "aiAnsweredAt" TIMESTAMP(3),
ADD COLUMN "aiHandoffAt" TIMESTAMP(3),
ADD COLUMN "aiConversationId" TEXT,
ADD COLUMN "aiSummary" TEXT,
ADD COLUMN "aiTranscript" TEXT;
