# Bike Ops marketing site

This folder is intended to be deployed as the separate Vercel Marketing project.

## Vercel setup

- Create a new Vercel project from this repository.
- Set the project Root Directory to `marketing`.
- Assign `bikeops.co` and `www.bikeops.co` to the marketing project.
- Keep `*.bikeops.co` and `app.bikeops.co` assigned to the app project.

The static page links signup and login traffic to `https://app.bikeops.co`.

## PostHog setup

- `index.html` uses the shared PostHog project key for account-wide reporting with the Basement Bike Mechanic site.
- The site tracks pageviews with `site: "bikeopsco"` plus custom events for app links, signup/sign-in CTAs, section navigation, and product preview clicks.
- The default API host is `https://us.i.posthog.com`; switch `POSTHOG_API_HOST` to `https://eu.i.posthog.com` if the PostHog project is hosted in the EU.
- To exclude a browser from tracking, visit `https://bikeops.co/?posthog_opt_out=1` once from that browser. To re-enable tracking, visit `https://bikeops.co/?posthog_opt_out=0`.
