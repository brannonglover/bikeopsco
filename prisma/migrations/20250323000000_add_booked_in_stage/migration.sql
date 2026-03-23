-- AlterEnum: Add BOOKED_IN as first value in Stage enum
ALTER TYPE "Stage" ADD VALUE IF NOT EXISTS 'BOOKED_IN' BEFORE 'RECEIVED';
