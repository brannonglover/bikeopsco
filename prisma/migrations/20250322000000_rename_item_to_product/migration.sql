-- RenameTable: Item -> Product (preserves existing data)
ALTER TABLE "Item" RENAME TO "Product";

-- AlterTable: Add inventory tracking fields
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "stockQuantity" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "supplier" TEXT;
