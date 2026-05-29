# Bike Ops marketing site

This folder is intended to be deployed as the separate Vercel Marketing project.

## Vercel setup

- Create a new Vercel project from this repository.
- Set the project Root Directory to `marketing`.
- Assign `bikeops.co` and `www.bikeops.co` to the marketing project.
- Keep `*.bikeops.co` and `app.bikeops.co` assigned to the app project.

The static page links signup and login traffic to `https://app.bikeops.co`.

Legal and support pages (for App Store Connect and compliance):

- `https://bikeops.co/support` — shop and customer help, contact email, site chat
- `https://bikeops.co/privacy` — privacy policy

## Site chat (Quo)

The marketing pages load `site-chat.js`, which talks to `https://app.bikeops.co/api/site-chat/*`.

On the **app** Vercel project, set:

- `QUO_API_KEY`
- `QUO_PHONE_NUMBER` — your **business** Quo line (E.164)
- `QUO_WEBHOOK_SIGNING_KEY` — from Quo **Settings → Webhooks → your webhook → Reveal signing secret**

Register a Quo message webhook (in the Quo app, not only the API):

- URL: `https://app.bikeops.co/api/webhooks/quo/messages` (no `?secret=` needed)
- Events: **message.received** and **message.delivered**
- Resources: select your **business** phone number only

Staff reply in the Quo app on that business thread; visitors see replies in the website widget.

### Troubleshooting Quo

1. **Replies not in the widget** — almost always missing or wrong `QUO_WEBHOOK_SIGNING_KEY`. App webhooks use the `openphone-signature` header, not a URL query secret.
2. **Texts from personal number** — set `QUO_PHONE_NUMBER` to the business line; remove `QUO_USER_ID`; reply in Quo under the business inbox, not a personal line.
3. **You got an SMS of your own message** — the site relays into Quo by texting the visitor’s phone. When testing, use a number that isn’t your business line, or set `SITE_CHAT_RELAY_SMS_TO_VISITOR=false`.
4. **Missed call** — usually a Quo `call.ringing` event (unrelated to chat). Ignore or disable call webhooks on that URL.
5. **Where messages appear in Quo**: conversation for the visitor’s phone; website posts show as **outgoing** `[Bike Ops web] …`.
6. **Email backup**: each new chat emails `SITE_CHAT_NOTIFY_EMAIL` (or platform signup notify email).

## PostHog setup

- `index.html` uses the shared PostHog project key for account-wide reporting with the Basement Bike Mechanic site.
- The site tracks pageviews with `site: "bikeopsco"` plus custom events for app links, signup/sign-in CTAs, section navigation, and product preview clicks.
- The default API host is `https://us.i.posthog.com`; switch `POSTHOG_API_HOST` to `https://eu.i.posthog.com` if the PostHog project is hosted in the EU.
- To exclude a browser from tracking, visit `https://bikeops.co/?posthog_opt_out=1` once from that browser. The opt-out cookie is set on `.bikeops.co` so it applies to both `bikeops.co` and `app.bikeops.co`. To re-enable tracking, visit `https://bikeops.co/?posthog_opt_out=0`.
- PostHog is automatically disabled on `localhost` and `127.0.0.1` so local development never sends events.
