-- Add Google Place ID for automatic review fetching via Places API
ALTER TABLE "ReviewSettings"
  ADD COLUMN IF NOT EXISTS "googlePlaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "googleRating"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "googleReviewCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "yelpRating"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "yelpReviewCount"   INTEGER,
  ADD COLUMN IF NOT EXISTS "featuredReviews"   JSONB NOT NULL DEFAULT '[]';
