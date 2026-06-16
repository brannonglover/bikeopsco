-- db:seed:staging previously set notifyCustomerEnabled=false on the default shop when run against the shared production database.
-- Re-enable the shop master switch; preview/staging deploys still block sends via env guards.
UPDATE "AppSettings"
SET "notifyCustomerEnabled" = true
WHERE "shopId" = 'shop_default' AND "notifyCustomerEnabled" = false;
