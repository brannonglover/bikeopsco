/*
  Backfill the new AppSettings collection fee fields from existing system Service prices.

  Only updates when AppSettings is still at the default values (20/30) to avoid clobbering
  any values already customized via Settings.
*/

UPDATE "AppSettings" a
SET "collectionFeeRegular" = s."price"
FROM "Service" s
WHERE a."id" = 'default'
  AND a."collectionFeeRegular" = 20
  AND s."slug" = 'collection_pickup_5mi';

UPDATE "AppSettings" a
SET "collectionFeeEbike" = s."price"
FROM "Service" s
WHERE a."id" = 'default'
  AND a."collectionFeeEbike" = 30
  AND s."slug" = 'collection_pickup_5mi_ebike';

