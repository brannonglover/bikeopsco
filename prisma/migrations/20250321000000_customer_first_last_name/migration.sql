-- AlterTable: Replace Customer.name with firstName and lastName
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "lastName" TEXT;

-- Migrate existing data: split name on first space
UPDATE "Customer" SET 
  "firstName" = CASE 
    WHEN POSITION(' ' IN "name") > 0 THEN SPLIT_PART("name", ' ', 1)
    ELSE "name"
  END,
  "lastName" = CASE 
    WHEN POSITION(' ' IN "name") > 0 THEN NULLIF(TRIM(SUBSTRING("name" FROM POSITION(' ' IN "name") + 1)), '')
    ELSE NULL
  END
WHERE "name" IS NOT NULL;

-- For any rows where name was null (shouldn't exist), set default
UPDATE "Customer" SET "firstName" = 'Unknown', "lastName" = NULL WHERE "firstName" IS NULL;

ALTER TABLE "Customer" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "name";
