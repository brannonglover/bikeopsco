-- AlterEnum: Add WAITING_ON_CUSTOMER stage for jobs awaiting customer approval/response
ALTER TYPE "Stage" ADD VALUE IF NOT EXISTS 'WAITING_ON_CUSTOMER' BEFORE 'WAITING_ON_PARTS';
