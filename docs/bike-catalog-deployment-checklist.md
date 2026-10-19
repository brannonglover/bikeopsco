# Bike catalog: pre-deployment checklist

Covers the bike catalog lookup, year ranges, part provenance and verification, customer-bike installed parts, and the read-only consolidation report. Nothing here has been deployed or run against production.

## 1. Before merging

- [ ] Review the full diff (app, catalog library, migrations, tests). Nothing is committed yet.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run test:catalog` (no database) all pass.
- [ ] `npm run test:catalog:db` passes against **staging** (it refuses production).
- [x] **Admin screens checked in a browser (2026-10-19, local dev against staging).** Spend panel (today vs. soft cap, over-cap amount, 7-day total, recent lookups), Status column, status select (Approximate/Sourced only; Verified shown read-only), Verification panel (basis required; build + per-part who/when/against; part edit clears that part only; identity edit drops build to Sourced). Done with a local-only test admin identity (`PLATFORM_ADMIN_EMAIL` overridden for that dev process) — the real admin login was not used. Re-check once on a preview deploy.
- [x] **React "Invalid hook call" warning — not a functional regression (evidence below); confirm once on a preview.** It appears only in `next dev`, on the browser pane's two simultaneous `HEAD /` probes during the first compile. Simultaneous cold `HEAD`/`GET` requests (with and without a session) reproduce nothing on a clean `main` worktree or on this branch, and a production build of this branch (`next build`, `next start`) served the same simultaneous requests with no warning. Only one React copy is installed.
- [x] **Installed-part history survives edits; deletes can't destroy or orphan it** (fixed 2026-10-19; see section 6).
- [x] **Cross-shop authorization in job and customer workflows** (fixed 2026-10-19): job DELETE, archive-completed, reorder, products POST, preferences GET/PATCH, sms-consent PATCH (was unauthenticated), customer GET/PATCH/DELETE, customer-bike PATCH/DELETE now check the caller's shop. Tests: `npm run test:security:db`.
- [x] **Tenant-isolation audit of the remaining staff API areas** (2026-10-19). Fixed: customer merge (no auth — critical), services/[id] and products/[id] PATCH/DELETE, waitlist cancel, the customer reference on job PATCH / rental reservations / new customer bikes, waitlist service names; mechanics, products, services, rentals and customer-bike routes now bind the host's shop to the staff session (`requireStaffShop`). The repair-history deletion override needs a `reason` and is audit-logged (`[audit] repair_history_deleted`). Tests: `npm run test:security:db` (28).
- [x] **Default-shop host fallback** (fixed 2026-10-19). Hosts are classified (`classifyHost`): a shop subdomain, the shared `app.` host, a host listed in `DEFAULT_SHOP_HOSTS`, or **unknown — which serves no shop** (apex, `www.`, other domains, `*.vercel.app`). Middleware and `requireStaffShop` both require the session's own shop; every staff route that used the host alone now uses `requireStaffShop`. Also fixed: `customers/[id]/history` (no auth, no shop filter) and `chat/send-invite` (staff-only but unauthenticated). Tests: `npm run test:security` and `npm run test:security:db`.
- [x] **Private blob proxy** (fixed 2026-10-19). `/api/blob` authorizes every read by the file's owning shop (new `BlobAsset` registry, written at upload; older files are matched to the records that use them and then registered; a file two shops claim is refused). Allowed: staff of the owning shop, the customer it belongs to (chat session), a signed expiring URL (Twilio MMS/greetings, tracking-link bike photos), or an explicitly public file (logo, mechanic photo, product photo). Refusals are 404. Non-public files are `Cache-Control: private`. Chat uploads now need a staff or customer session and a server-issued pathname; messages can only attach this shop's unsent attachments.
- [x] **Remaining hardening** (2026-10-19). Push-token delete removes only the caller's own registration. Customers can only send their own pending chat uploads. Server-side URL fetches (bike-photo import, link preview, AI website import) go through `safeFetch`: http/https on standard ports, public addresses only — checked at connect time, so DNS rebinding can't slip past — every redirect re-checked, size and time capped. Inbound MMS sends our Twilio credentials only to `api.twilio.com`. The raw email diagnostic moved to `/api/platform/email-test` (platform admin, POST); template test sends go only to this shop's staff addresses. Push-token logging no longer prints cookie/Authorization fragments.
- [x] **Forwarded host** (2026-10-19). `X-Forwarded-Host` is believed only when it names the same host as `Host`; otherwise there is no host (no shop, failed Twilio signature, configured app URL for links). Tested without assuming anything about Vercel's proxy. Links and webhook URLs are `https` except on local dev hosts. This also closed a sign-in-link poisoning path in `chat/request-login`.
- [x] **Signed link lifetimes**: voicemail greeting ~1 h, picture messages ~6 h (Twilio's queue can hold a message 4 h), tracking page ~2 h; each rounded up to the hour. The voicemail webhook previously handed Twilio an unsigned private path — fixed.
- [ ] **Set `DEFAULT_SHOP_HOSTS=dev.bikeops.co` on Preview (develop)** before deploying. Without it staging serves no shop (sign-in redirects, public pages 404). Production needs none: the app serves only `*.bikeops.co` (apex and `www` are the marketing project).
- [ ] **Optional `BLOB_URL_SIGNING_SECRET`** (falls back to `NEXTAUTH_SECRET`). Rotating either invalidates outstanding signed blob URLs (24 h max).
- [x] **Custom domains**: none are attached to the app project (checked 2026-10-19: only `*.bikeops.co`), and shops only have a subdomain.
- [ ] Mobile app: staff images keep working (Bearer session). Customer-app images of the customer's own files now load **if** the app sends its chat session (cookie or Bearer) on image requests; before this change they were refused outright.
- [ ] **Parts tab performance, database-error handling and connection settings** — in progress in a separate session (see section 7). `npm run build` currently fails lint on that session's unfinished `src/lib/parts-tab.db.test.ts`.

## 2. Database changes

- [ ] App migration `20261017120000_add_job_bike_catalog_lookup_at` (job bike lookup fields; marks completed/cancelled jobs' bikes as already looked up). Edited in place before ever reaching production — confirm production has no row for it in `_prisma_migrations`.
- [ ] App migration `20261018120000_bike_installed_components` (confirmed build on `Bike`, replacement state on part notes, `BikeInstalledComponent` table). Additive only.
- [ ] See `docs/preview-deployment-checklist.md` for the preview run itself.
- [ ] App migration `20261019120000_blob_assets` (`BlobAsset` table: pathname → owning shop). Additive only. Applied to staging 2026-10-19.
- [ ] A `DROP INDEX "Job_createdFromConversationId_idx"` that `migrate diff` produced from staging drift was deliberately left out. Confirm whether production has that index and whether `schema.prisma` should declare it.
- [ ] Catalog schema (`bike_catalog`) is applied by the build's `db push`: new columns/tables/enums only (spec status, part source and verification, lineup page, lookup + spend tables). Confirm the push reports no data loss on a preview first.
- [ ] All existing catalog rows become `APPROXIMATE` on push (by design).

## 3. Configuration

- [ ] `ANTHROPIC_API_KEY` set for production (web lookup). Without it lookups record a failure and stop; nothing else breaks.
- [ ] `CATALOG_LOOKUP_DAILY_BUDGET_USD` — optional, default `5`, UTC day. It's a **soft** ceiling: it stops new calls; a call already running can finish over it (shown as overspend). `0` turns paid lookups off.
- [ ] `CRON_SECRET` set (the new `/api/cron/catalog-lookups` checks it). `vercel.json` adds it every 10 minutes — confirm the plan allows that.
- [ ] Automatic stock images are **off**. Image rights for manufacturer photos are still undecided.

## 4. Production consolidation (read-only first)

- [ ] Run `npm run catalog:report` with production `DATABASE_URL` / `CATALOG_DATABASE_URL` (owner runs, or explicitly approves running). It reads inside `READ ONLY` transactions and only writes report files to `bike-catalog/reports/`.
- [ ] Review safe merges, review items, separations and affected jobs/customer bikes. Keep the plan fingerprint.
- [ ] Soft-merge apply/revert is **not built**. Approving it starts that work; it must re-check the fingerprint before changing anything.

## 5. After deploy

- [ ] Watch `/admin/catalog` spend for the first days; one real lookup cost ~$0.82, so $5 ≈ six new bikes a day.
- [ ] Watch cron and function logs for `[catalog-lookup]` errors and `over the soft cap` warnings.
- [ ] Spot-check a few Parts tabs: build status, lineup note, fit-critical flags, installed-part history.
- [ ] Mobile app: no changes needed (it doesn't use the Parts tab); marking bikes done from the phone still updates installed-part history.

**Rollback:** all schema changes are additive. Set `CATALOG_LOOKUP_DAILY_BUDGET_USD=0` to stop paid lookups immediately; revert the code to remove the features. Installed-part history and confirmations stay in their tables untouched.

## 6. Job deletion and installed-part history

Fixed 2026-10-19. Deletion semantics (no schema change):

| Operation | Behaviour |
|---|---|
| Edit a job's bikes (type, nickname, photo, model) | Bikes are updated in place, matched by job-bike id, then customer bike, then position + make. Ids, done state, services, part notes and repair history are kept. A missing `year` in the payload keeps the stored year. |
| Remove a bike from a job / replace it with another | Allowed when it has no recorded parts. With recorded parts → 409: un-mark it done (or reopen the job) first, which withdraws them deliberately. |
| Delete a job | Shop-scoped. With recorded parts → 409: cancel it (withdraws them) or archive it (keeps them). No path leaves records with no job. |
| Cancel / un-mark done | Withdraws that job's records (unchanged). |
| Staff delete a customer bike / a customer | With recorded parts → 409 with the count. `?confirmRepairHistoryDeletion=true` deletes deliberately (e.g. a privacy request); not exposed in the UI. |
| Customer deletes a bike in the customer app | With shop history → 409 ("ask the shop"). |

The web job screen and customer screens show the 409 message. The mobile app shows its existing generic error for these refusals; an app update can show the message.
## 7. Parts tab performance

Measured read-only against staging from a laptop (production numbers are estimates — Vercel couldn't be timed from here):

- Server-side query time is negligible (0.03–0.27 ms per query). The time is **network round trips**: with `pgbouncer=true` every Prisma query costs 5 round trips (BEGIN, DEALLOCATE ALL, prepare, execute, COMMIT); queries with `include` cost 9.
- A warm request makes 34–44 round trips (~69 ms each from the laptop → 2.3–3.2 s); cold adds a ~0.5 s connection per Prisma client (there are two) and dev fires the request twice.
- **`connection_limit=1`** (`src/lib/db-url.ts`) makes the route's "parallel" reads run one at a time — and in production it queues every concurrent request on an instance behind one connection. This is the main production risk.

Recommended, in order:

1. Raise `connection_limit` to ~3–5 (check the Supabase pooler's client limit for the plan). Low risk.
2. Run the route's independent reads alongside the spec fetch; remove duplicate reads (customer bike read twice, lookup row read twice, job bike re-read after updates). Low risk.
3. Slim the match pool query (no components until one bike is chosen; fold the brand lookup in; add an `orderBy` so `take: 100` can't drop the right bike). Low risk.
4. Consider `@prisma/adapter-pg` on port 6543 (measured 3.1 s → 0.62 s warm from the laptop). Medium risk: new dependency; regression-test transactions and the advisory-lock read paths.

Also found: `fetchSpecsForJobBike` reports a database error as "no match", so a transient outage shows "no catalog entry" in the Parts tab. Make it report an error instead.

After deploy, check real Parts-tab durations in Vercel function logs.
