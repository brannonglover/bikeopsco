# Bike Catalog

Owned make/model/year → component catalog for Bike Ops.

Each row is one **build sheet** covering a span of model years (`yearStart`–`yearEnd`): a bike's parts usually stay the same for a whole generation, so the sheet is stored once and a job bike matches any row whose span covers its year (or is within one year of it). `yearStart` is the original `year` column.

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
| `npm run catalog:report` | **Read-only** consolidation report: which per-year rows could become one year-spanning row, which need review, which must stay separate, and the jobs / customer bikes each touches. Writes Markdown + JSON to `bike-catalog/reports/` (git-ignored). Changes nothing. |

## Admin UI

Platform admins can manage catalog rows at **`/admin/catalog`** (on the platform admin host): search, create, edit identity + component slots, delete. Changes apply to the owned catalog used by Parts info on jobs.


## How far a build sheet can be trusted

Every catalog row has a `specStatus`, and every part a `source` (+ `sourceUrl`). Both show on the job's Parts tab.

| specStatus | Meaning | Auto-matched? |
|------------|---------|---------------|
| `APPROXIMATE` | Hand-entered generation guide ("varies by trim") — all seed and fixture rows | Never. Offered as a possible match only, and never stops a web lookup. |
| `SOURCED` | Built by the web lookup from cited pages; not checked by a person | Only when unambiguous (below) |
| `VERIFIED` | An admin confirmed the build's identity (set via the Verification panel in `/admin/catalog`) | Only when unambiguous; never overwritten by seeds, scrapes or lookups |

Part sources: `MANUFACTURER` (a page on the brand's own site — checked by domain, not taken on the model's word), `THIRD_PARTY`, `ADMIN`, `APPROXIMATE`.

### What "verified" means

Verification is a recorded statement by a platform admin — who, when, and what they checked against — made in the Verification panel on a catalog row. It is never a side effect of saving or approving a row.

- **Build verified** (`specStatus = VERIFIED`, `verifiedBy/At`, `verificationNote`): brand, model, trim and years are right. It lets jobs auto-match the row. It says nothing about any part.
- **Part verified** (`CatalogComponent.verifiedBy/At/Against`): that exact value and standard were compared with a source for this build and year. It confirms the **factory** part only.
- Editing a verified part's value, or a verified build's brand/model/years, clears that verification. Seeds and scrapes never overwrite verified rows or verified parts.

A catalog part is always the **factory** spec — what the bike came with. It never says which replacements fit; fit-critical parts (bottom bracket, hubs, axle, headset, hanger, brake mount, rotors, seatpost, freehub, fork, shock…, see `lib/fit.ts`) are flagged "check on the bike before ordering" until their factory value is verified. A replacement-compatibility table (keyed by build + slot) can be added later without touching these rows.

## Matching (bike-catalog/lib/match.ts)

A job bike is linked automatically only to the **one** row that has the same brand (or alias), the same model name word for word, the job year inside its span, and isn't `APPROXIMATE`. Anything less — a year one outside the span, a model typed without its trim, two builds under one name — is a possible match the mechanic picks on the Parts tab.

## Web lookup (grows the catalog from real jobs)

When a job bike is saved, `src/lib/bike-catalog-lookup.ts` runs after the response (`waitUntil`). If matching can't link it and it has a model and year, Claude searches the web — once per make|model|year across every shop — for **every build** sold under that name that year, citing a page for each part. Each build becomes its own `SOURCED` row for that one year (no guessed year ranges; parts with no source are dropped). The job bike is linked only when one build was found **and** a page on the manufacturer's own site lists that model's lineup for the year with no others (`CatalogLookup.lineupSourceUrl`). One build found is not one build sold: without that page the builds wait on the Parts tab, which says the lineup wasn't confirmed. Lookups only ever create rows — an existing row with the same name and year is reused untouched.

- **Budget (a soft ceiling):** `CATALOG_LOOKUP_DAILY_BUDGET_USD` (default $5, UTC day) stops new paid calls — checked before each search (holding $1 for each search already running) and before each follow-up call. A call already in flight can't be stopped, so a day can end over the cap: that's logged and shown as overspend on `/admin/catalog` (Web lookup spend), never hidden. Every call is logged in `CatalogLookupSpend` with tokens, searches and estimated cost (timed-out calls get a $1 estimate, marked as such). One real lookup measured **$0.82** (Oct 2026), so $5 covers about six new bikes a day; repeat bikes are free.
- **Reliability:** one lookup has 230 s end to end (job routes and the cron run with `maxDuration = 300`); the SDK's own retries are off. Rate limits, 5xx and timeouts retry with backoff (15 min → 1 h → 6 h → daily, never sooner than Retry-After), up to 3 paid attempts per bike; bad requests and refusals don't retry. An interrupted search is taken over after 10 min and counts as an attempt.
- **Recovery:** `/api/cron/catalog-lookups` (every 10 min) runs up to 5 owed lookups side by side: `JobBike.catalogLookupAt` is null and `catalogLookupNextAt` has passed (bikes from customer bookings, interrupted lookups, retries, bikes that waited on another job's search, budget holds).
- **Images:** the lookup does **not** fetch stock photos. Automatically copying product images needs permission we haven't confirmed, so job cards show the customer's photo, else a catalog photo an admin chose, else the usual fallback. (The Serper-based image step from the first version was never tested end to end — the local `SERPER_API_KEY` is empty — and has been removed.)

## Customer bikes: confirmed build and installed parts (app DB)

- **Confirmed build.** When a mechanic picks a build on the Parts tab (or confirms an automatic match with "Yes, remember it"), it's saved on the customer's `Bike` (`catalogBikeId`, `catalogConfirmedAt/By/JobId`). Every later job for that bike links to it immediately — no matching, no paid search. An automatic match is never remembered on its own.
- **Installed parts** live in `BikeInstalledComponent` (history; newest per slot is what's on the bike), apart from the factory spec. A job's part notes (`JobBikeComponentOverride`) reach it only when the bike is marked done or the job reaches Bike ready / Completed, on a job that isn't cancelled or awaiting approval — and only for a replacement marked **installed** or a non-factory part the mechanic **saw** on the bike. Planned/quoted/ordered parts never do. If the job is later cancelled or the bike un-marked done, the record is withdrawn. `reconcileInstalledComponents(jobId)` (src/lib/bike-installed-components.ts) applies these rules after every job stage/completion change and every part note.

## Consolidating per-year rows (read-only for now)

The old seed wrote one row per year; `npm run catalog:report` proposes which consecutive years could be one row. It reads inside Postgres `READ ONLY` transactions and only writes report files. Criteria (all enforced in `lib/consolidation.ts`, tested in `lib/consolidation.test.ts`):

- same brand **and** same model name, trim included — trims never merge; consecutive years only;
- every part compared on value **and** fit standard — any difference keeps rows separate;
- missing information is never agreement — a part on one row only, or a fit-critical part (bottom bracket, headset, wheel size, brakes, fork, cassette, axle/hub spacing, rear shock on full-suspension) missing from either, sends the pair to review;
- approximate rows only qualify as literal copies of one seed template (same parts, same "Shared build sheet for …" span) and stay Approximate; an approximate row never merges with a sourced one;
- verification must already match exactly — a merge never spreads a verified part or build to unverified years.

Output: **safe merge candidates**, **needs review**, **must stay separate**, similar model names, undated rows, the affected jobs and customer bikes, and a plan fingerprint.

**Proposed soft merge (not implemented — needs approval):** add `CatalogBike.mergedIntoId / mergedAt / mergedBy / mergeBatchId` and a `CatalogMergeBatch` record (approver, fingerprint, each survivor's previous span). Applying a batch re-checks the fingerprint, widens the survivor's span, and marks the other rows merged — nothing deleted, every id kept. Matching ignores merged rows; job bikes and confirmed customer builds keep pointing at the exact row they had (still valid, still shown as-is); lookup records resolve merged ids to the survivor. Reverting a batch clears `mergedIntoId` and restores the stored spans, which restores the catalog exactly.

## Tests

```bash
npm run test:catalog      # matching, fit checks, install rules, merge criteria, errors, cost, result validation — no database
npm run test:catalog:db   # lookup failure paths, bike history, confirmed builds, verification, consolidation report — against DATABASE_URL (refuses production)
```

## Provenance & scraping

- Prefer OEM / brand marketing pages and shop/mechanic-confirmed rows. Record `sourceUrl` on every bike when available.
- Respect robots.txt, rate limits, and brand ToS.
- **Do not** use 99 Spokes, BikeBook, or other sources that redistribute 99 Spokes data.
- Do not scrape paid third-party bike databases.
- New brand parsers should be reviewed before trusting data in production jobs.
- Job-level confirmations/customizations live in the Bike Ops app DB and do not rewrite this catalog by default.

## Safety

Never run catalog `db push --accept-data-loss` against a database that also hosts the Bike Ops app unless you have confirmed the Prisma schema is limited to `schemas = ["bike_catalog"]`.
