# Bike Ops marketing site

This folder is intended to be deployed as the separate Vercel Marketing project.

## Vercel setup

- Create a new Vercel project from this repository.
- Set the project Root Directory to `marketing`.
- Assign `bikeops.co` and `www.bikeops.co` to the marketing project.
- Keep `*.bikeops.co` and `app.bikeops.co` assigned to the app project.

The static page links signup and login traffic to `https://app.bikeops.co`.

Legal and support pages (for App Store Connect and compliance):

- `https://bikeops.co/support` — shop and customer help, contact email and phone
- `https://bikeops.co/privacy` — privacy policy
- `https://bikeops.co/releases` — product release notes (loads published notes from `app.bikeops.co/api/releases`)

### Release notes (automated)

1. Merge to `main` → GitHub Action `release-notes` creates a **draft** in the app DB.
2. Review/edit/publish at `https://app.bikeops.co/admin/releases`.
3. Published notes appear on this marketing page (latest first). Notes cover bike-shop-facing Bike Ops app features and bug fixes (what helps owners and staff day to day)—not marketing, Prisma/schema, seed data, or internal work. The in-app **What’s new** link deep-links to the matching version.
4. The in-app **Update available** banner waits until notes for that deploy are published (or until no draft was created for that ship). Publishing is enough — no second deploy needed.

Required secrets: `PLATFORM_RELEASE_WEBHOOK_SECRET` (Vercel app + GitHub Actions). Set `AI_GATEWAY_API_KEY` in GitHub Actions so drafts are written from the product diff in shop-facing language (without it, bullets fall back to coarse area labels).

Later ideas (not built yet):

- [#6 Delay production deploy until release notes are published](https://github.com/brannonglover/bikeopsco/issues/6)
- [#7 Auto-publish release note drafts](https://github.com/brannonglover/bikeopsco/issues/7)




## PostHog setup

- `index.html` uses the shared PostHog project key for account-wide reporting with the Basement Bike Mechanic site.
- The site tracks pageviews with `site: "bikeopsco"` plus custom events for app links, signup/sign-in CTAs, section navigation, and product preview clicks.
- The default API host is `https://us.i.posthog.com`; switch `POSTHOG_API_HOST` to `https://eu.i.posthog.com` if the PostHog project is hosted in the EU.
- To exclude a browser from tracking, visit `https://bikeops.co/?posthog_opt_out=1` once from that browser. The opt-out cookie is set on `.bikeops.co` so it applies to both `bikeops.co` and `app.bikeops.co`. To re-enable tracking, visit `https://bikeops.co/?posthog_opt_out=0`.
- PostHog is automatically disabled on `localhost` and `127.0.0.1` so local development never sends events.
