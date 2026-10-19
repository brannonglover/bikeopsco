# Release candidate: preview deployment checklist

For the release candidate that bundles the tenant-isolation and private-file fixes, the bike catalog work, and (separately reviewed) the Prisma pg adapter. Nothing here is deployed yet. Production is untouched.

## A. Before deploying the preview

### Where the preview runs
- [ ] Deploy from the **`develop` branch**. `DATABASE_URL`, `DIRECT_URL` and `PRODUCTION_SUPABASE_PROJECT_REF` exist only for *Preview (develop)*; any other branch has no database and its build stops at `migrate deploy`.
- [ ] Preview (develop) `DATABASE_URL` is the staging project (`fmqtkktfjtujyvgeepjq`). The build's isolation check refuses the production ref; confirm `SKIP_PREVIEW_DB_ISOLATION` is **not** set.
- [ ] Staging is reached at **`dev.bikeops.co`** (alias). The app's production domain is `*.bikeops.co`; the bare domain and `www` belong to the separate marketing project. No custom domains are attached to the app.

### New and changed settings (Preview (develop))
- [ ] `DEFAULT_SHOP_HOSTS=dev.bikeops.co` — **required**. `dev` is a reserved name, so without it staging serves no shop (sign-in redirects, booking pages 404).
- [ ] Optional `BLOB_URL_SIGNING_SECRET` (falls back to `NEXTAUTH_SECRET`).
- [ ] `ANTHROPIC_API_KEY`, `CRON_SECRET` are Production-only today: catalog web lookups won't run on the preview (by design; the panel shows a failure, nothing else breaks).
- [ ] Production needs **no** `DEFAULT_SHOP_HOSTS` unless a shop is meant to be served on a non-subdomain host.
- [ ] Confirm production `BLOB_ACCESS`. One variable covers Development, Preview and Production, and the development copy is `private`, so production is almost certainly the private store — the item in section D depends on it.

### Database changes the preview build applies (to staging, already applied there)
`npm run build` runs `migrate deploy` and the catalog `db push`. Staging reports "Database schema is up to date".

| Migration | What it does | Risk |
|---|---|---|
| `20261017120000_add_job_bike_catalog_lookup_at` | Adds `JobBike.catalogLookupAt`/lookup fields; marks completed/cancelled jobs' bikes as already looked up (one `UPDATE`). | Additive + one backfill. Edited in place before reaching production — confirm production's `_prisma_migrations` has no row for it. |
| `20261018120000_bike_installed_components` | Confirmed build on `Bike`, replacement state on part notes, `BikeInstalledComponent` table. | Additive. |
| `20261019120000_blob_assets` | `BlobAsset` table (file pathname → owning shop). | Additive. Empty at first; older files are registered on first access. |
| Catalog `db push` (`bike_catalog`) | Spec status, part provenance/verification, lookup and spend tables. All rows become `APPROXIMATE`. | Additive; confirm the push reports no data loss. |

Left out deliberately: a `DROP INDEX "Job_createdFromConversationId_idx"` that staging drift produces — confirm whether production has the index.

## B. Preview checks — staff (web, `dev.bikeops.co`)
- [ ] Sign in; board, jobs, customers, conversations, email templates, settings load.
- [ ] Job card bike photo, customer bike photo, product photo, mechanic photo, shop logo display.
- [ ] Upload: bike photo, product photo, mechanic photo, logo, voicemail greeting; each displays after upload.
- [ ] Bike photo import from an image search result works; pasting `http://127.0.0.1/…` is refused.
- [ ] Chat: send an image and a video; both display; delete one.
- [ ] Email template test send to your own staff address works; to another address is refused with a clear message.
- [ ] Parts tab: catalog match, unmatched bike, installed-part history. Note load times (adapter comparison).
- [ ] `/admin/catalog` (platform admin): spend panel, verification panel.
- [ ] `/api/debug/env` still works on `dev.bikeops.co` when signed in (staging isolation check), and returns 404 on production.
- [ ] Open the staging URL on `https://<deployment>.vercel.app` while signed in: it should **not** show the shop (unknown host fails closed).

## C. Preview checks — customer (web)
- [ ] Booking widget: services list, book a job.
- [ ] Tracking link from the booking email: job status and the bike photo load (signed link); the same page without `?access=` is refused.
- [ ] Customer chat (`/chat/c`): request a sign-in link — the emailed link points at `dev.bikeops.co`; sign in; send and view an image; see a staff-sent image.

## D. Preview checks — mobile apps (both point at the preview API)
- [ ] Staff app: sign in, board, job card bike photos, chat images, voicemail greeting playback.
- [ ] Customer app: sign in, job status, bike photo, chat images, profile photo.
- [ ] **Known gap (needs a mobile change, not a server one):** the apps load images with `<Image source={{ uri }}>` and send no session, and some image URLs are relative (`/api/blob?...`). With the private store, those images could not load before this release either (the old middleware required a staff cookie). Fix in the app: resolve the URL and pass the session on the image request (`source={{ uri, headers }}`), or have the API return signed links to the apps.

## E. Preview checks — messaging (Twilio)
- [ ] Inbound SMS to the staging number arrives in chat; an inbound picture message is imported.
- [ ] Staff send a picture message: the customer's phone receives the image (Twilio fetches a signed link, valid ~6 h).
- [ ] Call the staging number, let it go to voicemail: the recorded greeting plays (signed link, ~1 h), recording and transcript appear.
- [ ] Twilio webhook URLs in the console point at `dev.bikeops.co` (signatures are checked against the routed host; a forwarded host that disagrees is refused).

## Verification run before requesting approval (2026-10-19, local → staging)
- `npx tsc --noEmit`, `next lint`: clean. `npx next build --no-lint`: passes; no `pg` code in browser chunks; every API route is dynamic (`/api/debug/env` was the one prerendered route — now dynamic and 404 on production).
- Suites, each run with the Prisma engine and with `DATABASE_DRIVER=pg`: `test:security` 18, `test:catalog` 92, `test:security:db` 58, `test:catalog:db` 32, `test:parts:db` 21 — all pass on both.
- Mutation checks: each security guard added in this release was disabled one at a time and the suite caught it (20 guards).

## F. Rollback
- Code: redeploy the previous production deployment (instant rollback). All schema changes are additive, so old code runs against the new schema.
- pg adapter: unset `DATABASE_DRIVER` and redeploy (section G).
- Paid lookups: `CATALOG_LOOKUP_DAILY_BUDGET_USD=0`.

## G. Database adapter (separate checkpoint)
Owned by the performance session. Off unless `DATABASE_DRIVER=pg`; unset keeps Prisma's own engine on its unchanged code path (node-postgres isn't loaded).

Measured laptop → staging (~69 ms round trip), Parts tab request, ms:

| Scenario | Engine | pg adapter |
|---|---|---|
| Matched, warm (median) | 1,347 | 360 |
| Matched, cold | 2,886 | 1,313 |
| Matched, 5 at once, warm (worst) | 3,280 | 758 |
| Unmatched, warm | 1,341 | 351 |
| Unmatched, cold | 2,391 | 1,315 |
| Unmatched, 5 at once, warm (worst) | 1,880 | 559 |

Connections per process: the same caps for both (at most 8 under 5 concurrent requests); after 15 s idle the engine holds 8, the adapter 0.

- [ ] First preview: deploy **without** `DATABASE_DRIVER` and run sections B–E (security and catalog changes alone).
- [ ] Then set `DATABASE_DRIVER=pg` on Preview (develop) only, redeploy, and repeat: Parts tab (matched and unmatched), board, chat (uses advisory locks), run `/api/cron/catalog-lookups` once. Watch logs for `[db] idle database connection failed`.
- [ ] Before production: check the Supabase pooler's pool size / max clients for the plan (Dashboard → Database → Settings → Connection pooling) and whether production sets `CATALOG_DATABASE_URL`.
- Rollback: Vercel Instant Rollback; or unset `DATABASE_DRIVER` and redeploy. No schema, migration or data to undo.
