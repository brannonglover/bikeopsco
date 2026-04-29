# BikeOps SaaS rollout (subdomains)

## Goal

- `bikeops.co` = marketing site
- `*.bikeops.co` = app (tenant subdomains like `bbm.bikeops.co`)
- `app.bikeops.co` = shared app entry for login/signup

## Data safety (existing boards)

The migration `20260429120000_add_shops_multitenancy`:

- Adds a `Shop` table
- Creates a default shop (`id = shop_default`, `subdomain = bbm`)
- Adds required `shopId` columns to existing tables and **backfills all existing rows** to `shop_default`
- Does **not** drop any existing tables

This means existing jobs/customers/etc remain intact and are now owned by the default shop.

## Suggested rollout order (minimize downtime)

1. **Backup first**
   - Take a DB snapshot/backup before deploying migrations.

2. **Deploy the app update**
   - Deploy the current Next.js app (this repo) to your Vercel “App” project.
   - Ensure `ROOT_DOMAIN=bikeops.co` is set in the App project env.

3. **Add wildcard domain to the App project**
   - In Vercel Project Settings → Domains:
     - Add `bikeops.co` (for verification) if prompted
     - Add `*.bikeops.co`
   - Wildcard domains typically require using Vercel DNS / nameservers (or the `_acme-challenge` NS delegation workaround).

4. **Verify tenant subdomain works**
   - Visit `bbm.bikeops.co` and confirm you see your existing board/jobs.

5. **Make sure `www` doesn’t get treated as a tenant**
   - If your apex domain redirects to `www.bikeops.co`, reserve `www` so it does **not** attempt to resolve to a `Shop.subdomain = "www"`.
   - This repo reserves `www`, `app`, and other operational subdomains in `/Users/bglover/projects/bikeopsco/src/lib/tenant-domain.ts`.

6. **Verify shared app entry**
   - Visit `app.bikeops.co/login`.
   - Enter an existing shop subdomain (for example `bbm`) and confirm it sends you to that tenant login page.
   - Visit `app.bikeops.co/signup` and confirm a new shop can create a tenant workspace.

7. **Move the apex domain to Marketing**
   - Create a separate Vercel “Marketing” project.
   - Use this repo with Root Directory set to `/Users/bglover/projects/bikeopsco/marketing`.
   - Assign `bikeops.co` (and optionally `www.bikeops.co`) to the Marketing project.
   - Keep the App project on `*.bikeops.co`.

8. **Optional temporary redirect**
   - If staff/customers are used to the apex domain for the app, add a short-lived redirect on the marketing site (or a banner) pointing to `bbm.bikeops.co` until onboarding is complete.

## Implemented MVP onboarding behavior

- `POST /api/signup` creates a new `Shop`, first staff `User`, app settings, review settings, system collection services, and cloned email templates.
- `/signup` is a public signup page for creating a tenant workspace.
- `app.bikeops.co/login` is a workspace finder that redirects staff to `shop-subdomain.bikeops.co/login`.
- If a logged-in user visits protected routes on `app.bikeops.co`, middleware redirects them back to their tenant subdomain.

## Next MVP tasks

- “Shop not found” UX for unknown subdomains
- Marketing Vercel project:
  - Create a Vercel project from `/Users/bglover/projects/bikeopsco/marketing`
  - Add CTAs to `app.bikeops.co/signup` and `app.bikeops.co/login`
  - Keep all tenant app traffic on `*.bikeops.co`
- Decide payment integration strategy (Stripe/Square/etc), likely via per-shop “payment provider” settings
