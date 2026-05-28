# Bike Ops marketing site

This folder is intended to be deployed as the separate Vercel Marketing project.

## Vercel setup

- Create a new Vercel project from this repository.
- Set the project Root Directory to `marketing`.
- Assign `bikeops.co` and `www.bikeops.co` to the marketing project.
- Keep `*.bikeops.co` and `app.bikeops.co` assigned to the app project.

The static page links signup and login traffic to `https://app.bikeops.co`.

## Site chat (Quo)

The marketing pages load `site-chat.js`, which talks to `https://app.bikeops.co/api/site-chat/*`.

On the **app** Vercel project, set `QUO_API_KEY`, `QUO_PHONE_NUMBER`, and `QUO_WEBHOOK_SECRET`, then register a Quo message webhook pointing at:

`https://app.bikeops.co/api/webhooks/quo/messages?secret=YOUR_QUO_WEBHOOK_SECRET`

Staff reply in the Quo app; visitors see replies in the website widget (and may also receive SMS).

### Troubleshooting Quo

1. **Env vars on the app project** (not marketing): `QUO_API_KEY`, `QUO_PHONE_NUMBER` (E.164, same as your Quo line).
2. **Deploy the app** with the site-chat API routes and run `npx prisma migrate deploy`.
3. **Check config**: `https://app.bikeops.co/api/site-chat/status` should return `"quoConfigured": true`.
4. **Where messages appear in Quo**: open the conversation for the visitor’s phone number. Website messages show as an **outgoing** SMS prefixed with `[Bike Ops web]` (not as a new inbound).
5. **A2P / carrier registration** must be approved in Quo for US SMS, or the API returns an error.
6. **Email backup**: each new chat also emails `SITE_CHAT_NOTIFY_EMAIL` (or platform signup notify email) via Resend.

## PostHog setup

- `index.html` uses the shared PostHog project key for account-wide reporting with the Basement Bike Mechanic site.
- The site tracks pageviews with `site: "bikeopsco"` plus custom events for app links, signup/sign-in CTAs, section navigation, and product preview clicks.
- The default API host is `https://us.i.posthog.com`; switch `POSTHOG_API_HOST` to `https://eu.i.posthog.com` if the PostHog project is hosted in the EU.
- To exclude a browser from tracking, visit `https://bikeops.co/?posthog_opt_out=1` once from that browser. The opt-out cookie is set on `.bikeops.co` so it applies to both `bikeops.co` and `app.bikeops.co`. To re-enable tracking, visit `https://bikeops.co/?posthog_opt_out=0`.
- PostHog is automatically disabled on `localhost` and `127.0.0.1` so local development never sends events.
