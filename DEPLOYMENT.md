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

In **bikeopsco** → Settings → Environment Variables, set **Preview** values (optionally scoped to branch `develop`):

| Variable | Staging value | Notes |
|----------|---------------|-------|
| `DATABASE_URL` | Separate Postgres URL | **Use a separate Supabase/Neon project** — do not point staging at production data. |
| `DIRECT_URL` | Same DB direct URL | Required with Supabase pooling. |
| `NEXTAUTH_SECRET` | Random string | Can differ from production. |
| `NEXTAUTH_URL` | `https://dev.bikeops.co` | NextAuth callback base. |
| `NEXT_PUBLIC_APP_URL` | `https://dev.bikeops.co` | Links in emails when host header is missing. |
| `ROOT_DOMAIN` | `bikeops.co` | Same as production. |
| `RESEND_API_KEY` | Resend key | Same key OK; use test recipient emails. |
| `FROM_EMAIL` | Verified sender | Domain must be verified in Resend. |

**Recommended for parity:** `BLOB_READ_WRITE_TOKEN`, Stripe **test** keys (`STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`), and a separate `STRIPE_WEBHOOK_SECRET` for `https://dev.bikeops.co/api/webhooks/stripe` if testing billing.

**Production-only vars** stay on the **Production** environment (`main` deploys). After changing Preview vars, redeploy `develop` (push a commit or Redeploy in Vercel).

### Staging database

On a fresh staging database:

```bash
DATABASE_URL="..." DIRECT_URL="..." npm run db:push
DATABASE_URL="..." npm run db:seed
```

Seed creates fake/demo data suitable for testing on dev.

## Quick checks

- Staging deploy: `vercel inspect dev.bikeops.co` (should show `target: preview`, `develop` branch)
- Debug env (Preview): `GET https://dev.bikeops.co/api/debug/env`
- Chat sign-in test: `https://dev.bikeops.co/chat/c` — magic link should use `dev.bikeops.co`, not production hosts

## Related docs

- [docs/staging-environment.md](docs/staging-environment.md) — full staging setup, chat sign-in verification, blockers checklist
- [docs/saas-multitenancy-rollout.md](docs/saas-multitenancy-rollout.md) — production domain architecture (`*.bikeops.co`, marketing split)
- [.env.example](.env.example) — local and staging env var comments
