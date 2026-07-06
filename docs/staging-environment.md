# Staging environment (`develop` → `dev.bikeops.co`)

Use this workflow to test changes (for example chat sign-in magic links) on a stable URL before merging to `main` and deploying production.

## Audit summary (2026-06-29)

**Preview still uses the production database.** `DATABASE_URL` and `DIRECT_URL` are now scoped separately (**Preview develop** vs **Production** only — fixed 2026-06-29), but both still point at the same Supabase project ref `nshrozsfixyeihthjxxi` on `aws-0-us-west-2.pooler.supabase.com`. That is why `dev.bikeops.co` shows real production customers and jobs.

A build guard is in place: `PRODUCTION_SUPABASE_PROJECT_REF` is set on Preview (develop). After the next `develop` deploy that includes `scripts/check-preview-db-isolation.js`, Preview builds **fail** until staging `DATABASE_URL` / `DIRECT_URL` use a different Supabase project.

After you provision a separate staging DB, confirm isolation:

```bash
vercel curl https://dev.bikeops.co/api/debug/env | jq '{databaseUrlHostHint, customerNotificationsEnabled}'
```

The host hint must **not** match production (`aws-0-us-west-2.pooler.supabase.com` today).

**Notification exposure on Preview (before code guard):**

| Service | Preview config | Risk |
|---------|----------------|------|
| **Postgres** | Same as Production | Reads/writes live customer data |
| **Twilio** | Same account + auth token; different `TWILIO_PHONE_NUMBER` | Stage changes / chat could SMS real customers |
| **Quo** | `QUO_API_KEY` shared; `QUO_PHONE_NUMBER` Production-only | API key present; sends blocked without phone |
| **Resend** | Not set on Preview | Customer emails mostly skipped already |
| **Stripe** | Not set on Preview | Payments fail without keys (good) |

**Code guard (develop branch):** Customer-facing email, SMS, and Quo sends are blocked when `VERCEL_ENV=preview` or `NEXT_PUBLIC_APP_URL` contains `dev.bikeops.co`. Set `ALLOW_CUSTOMER_NOTIFICATIONS=true` on Preview only when using an **isolated staging DB** and test recipients. Chat magic-link emails are still allowed (for sign-in testing).

**You still need a separate staging database** — the guard prevents accidental notifications but Preview must not read/write production data.

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
| `QUO_API_KEY` / `QUO_WEBHOOK_SECRET` | Omit on Preview unless testing Quo with a sandbox line |
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

## Blockers requiring your action

| Blocker | Who |
|---------|-----|
| Vercel dashboard access (bikeops project) | You |
| Add `dev.bikeops.co` domain + branch assignment | You |
| DNS CNAME for `dev` | You (registrar or Vercel DNS) |
| Preview environment variables | You — **separate DATABASE_URL required** |
| Wire develop Supabase URLs + seed | You |
| `git push origin develop` (if not pushed yet) | You — approve push |
| Vercel CLI locally (`vercel login`) | Optional; dashboard is enough |

---

## Quick reference

| Environment | Branch | URL |
|-------------|--------|-----|
| Production | `main` | `app.bikeops.co`, `bbm.bikeops.co`, … |
| Staging | `develop` | `dev.bikeops.co` |
| Local | any | `http://localhost:3000` |
