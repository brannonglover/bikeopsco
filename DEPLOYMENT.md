# Deployment workflow

Bike Ops uses two Git branches and two Vercel environments. There is no GitHub Actions pipeline — Vercel builds on push via its Git integration.

## Branches and URLs

| Environment | Git branch | Vercel target | URL |
|-------------|------------|---------------|-----|
| **Production** | `main` | Production | `app.bikeops.co`, `*.bikeops.co` (tenant subdomains) |
| **Staging** | `develop` | Preview (branch domain) | [dev.bikeops.co](https://dev.bikeops.co) |
| **Marketing** | `main` | Production (separate project) | `bikeops.co`, `www.bikeops.co` |

## Day-to-day workflow

```text
feature branch → develop (staging) → main (production)
```

1. Push fixes or features to **`develop`** (directly or via a feature branch merged into `develop`).
2. Vercel deploys automatically. Test on **`https://dev.bikeops.co`** with staging/fake data.
3. When ready, open a **PR from `develop` → `main`**, review, and merge.
4. Production updates automatically on merge to `main`. Do not push untested changes directly to `main`.

**Staging testing:** Use `dev.bikeops.co` only. Tenant hosts like `bbm.bikeops.co` still route to the **production** deployment via the `*.bikeops.co` wildcard.

## Vercel projects

| Project | Root directory | Production branch |
|---------|----------------|-------------------|
| **bikeopsco** (App) | repo root | `main` |
| **bikeopsco-marketing** | `marketing/` | `main` |

App config lives in `vercel.json` at the repo root (crons, install command). The marketing site is a separate Vercel project.

## One-time / manual Vercel setup

These steps are done in the [Vercel dashboard](https://vercel.com) (CLI optional). Full detail: [docs/staging-environment.md](docs/staging-environment.md).

### Already configured (verify if staging breaks)

- [ ] **bikeopsco** → Settings → Git → Production Branch = `main`
- [ ] **bikeopsco** → Settings → Domains → `dev.bikeops.co` assigned to Git branch **`develop`** (Preview)
- [ ] DNS CNAME: `dev` → `cname.vercel-dns.com` (Vercel nameservers on `bikeops.co`)

### Environment variables (Preview / staging)

**Confirmed (2026-06-14):** Preview still shares Production `DATABASE_URL` / `DIRECT_URL` (same Supabase host `aws-0-us-west-2.pooler.supabase.com`). Provision a separate Postgres project and scope those vars to Preview only. Verify with `GET /api/debug/env` → `databaseUrlHostHint`. Full audit and checklist: [docs/staging-environment.md](docs/staging-environment.md).

In **bikeopsco** → Settings → Environment Variables, set **Preview** values (optionally scoped to branch `develop`):

| Variable | Staging value | Notes |
|----------|---------------|-------|
| `DATABASE_URL` | Separate Postgres URL | **Must differ from Production** — do not point staging at production data. |
| `DIRECT_URL` | Same DB direct URL | Required with Supabase pooling. |
| `NEXTAUTH_SECRET` | Random string | Can differ from production. |
| `NEXTAUTH_URL` | `https://dev.bikeops.co` | NextAuth callback base. |
| `NEXT_PUBLIC_APP_URL` | `https://dev.bikeops.co` | Links in emails when host header is missing. |
| `ROOT_DOMAIN` | `bikeops.co` | Same as production. |
| `FROM_EMAIL` | Verified sender | Only if testing email on staging. |

**Do not copy Production Twilio/Quo/Resend keys to Preview** unless using sandbox/test accounts. Customer notifications are blocked on Preview by default (`ALLOW_CUSTOMER_NOTIFICATIONS=true` to override on an isolated DB).

**Recommended for parity:** `BLOB_READ_WRITE_TOKEN`, Stripe **test** keys, separate `STRIPE_WEBHOOK_SECRET` for `https://dev.bikeops.co/api/webhooks/stripe`.

**Production-only vars** stay on the **Production** environment. After changing Preview vars, redeploy `develop`.

### Staging database

On a fresh staging database:

```bash
DATABASE_URL="..." DIRECT_URL="..." npm run db:push
DATABASE_URL="..." ADMIN_EMAIL=... ADMIN_PASSWORD=... STAGING_TEST_EMAIL=... npm run db:seed:staging
```

`db:seed:staging` creates templates, services, a demo customer/job, and disables `notifyCustomerEnabled`.

## Quick checks

- Staging deploy: `vercel inspect dev.bikeops.co` (should show `target: preview`, `develop` branch)
- Debug env (Preview): `GET https://dev.bikeops.co/api/debug/env`
- Chat sign-in test: `https://dev.bikeops.co/chat/c` — magic link should use `dev.bikeops.co`, not production hosts

## Related docs

- [docs/staging-environment.md](docs/staging-environment.md) — full staging setup, chat sign-in verification, blockers checklist
- [docs/saas-multitenancy-rollout.md](docs/saas-multitenancy-rollout.md) — production domain architecture (`*.bikeops.co`, marketing split)
- [.env.example](.env.example) — local and staging env var comments
