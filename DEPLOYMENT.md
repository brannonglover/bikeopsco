# Deployment workflow

Bike Ops uses two Git branches and two Vercel environments. There is no GitHub Actions pipeline — Vercel builds on push via its Git integration.

## Database connection fix checklist (Supabase + Vercel + Prisma)

Use this **in order** when builds fail with `P1012`, `P1001`, or `P1000` during `prisma migrate deploy`.

### 1. Supabase — confirm project is alive

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) → select the **correct** project (staging vs production are separate projects).
2. If the project shows **Paused**, click **Restore** and wait until status is **Active**.
3. Go to **Project Settings → Database**.
4. Click **Reset database password** if you have ever pasted the wrong value or are unsure. Copy the **new** password immediately.
5. Under **Connection string**, open the **URI** tab. Note the **project ref** in the username (`postgres.abcdefghij…`).

### 2. Copy the two correct strings (not “Direct connection”)

In **Connection string**, use the pooler panel — **not** the legacy **Direct connection** (`db.*.supabase.co`).

| Step | Supabase UI | Vercel variable |
|------|-------------|-----------------|
| A | **Transaction** mode | `DATABASE_URL` |
| B | **Session** mode | `DIRECT_URL` |

For each string:

- Username must be `postgres.[project-ref]` (copy from UI). **Never** bare `postgres`.
- Password is the **database password** from step 1. **Not** the `anon` key, **not** `service_role`, **not** `sbp_` tokens.
- If the password contains `@`, `#`, or `%`, [URL-encode](https://developer.mozilla.org/en-US/docs/Glossary/Percent-encoding) them (`@` → `%40`, `#` → `%23`, `%` → `%25`).

**Copy template** (replace placeholders; same password and project ref in both):

```text
DATABASE_URL=postgresql://postgres.[PROJECT-REF]:[URL-ENCODED-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require

DIRECT_URL=postgresql://postgres.[PROJECT-REF]:[URL-ENCODED-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres?sslmode=require
```

**Sanity checks:**

| Check | `DATABASE_URL` | `DIRECT_URL` |
|-------|----------------|--------------|
| Port | **6543** | **5432** |
| Host | `*.pooler.supabase.com` | `*.pooler.supabase.com` |
| `?pgbouncer=true` | **Yes** | **No** |
| `db.*.supabase.co` | **Never** | **Never** |

### 3. Vercel — set the right **scope** (most common mistake)

Vercel **Development** ≠ Git branch `develop`. Push builds never use **Development**.

| What you deploy | Vercel environment target | Git branch |
|-----------------|---------------------------|------------|
| `dev.bikeops.co` (staging) | **Preview** (optionally scoped to branch `develop`) | `develop` |
| `app.bikeops.co` (production) | **Production** | `main` |

1. [Vercel Dashboard](https://vercel.com) → project **bikeopsco** → **Settings → Environment Variables**.
2. For **staging**: add or edit `DATABASE_URL` and `DIRECT_URL` with **Preview** checked (and **Git branch: develop** if offered). **Uncheck Development** unless you use `vercel dev`.
3. For **production**: separate entries with **Production** checked only (staging URLs must not be on Production).
4. Paste values with **no trailing spaces or newlines**. Save each var.
5. **Deployments →** latest failed deploy → **⋯ → Redeploy** (required after env changes).

CLI check (values hidden): `vercel env ls | rg 'DATABASE|DIRECT'`

Expected today: `DATABASE_URL` / `DIRECT_URL` on **Production** and **Preview (develop)** as separate rows.

### 4. Validate locally before pushing

```bash
DATABASE_URL="postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require" \
DIRECT_URL="postgresql://postgres.[ref]:[pass]@aws-0-[region].pooler.supabase.com:5432/postgres?sslmode=require" \
npm run db:validate-env
```

Optional: run `npm run db:migrate` against the staging DB to confirm auth before Vercel builds.

### 5. What to look for in the next build log

**Success:**

```text
Applying migration ...
```

**If validation fails before Prisma** (build stops early):

```text
Error: DATABASE_URL / DIRECT_URL failed validation before Prisma.
── DATABASE_URL ──
  username:     postgres.[ref]
  ...
Run: npm run db:validate-env
```

**Failure patterns:**

| Log message | Meaning | Fix |
|-------------|---------|-----|
| `P1012` / `Environment variable not found: DIRECT_URL` | Var missing at build time | Set on **Preview** or **Production**, redeploy |
| `invalid DIRECT_URL` / `db.*.supabase.co` | Legacy direct host | Use Session pooler URI (step 2B) |
| `P1001: Can't reach database server` | Wrong host/port or paused project | Pooler host, restore Supabase project |
| `P1000: Authentication failed` / `for user postgres` | Wrong password or bare `postgres` user | Reset DB password; use `postgres.[ref]`; URL-encode |
| `username is bare postgres` (validator) | Copied old-style URI | Re-copy from Supabase Connection string UI |

After a successful Preview deploy: `curl -s https://dev.bikeops.co/api/debug/env | jq .databaseUrlHostHint` — staging host should **not** match production if databases are split.

### Common mistakes (quick reference)

1. **Wrong Vercel scope** — vars only under Development; Preview build still fails.
2. **Username `postgres`** instead of `postgres.[project-ref]`.
3. **Password not URL-encoded** (`@`, `#`, `%` in password).
4. **Password from wrong Supabase project** (staging URL on Preview, prod password).
5. **`DIRECT_URL` with `?pgbouncer=true` or port 6543** — migrations need Session / 5432.
6. **`DATABASE_URL` without `?pgbouncer=true` on port 6543**.
7. **Trailing whitespace** when pasting into Vercel.
8. **Using anon/service_role API key** instead of database password.
9. **Supabase project paused** (free tier).
10. **Preview branch var** not scoped to `develop` while deploying a different branch.

---

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

### Vercel environment scopes (read this first)

Vercel has three **environment targets**. They are not the same as Git branch names:

| Vercel target | Used when | `develop` branch? | `main` branch? |
|---------------|-----------|-------------------|----------------|
| **Preview** | Git push builds for non-production branches | **Yes** — `dev.bikeops.co` | No |
| **Production** | Git push builds for the production branch (`main`) | No | **Yes** |
| **Development** | Local **`vercel dev`** only | Never on push builds | Never on push builds |

**Common mistake:** Setting `DATABASE_URL` / `DIRECT_URL` under **Development** does **not** fix Preview builds for `develop`. Staging needs **Preview** (optionally scoped to Git branch `develop`). Production needs **Production**.

In the dashboard: **Settings → Environment Variables** → each var shows which targets are checked. After changes, **Redeploy** (env vars are not applied to past deployments).

CLI check: `vercel env ls | rg DATABASE` — confirm separate rows for **Production** and **Preview (develop)**.

### Environment variables (Preview / staging)

**Confirmed (2026-06-14):** Preview still shares Production `DATABASE_URL` / `DIRECT_URL` (same Supabase host `aws-0-us-west-2.pooler.supabase.com`). Provision a separate Postgres project and scope those vars to Preview only. Verify with `GET /api/debug/env` → `databaseUrlHostHint`. Full audit and checklist: [docs/staging-environment.md](docs/staging-environment.md).

In **bikeopsco** → Settings → Environment Variables, set **Preview** values (optionally scoped to branch `develop`):

| Variable | Staging value | Notes |
|----------|---------------|-------|
| `DATABASE_URL` | Separate Postgres URL | **Must differ from Production** — do not point staging at production data. |
| `DIRECT_URL` | Session pooler URL (port 5432) | **Not** `db.*.supabase.co` — use pooler Session mode. |
| `NEXTAUTH_SECRET` | Random string | Can differ from production. |
| `NEXTAUTH_URL` | `https://dev.bikeops.co` | NextAuth callback base. |
| `NEXT_PUBLIC_APP_URL` | `https://dev.bikeops.co` | Links in emails when host header is missing. |
| `ROOT_DOMAIN` | `bikeops.co` | Same as production. |
| `FROM_EMAIL` | Verified sender | Only if testing email on staging. |

**Do not copy Production Twilio/Quo/Resend keys to Preview** unless using sandbox/test accounts. Customer notifications are blocked on Preview by default (`ALLOW_CUSTOMER_NOTIFICATIONS=true` to override on an isolated DB).

**Recommended for parity:** `BLOB_READ_WRITE_TOKEN`, Stripe **test** keys, separate `STRIPE_WEBHOOK_SECRET` for `https://dev.bikeops.co/api/webhooks/stripe`.

**Production-only vars** stay on the **Production** environment. After changing Preview vars, redeploy `develop`.

### Supabase connection strings (Vercel)

Prisma needs **two** URLs when using Supabase pooling. Copy both from **Project Settings → Database → Connection string** — not the legacy “Direct connection” panel.

| Variable | Supabase mode | Host | Port | Query params |
|----------|---------------|------|------|--------------|
| `DATABASE_URL` | **Transaction** pooler | `aws-0-[region].pooler.supabase.com` | **6543** | `?pgbouncer=true&sslmode=require` |
| `DIRECT_URL` | **Session** pooler | `aws-0-[region].pooler.supabase.com` | **5432** | `?sslmode=require` (no `pgbouncer=true`) |

Username for both is `postgres.[project-ref]` (e.g. `postgres.nshrozsfixyeihthjxxi`), **not** `postgres`.

**Do not use** `db.[project-ref].supabase.co:5432` for `DIRECT_URL`. That hostname is often IPv6-only and fails during Vercel builds with `P1001: Can't reach database server`.

Example (replace password and region):

```bash
DATABASE_URL="postgresql://postgres.REF:PASSWORD@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
DIRECT_URL="postgresql://postgres.REF:PASSWORD@aws-0-us-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
```

URL-encode special characters in the password (`@` → `%40`, `#` → `%23`, `%` → `%25`).

Set both on **Preview** (staging) and **Production** in Vercel, then redeploy. `npm run build` runs `prisma migrate deploy` and requires a reachable `DIRECT_URL`.

If the project is paused (Supabase free tier), restore it in the dashboard before redeploying.

### Username correct but build still fails? (P1000 / auth)

If the username is already `postgres.[project-ref]` and you still see **P1000** (auth failed) or connection errors, check these **in order**:

1. **Database password (not API key)** — Supabase → **Project Settings → Database → Database password** → Reset if unsure. Do **not** paste the anon key, service_role key, or connection-pooling “pooler password” from the API page.
2. **URL-encode the password** — If the password contains `@`, `#`, `%`, `/`, or `+`, encode them in the URL (`@` → `%40`, `#` → `%23`, `%` → `%25`). A correct username with a raw `@` in the password will still fail auth.
3. **Same Supabase project for both URLs** — `DATABASE_URL` and `DIRECT_URL` must use the **same** `postgres.[project-ref]` (staging Preview vars → staging project; Production vars → prod project). Mixing refs causes auth failures.
4. **Vercel scope + redeploy** — Vars must be on **Preview (develop)** for `dev.bikeops.co` and **Production** for `main`. After any change: **Deployments → … → Redeploy** (env vars do not apply to old builds).
5. **No trailing newline** — In Vercel’s env editor, paste the URL once with no extra line break at the end. Run locally: `npm run db:validate-env` (loads `.env`) to see safe diagnostics.

`npm run build` runs validation before `prisma migrate deploy`. A passing local `db:validate-env` does not prove the password is correct — only that structure, ports, and refs look right.

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
