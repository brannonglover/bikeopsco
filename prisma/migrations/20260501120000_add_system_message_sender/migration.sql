-- Add system-generated chat messages for automated outbound updates.
ALTER TYPE "MessageSender" ADD VALUE IF NOT EXISTS 'SYSTEM';
