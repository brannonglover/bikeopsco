-- Set default stage for new jobs to BOOKED_IN
ALTER TABLE "Job" ALTER COLUMN "stage" SET DEFAULT 'BOOKED_IN';
