# Migration history reset – fix for P3006 / P1014

Your migration history was incomplete (alter-only migrations with no init), and Supabase does not support Prisma’s shadow database. The migrations have been reset to a clean baseline plus `add_booked_in`.

## Steps to apply

**1. Remove old migration records from the database**

Run this SQL in the Supabase SQL Editor (or via psql):

```sql
DELETE FROM "_prisma_migrations" 
WHERE migration_name IN (
  '20250321000000_customer_first_last_name',
  '20250322000000_rename_item_to_product'
);
```

**2. Mark the baseline as applied** (matches your current schema)

```bash
npx prisma migrate resolve --applied 20250320000000_baseline
```

**3. Deploy the BOOKED_IN migration** (uses direct connection, no shadow DB)

```bash
npx prisma migrate deploy
```

After this, the Stage enum will include `BOOKED_IN`.

> **Note:** Use `prisma migrate deploy` instead of `prisma migrate dev` with Supabase. Deploy does not use a shadow database, so it avoids P3006.
