# Staging environment (`develop` → `dev.bikeops.co`)

Use this workflow to test changes (for example chat sign-in magic links) on a stable URL before merging to `main` and deploying production.

## Audit summary (2026-09-28)

**Preview now has its own Supabase project.** Staging `DATABASE_URL` / `DIRECT_URL` point at project ref `fmqtkktfjtujyvgeepjq` (`aws-1-us-west-2.pooler.supabase.com`), which is **not** the production ref `nshrozsfixyeihthjxxi`. The isolation this document previously called for has been done; `dev.bikeops.co` no longer reads or writes production customers and jobs. Evidence is recorded under [Setup status](#setup-status-verified-2026-09-28) below.

Both directions are now guarded at build time, and both compare the **Supabase project ref** parsed from `DATABASE_URL` — not the pooler hostname, since two projects can share a host:

| Script | Runs on | Fails the build when |
|--------|---------|----------------------|
| `scripts/check-preview-db-isolation.js` | `VERCEL_ENV=preview` | Preview's ref **equals** `PRODUCTION_SUPABASE_PROJECT_REF` |
| `scripts/check-production-env.js` | `VERCEL_ENV=production` | Production's ref **differs** from `PRODUCTION_SUPABASE_PROJECT_REF`, or `SUPABASE_JWT_SECRET` does not verify `NEXT_PUBLIC_SUPABASE_ANON_KEY` |

Both need `PRODUCTION_SUPABASE_PROJECT_REF` set on the scope they guard (the ref is not secret). Each skips with a warning rather than failing when it cannot tell — an absent var, a non-legacy key format. Emergency bypasses: `SKIP_PREVIEW_DB_ISOLATION=true`, `SKIP_PRODUCTION_ENV_GUARD=true`.

Spot-check a running deployment:

```bash
vercel curl /api/debug/env --deployment bikeopsco-git-develop-brannonglovers-projects.vercel.app \
  | sed -n 's/^[^{]*\({.*\)$/\1/p' \
  | jq '{databaseUrlHostHint, customerNotificationsEnabled, customerNotificationBlockReason, emailRedirectTo}'
```

`vercel curl` takes a **relative** path plus `--deployment`; a full URL is rejected. Use the stable `…-git-develop-…` alias rather than `dev.bikeops.co`, which `--deployment` will not resolve. Plain `curl` returns a 302 to `vercel.com/sso-api` because the deployment is behind Vercel SSO protection, and the CLI prints progress lines before the JSON body — hence the `sed`.

`databaseUrlHostHint` is a host, not a ref, so treat it as a smoke test; the build guards above are the authoritative check.

Last run 2026-09-28 against `dev.bikeops.co`, after setting `EMAIL_REDIRECT_TO`:

```json
{
  "databaseUrlHostHint": "aws-1-us-west-2.pooler.supabase.com:6543",
  "customerNotificationsEnabled": false,
  "customerNotificationBlockReason": "Customer notifications disabled on Vercel Preview (staging)",
  "emailRedirectTo": "(set)"
}
```

### Guard-bypassing email senders

Ten senders in `src/lib/email.ts` deliberately skip `skipIfCustomerNotificationsBlocked` — chat magic links (so sign-in stays testable) plus the staff and platform notifications: `sendChatMagicLinkEmail`, `sendBookingRequestNotification`, `sendPaymentReceivedNotification`, `sendPlatformSignupNotification`, `sendSignupVerificationEmail`, `sendWaitlistRequestNotification`, `sendStaffNewChatMessageNotification`, `sendChatStaffReplyReminder`, `sendEmailTemplateTestEmail`, `sendCustomerBroadcastTestEmail`. On staging these would address rows from the staging database.

Two things contain them:

1. **`EMAIL_REDIRECT_TO`**, now set on **Preview (develop)** — rewrites every outbound `to` at the transport level.
2. **A fail-closed runtime guard**: `getUnredirectedEmailBlockReason()` in `src/lib/env.ts`, enforced in `sendResendEmail()`. Outside Production, a send with no redirect configured is **refused**, not delivered. Callers blocked by the notification guard return before reaching that point, so anything arriving there unredirected is exactly a bypassing sender.

That makes the redirect an enforced invariant rather than a configuration convention: removing `EMAIL_REDIRECT_TO` from Preview now breaks staging email loudly instead of silently reopening delivery. It is the runtime counterpart to `scripts/check-preview-db-isolation.js`. Escape hatch: `ALLOW_UNREDIRECTED_NONPROD_EMAIL=true`.

Production is unaffected — the guard returns early on `isProductionDeployment()`. SMS needs no equivalent: every path in `src/lib/sms.ts` goes through `sendSms`, which honours the notification guard with no bypass.

**Notification exposure on Preview:**

| Service | Preview config | Status |
|---------|----------------|--------|
| **Postgres** | Separate staging project `fmqtkktfjtujyvgeepjq` | Isolated from production data |
| **Twilio** | Same account + auth token; different `TWILIO_PHONE_NUMBER` | Live credentials — blocked only by the code guard below |
| **Resend** | Not set on Preview | Customer emails mostly skipped already |
| **Stripe** | Not set on Preview | Payments fail without keys (good) |

**Code guard:** customer-facing email and SMS are blocked when `VERCEL_ENV=preview`, when `NEXT_PUBLIC_APP_URL` contains `dev.bikeops.co`, when `STAGING=true`, or in local development. Set `ALLOW_CUSTOMER_NOTIFICATIONS=true` only with test recipients. Chat magic-link emails and the staff/platform notifications deliberately **bypass** this guard so sign-in stays testable — see [Guard-bypassing email senders](#guard-bypassing-email-senders) above for what contains them instead.

### Hazard: `VERCEL_ENV=production` in a local `.env.local`

`getCustomerNotificationBlockReason()` returns early on `isProductionDeployment()` — *before* the local-development and Preview checks (`src/lib/env.ts`). A `.env.local` written by `vercel env pull --environment=production` carries `VERCEL_ENV="production"`, which therefore disables **every** notification guard on a developer's machine, and disables `EMAIL_REDIRECT_TO` with it. Pointed at the staging database, that sends real SMS and email to whatever contacts staging holds.

Local `.env.local` should set:

```bash
VERCEL_ENV="preview"                        # not "production"; unset/"development" is not enough
NEXT_PUBLIC_APP_URL="http://localhost:3000" # match NEXTAUTH_URL
ALLOW_CUSTOMER_NOTIFICATIONS="false"        # highest-precedence block
EMAIL_REDIRECT_TO="you@example.com"         # catches magic links, which skip the guard
```

`VERCEL_ENV` must be `preview` specifically. Leaving it unset or setting `development` only blocks while `NODE_ENV=development`: the local-dev check keys off `NODE_ENV` and the `NEXT_PUBLIC_APP_URL` host, so `npm run build` / `npm start` (which set `NODE_ENV=production`) fall through to sending unless `NEXT_PUBLIC_APP_URL` is a localhost URL. Only `preview` blocks in every combination.

Re-running `vercel env pull` overwrites `.env.local` and reintroduces `VERCEL_ENV="production"`. Re-apply these overrides afterwards.

*Previously (2026-06-29): Preview and Production shared the production Supabase project `nshrozsfixyeihthjxxi`; `DATABASE_URL` / `DIRECT_URL` had just been scoped separately in Vercel, and a separate staging database was still outstanding.*

---

## Current deployment architecture

| Vercel project | Root directory | Git branch | Domains |
|----------------|----------------|------------|---------|
| **bikeopsco** (App) | repo root | `main` → Production | `*.bikeops.co`, `app.bikeops.co` |
| **Marketing** | `marketing/` | `main` → Production | `bikeops.co`, `www.bikeops.co` |

There is no GitHub Actions deploy pipeline. Vercel builds on push via its Git integration. `vercel.json` at the repo root configures crons and the npm install command for the App project only.

Preview deployments are created automatically for non-`main` branches. Assign `dev.bikeops.co` to the `develop` branch so staging has a fixed URL instead of rotating `*.vercel.app` preview links.

## How `dev.bikeops.co` resolves in the app

- `dev` is reserved in `src/lib/tenant-domain.ts` (like `app`, `www`, etc.) so it is **not** treated as a tenant subdomain.
- Requests to `dev.bikeops.co` fall back to the default shop (`bbm` / `shop_default`) for customer chat and other shop-scoped routes.
- `dev` is **not** a shared-app host like `app.bikeops.co`, so staff sessions on staging are **not** redirected to `bbm.bikeops.co` (production).

**Limitation:** The production wildcard `*.bikeops.co` still routes tenant hosts such as `bbm.bikeops.co` to the **production** deployment. Staging tests should use **`https://dev.bikeops.co`** (and paths under it), not `bbm.bikeops.co`.

---

## Repo workflow

```text
feature branch → develop (staging) → main (production)
```

1. Merge or push fixes to `develop`.
2. Verify on `https://dev.bikeops.co`.
3. Merge `develop` → `main` when ready; production updates automatically.

---

## One-time setup (outside the repo)

### 1. Create and push the `develop` branch

```bash
git checkout main
git pull origin main
git checkout -b develop
git push -u origin develop
```

If the chat sign-in fix is only in your working tree, commit it on a feature branch, merge into `develop`, and push `develop` (not `main`) first.

### 2. Vercel App project — Git settings

In [Vercel Dashboard](https://vercel.com) → **bikeops** project → **Settings → Git**:

- **Production Branch:** `main` (should already be set)
- Ensure the repo is connected and preview deployments are enabled (default)

### 3. Vercel App project — assign `dev.bikeops.co` to `develop`

**Settings → Domains → Add** `dev.bikeops.co`

When prompted (or via **Edit** on the domain):

- **Git Branch:** `develop`
- Environment: Preview (branch-specific domain)

Save. Vercel shows the required DNS record.

### 4. DNS (at your `bikeops.co` registrar or Vercel DNS)

Add a **CNAME** record:

| Type | Name | Value |
|------|------|-------|
| CNAME | `dev` | `cname.vercel-dns.com` |

If you use Vercel nameservers for `bikeops.co`, add the domain in the Vercel UI and it can configure DNS automatically.

Wait for DNS + SSL (usually minutes; up to 48h for some registrars).

### 5. Environment variables (Preview / staging)

In **bikeopsco** project → **Settings → Environment Variables**.

#### Vercel targets vs Git branches

| Vercel target | Applies to | Notes |
|---------------|------------|-------|
| **Preview** | Pushes to `develop` (and other non-`main` branches) | Powers **`dev.bikeops.co`** |
| **Production** | Pushes to **`main`** | Powers **`app.bikeops.co`** |
| **Development** | **`vercel dev` on your laptop only** | **Not** used for `git push` / branch deploys |

Do **not** put staging DB URLs under **Development** only — Preview builds will still fail with `P1012` / missing `DATABASE_URL`.

#### Critical: separate database (required)

Use the existing **BikeOps develop** Supabase project — you do **not** need to create another one. It must be a **different project ref** from production (`nshrozsfixyeihthjxxi`). Do not clone production data into it.

1. **Supabase develop project** → [supabase.com/dashboard](https://supabase.com/dashboard) → open **BikeOps develop** (or your develop-named project) → **Project Settings → Database** → Connection string:
   - **Transaction** mode (port **6543**) → `DATABASE_URL`
   - **Session** mode (port **5432**) → `DIRECT_URL`
   - Username is `postgres.[develop-project-ref]` — confirm under **Settings → General → Reference ID** that it is **not** `nshrozsfixyeihthjxxi`.
   - Do **not** use `db.*.supabase.co` — it fails on Vercel builds (P1001). See [DEPLOYMENT.md](../DEPLOYMENT.md#supabase-connection-strings-vercel).
2. In Vercel, point **Preview (develop)** `DATABASE_URL` and `DIRECT_URL` at the develop project only:
   - Dashboard: edit each var → remove **Preview** from the Production entry → add a new Preview-only entry (scope to Git branch `develop` if you like).
   - CLI (replace Preview develop URLs with your develop project pooler strings):

```bash
vercel env rm DATABASE_URL preview develop --yes
vercel env rm DIRECT_URL preview develop --yes
vercel env add DATABASE_URL preview develop   # paste develop Transaction URL (6543)
vercel env add DIRECT_URL preview develop     # paste develop Session URL (5432)
```

   - Leave **Production** entries unchanged.
3. Redeploy `develop` after saving env vars.

Verify isolation: after redeploy, `dev.bikeops.co` should show an empty calendar (or only seeded demo data).

#### Seed staging with fake data only

From your machine (never against production URLs):

```bash
# One-shot: validate, migrate, seed (see scripts/setup-staging-db.sh)
DATABASE_URL="postgresql://postgres.[develop-ref]:…@…pooler.supabase.com:6543/…" \
DIRECT_URL="postgresql://postgres.[develop-ref]:…@…pooler.supabase.com:5432/…" \
ADMIN_EMAIL="you@example.com" \
ADMIN_PASSWORD="your-staging-password" \
PRODUCTION_SUPABASE_PROJECT_REF="nshrozsfixyeihthjxxi" \
./scripts/setup-staging-db.sh
```

Or step by step:

```bash
# Apply schema to the develop Supabase project (empty or reset — not production)
DATABASE_URL="postgresql://…staging-pooler…" DIRECT_URL="postgresql://…staging-direct…" npm run db:push

# Templates, services, admin user, demo customer + job
DATABASE_URL="postgresql://…staging-pooler…" \
ADMIN_EMAIL="you@example.com" \
ADMIN_PASSWORD="your-staging-password" \
STAGING_TEST_EMAIL="you@example.com" \
npm run db:seed:staging
```

`db:seed:staging` sets `SEED_DEMO_DATA=true`: creates a demo customer (`staging-test@example.com` by default) and one `BOOKED_IN` job. Customer email/SMS on Preview are blocked by env guards (`VERCEL_ENV=preview`, `dev.bikeops.co`, etc.); set `ALLOW_CUSTOMER_NOTIFICATIONS=true` only on an isolated staging DB with test recipients.

#### Preview env var checklist

Set values for **Preview** (optionally scoped to Git branch `develop` only):

**Required for chat sign-in on dev:**

| Variable | Staging value | Notes |
|----------|---------------|-------|
| `DATABASE_URL` | **Staging-only** Postgres URL | Must differ from Production. |
| `DIRECT_URL` | Staging Session pooler (port 5432) | Not `db.*.supabase.co`; see DEPLOYMENT.md. |
| `NEXTAUTH_SECRET` | Random string | Can differ from production. |
| `NEXTAUTH_URL` | `https://dev.bikeops.co` | Staff NextAuth callback base. |
| `NEXT_PUBLIC_APP_URL` | `https://dev.bikeops.co` | Fallback base URL in emails/links when host header is missing. |
| `ROOT_DOMAIN` | `bikeops.co` | Keep same as production (tenant URL shape unchanged). |
| `FROM_EMAIL` | Verified sender | Only needed if testing outbound email on staging. |

**Do not copy from Production on Preview:**

| Variable | Staging value |
|----------|---------------|
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Omit on Preview, or use a Twilio **test** subaccount |
| `TWILIO_PHONE_NUMBER` | Omit on Preview (code guard blocks sends anyway) |
| `RESEND_API_KEY` | Omit unless testing email; add Preview-only key for magic-link tests |
| `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test** keys only, Preview-scoped |
| `STRIPE_WEBHOOK_SECRET` | Separate webhook for `https://dev.bikeops.co/api/webhooks/stripe` |

**Optional override (isolated staging DB + test recipients only):**

| Variable | Value |
|----------|-------|
| `ALLOW_CUSTOMER_NOTIFICATIONS` | `true` — re-enables customer email/SMS on Preview |

**Recommended (parity with production):**

| Variable | Notes |
|----------|-------|
| `BLOB_READ_WRITE_TOKEN` | Chat image uploads (can share or use separate Blob store) |
| `NEXT_PUBLIC_POSTHOG_*` | Optional; events tagged by host |

After changing env vars, **redeploy** the `develop` branch (push a commit or use **Redeploy** in Vercel).

### 6. Database for staging

See **Seed staging with fake data only** above. Ensure at least one customer with a known email exists for chat sign-in tests, and that **Settings → Features → Chat** is enabled for the shop.

### 7. Verify notification sandbox

After deploy:

```bash
curl -s https://dev.bikeops.co/api/debug/env | jq '{VERCEL_ENV, customerNotificationsEnabled, customerNotificationBlockReason}'
```

Expect `customerNotificationsEnabled: false` and a block reason mentioning Preview or `dev.bikeops.co`.

Moving a job stage on staging should log `[sms] Skipping send` / `[email] Skipping sendJobEmail` in Vercel function logs — no Twilio or Resend delivery.

### 8. Marketing project (optional)

The marketing site (`bikeops.co`) can stay production-only. It hard-links to `app.bikeops.co`. For staging, browse the app directly at `https://dev.bikeops.co/chat/c`.

---

## Verify chat sign-in fix on `dev.bikeops.co`

After `develop` is deployed and the domain is active:

1. Open **`https://dev.bikeops.co/chat/c`**
2. Enter an email that exists as a customer on the **staging** database.
3. Submit **Send sign-in link**.
4. Open the email and confirm the link target is:
   - **`https://dev.bikeops.co/open/login#token=...`** (bridge page prefers the native app, then web chat)
5. Click the link — the BikeOps app should open when installed; otherwise use **Continue in browser**.
6. Confirm you land in the chat UI (not a dead end or expired-token loop).

**Debug endpoints (Preview only):**

- `GET https://dev.bikeops.co/api/debug/env` — `customerNotificationsEnabled`, Resend/App URL resolution

**Resend checklist (when testing email on staging):**

- API key set for Preview environment
- `FROM_EMAIL` domain verified in Resend
- Check Resend dashboard → Logs for bounces or domain errors

---

## Setup status (verified 2026-09-28)

The one-time setup above is complete. Each row below was checked, not assumed:

| Item | Status | How it was verified |
|------|--------|---------------------|
| `develop` branch pushed | Done | `git ls-remote origin develop` → `70404fc` (2026-09-21) |
| `dev.bikeops.co` domain + branch assignment | Done | Deployment `dpl_8XVrtHyU6ubDSobbsUYLK9a8wFSU` (target `preview`, Ready) is aliased to `dev.bikeops.co` and `…-git-develop-…` |
| DNS for `dev` | Done | Resolves to Vercel (`216.150.16.129`, `216.150.1.1`) and serves over HTTPS |
| Preview env vars scoped to `develop` | Done | `vercel env ls preview` shows `DATABASE_URL`, `DIRECT_URL`, `PRODUCTION_SUPABASE_PROJECT_REF`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET` scoped **Preview (develop)** |
| Separate staging database | Done | See the proof below |
| Vercel CLI locally | Done | `vercel whoami` → `brannonglover` |
| `EMAIL_REDIRECT_TO` on Preview | Done (2026-09-28) | Added scoped to **Preview (develop)**; develop redeployed and `/api/debug/env` reports `emailRedirectTo: "(set)"` |
| Seed staging data (`db:seed:staging`) | **Unverified** | Not checkable from outside; run it if `dev.bikeops.co` has no demo shop/job |

**Proof that Preview is isolated, without decrypting anything:** `scripts/prisma.js` calls `checkPreviewDbIsolation({ exitOnFailure: true })` on `migrate deploy`, which `npm run build` runs on every deploy. `origin/develop` contains that guard, `PRODUCTION_SUPABASE_PROJECT_REF` is set on Preview (develop), and the 2026-09-21 develop deployment built **Ready**. The build would have aborted had `DATABASE_URL` carried the production ref. The live `databaseUrlHostHint` (`aws-1-us-west-2…`) corroborates it.

No remaining configuration gaps. `EMAIL_REDIRECT_TO` was set on Preview (develop) on 2026-09-28 and is now backed by a fail-closed runtime guard — see the audit summary above.

---

## Quick reference

| Environment | Branch | URL |
|-------------|--------|-----|
| Production | `main` | `app.bikeops.co`, `bbm.bikeops.co`, … |
| Staging | `develop` | `dev.bikeops.co` |
| Local | any | `http://localhost:3000` |
