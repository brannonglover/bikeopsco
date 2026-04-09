-- Add rating, review count, and featured reviews to ReviewSettings
ALTER TABLE "ReviewSettings"
  ADD COLUMN "googleRating"      DOUBLE PRECISION,
  ADD COLUMN "googleReviewCount" INTEGER,
  ADD COLUMN "yelpRating"        DOUBLE PRECISION,
  ADD COLUMN "yelpReviewCount"   INTEGER,
  ADD COLUMN "featuredReviews"   JSONB NOT NULL DEFAULT '[]';
