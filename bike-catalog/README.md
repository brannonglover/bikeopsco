# Bike Catalog

Owned make/model/year → component catalog for Bike Ops.

Catalog tables live in the Postgres schema **`bike_catalog`** (not `public`), so they can share a database with the Bike Ops app without `db push` touching shop data. Prefer a dedicated catalog database when you scale.

## Setup

```bash
# Optional: dedicated catalog DB. If unset, scripts use DATABASE_URL / DIRECT_URL
# and create/use the isolated `bike_catalog` schema.
export CATALOG_DATABASE_URL="$DATABASE_URL"
export CATALOG_DIRECT_URL="$DIRECT_URL"

npm run catalog:generate
npm run catalog:push
npm run catalog:seed
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run catalog:generate` | Generate Prisma client into `bike-catalog/generated/client` |
| `npm run catalog:push` | Push schema to the `bike_catalog` Postgres schema |
| `npm run catalog:seed` | Seed a handful of hand-entered bikes |
| `npm run catalog:scrape -- specialized` | Specialized scraper (fixtures + optional URLs) |
| `npm run catalog:scrape -- trek` | Trek fixture scraper |
| `npm run catalog:scrape -- schwinn` | Schwinn fixture scraper |

## Admin UI

Platform admins can manage catalog rows at **`/admin/catalog`** (on the platform admin host): search, create, edit identity + component slots, delete. Changes apply to the owned catalog used by Parts info on jobs.


## Provenance & scraping

- Prefer OEM / brand marketing pages and shop/mechanic-confirmed rows. Record `sourceUrl` on every bike when available.
- Respect robots.txt, rate limits, and brand ToS.
- **Do not** use 99 Spokes, BikeBook, or other sources that redistribute 99 Spokes data.
- Do not scrape paid third-party bike databases.
- New brand parsers should be reviewed before trusting data in production jobs.
- Job-level confirmations/customizations live in the Bike Ops app DB and do not rewrite this catalog by default.

## Safety

Never run catalog `db push --accept-data-loss` against a database that also hosts the Bike Ops app unless you have confirmed the Prisma schema is limited to `schemas = ["bike_catalog"]`.
