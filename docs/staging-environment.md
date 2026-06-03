# Staging environment (`develop` → `dev.bikeops.co`)

Use this workflow to test changes (for example chat sign-in magic links) on a stable URL before merging to `main` and deploying production.

## Current deployment architecture

| Vercel project | Root directory | Git branch | Domains |
|----------------|----------------|------------|---------|
| **bikeops** (App) | repo root | `main` → Production | `*.bikeops.co`, `app.bikeops.co` |
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

In **bikeops** project → **Settings → Environment Variables**, set values for **Preview** (applies to all preview deploys including `develop`). Optionally use **Git Branch** overrides scoped to `develop` only.

**Required for chat sign-in on dev:**

| Variable | Staging value | Notes |
|----------|---------------|-------|
| `DATABASE_URL` | Staging Postgres URL | Strongly prefer a **separate** Supabase/Neon project so staging does not touch production data. |
| `DIRECT_URL` | Same DB direct URL | Required if using Supabase pooling. |
| `NEXTAUTH_SECRET` | Random string | Can differ from production. |
| `NEXTAUTH_URL` | `https://dev.bikeops.co` | Staff NextAuth callback base. |
| `NEXT_PUBLIC_APP_URL` | `https://dev.bikeops.co` | Fallback base URL in emails/links when host header is missing. |
| `ROOT_DOMAIN` | `bikeops.co` | Keep same as production (tenant URL shape unchanged). |
| `RESEND_API_KEY` | Resend key | Same key is fine; use test recipient emails. |
| `FROM_EMAIL` | Verified sender | Must be a domain verified in Resend (e.g. `Bike Ops <no-reply@yourdomain.com>`). |
| `NEXTAUTH_SECRET` | (see above) | |

**Recommended (parity with production):**

| Variable | Notes |
|----------|-------|
| `BLOB_READ_WRITE_TOKEN` | Chat image uploads |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` / `STRIPE_SECRET_KEY` | Use **test** keys on staging |
| `STRIPE_WEBHOOK_SECRET` | Separate Stripe webhook endpoint for `https://dev.bikeops.co/api/webhooks/stripe` if testing billing |

**Usually copy from production Preview or Production as-is:**

- `NEXT_PUBLIC_POSTHOG_*` (optional; events tagged by host)
- `QUO_*` / SMS vars — only if testing SMS on staging

After changing env vars, **redeploy** the `develop` branch (push an empty commit or use **Redeploy** in Vercel).

### 6. Database for staging

If using a fresh database:

```bash
DATABASE_URL="..." DIRECT_URL="..." npm run db:push
DATABASE_URL="..." npm run db:seed
```

Ensure at least one customer with a known email exists for chat sign-in tests, and that **Settings → Features → Chat** is enabled for the shop.

### 7. Marketing project (optional)

The marketing site (`bikeops.co`) can stay production-only. It hard-links to `app.bikeops.co`. For staging, browse the app directly at `https://dev.bikeops.co/chat/c`.

---

## Verify chat sign-in fix on `dev.bikeops.co`

After `develop` is deployed and the domain is active:

1. Open **`https://dev.bikeops.co/chat/c`**
2. Enter an email that exists as a customer on the **staging** database.
3. Submit **Send sign-in link**.
4. Open the email and confirm the link target is:
   - **`https://dev.bikeops.co/chat/c#token=...`** (fragment, not `/open/login?token=`)
5. Click the link (or **Continue in browser** if the mail client opened `/open/login#token=...` first).
6. Confirm you land in the chat UI (not a dead end or expired-token loop).

**Debug endpoints (Preview only):**

- `GET https://dev.bikeops.co/api/debug/env` — confirms `RESEND_API_KEY` resolves and `getAppUrl()` (optional; magic links prefer the request `Host` header).

**Resend checklist:**

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
| Preview environment variables | You |
| Staging database (recommended) | You |
| `git push origin develop` (if not pushed yet) | You — approve push |
| Vercel CLI locally (`vercel login`) | Optional; dashboard is enough |

---

## Quick reference

| Environment | Branch | URL |
|-------------|--------|-----|
| Production | `main` | `app.bikeops.co`, `bbm.bikeops.co`, … |
| Staging | `develop` | `dev.bikeops.co` |
| Local | any | `http://localhost:3000` |
