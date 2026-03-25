-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;
