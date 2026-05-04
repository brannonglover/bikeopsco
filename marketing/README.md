# Bike Ops marketing site

This folder is intended to be deployed as the separate Vercel Marketing project.

## Vercel setup

- Create a new Vercel project from this repository.
- Set the project Root Directory to `marketing`.
- Assign `bikeops.co` and `www.bikeops.co` to the marketing project.
- Keep `*.bikeops.co` and `app.bikeops.co` assigned to the app project.

The static page links signup and login traffic to `https://app.bikeops.co`.

## PostHog setup

- In `index.html`, replace `phc_REPLACE_WITH_POSTHOG_PROJECT_KEY` with the marketing PostHog project key from PostHog project settings.
- The snippet is guarded so analytics stays disabled until that placeholder is replaced.
- The site tracks automatic pageviews plus custom events for app links, signup/sign-in CTAs, section navigation, and product preview clicks.
- The default API host is `https://us.i.posthog.com`; switch `POSTHOG_API_HOST` to `https://eu.i.posthog.com` if the PostHog project is hosted in the EU.
