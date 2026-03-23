# Bike Ops – Bike Repair Shop Software

A Next.js app for managing bike repair jobs, customers, and automated customer emails.

## Features

- **Kanban calendar** – 5 stages: Received, Working On, Waiting on Parts, Bike Ready, Completed
- **Payments** – Stripe integration for card, Apple Pay, and Google Pay (online and in-person)
- **Drag-and-drop** – Move jobs between stages
- **Job creation** – Bike make/model, customer, drop-off vs collection service, dates
- **Address & directions** – Customer address on job cards with Google Maps link
- **Week filter** – View jobs by week
- **Automatic emails** – Stage-based emails via Resend (bike arrived, working on, ready, etc.)
- **Customizable templates** – Edit email subject/body in Settings
- **3-day follow-up** – Cron job sends review request 3 days after completion

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Database (Supabase / PostgreSQL)

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Project Settings → Database**
3. Under **Connection string**, select **URI** and copy it
4. Replace `[YOUR-PASSWORD]` with your database password (from the same page)
5. Add to `.env` (include `?sslmode=require` for Supabase):
   ```
   DATABASE_URL="postgresql://postgres.[project-ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require"
   ```
   Or use the **Direct connection** from the Supabase dashboard (port 5432) with `?sslmode=require` appended.
6. Run:
   ```bash
   npm run db:push
   npm run db:seed
   ```

**"Can't reach database server"?** Common causes:

1. **Project paused** (most likely on free tier):  
   [Supabase Dashboard](https://supabase.com/dashboard) → select project → if paused, click **Restore project** → wait 1–2 min → re-run `db:push` and `db:seed`.

2. **Try the pooler connection instead of direct**:  
   Project Settings → Database → Connection string → choose **Session** or **Transaction** (pooler) and copy that URI. It uses `pooler.supabase.com` instead of `db....supabase.co`. Add `?sslmode=require` if missing.

3. **Password encoding**: If the password has `@`, `#`, `%`, etc., URL-encode them: `@`→`%40`, `#`→`%23`, `%`→`%25`.

### 3. Email (Resend)

Get an API key from [resend.com](https://resend.com) and add to `.env`:

```
RESEND_API_KEY="re_xxx"
FROM_EMAIL="Bike Ops <notifications@yourdomain.com>"
```

### 4. Payments (Stripe)

Accept card, Apple Pay, and Google Pay payments:

1. Create an account at [stripe.com](https://stripe.com)
2. Get your API keys from [dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys)
3. Add to `.env`:

```
STRIPE_SECRET_KEY="sk_test_xxx"
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_xxx"
STRIPE_WEBHOOK_SECRET="whsec_xxx"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

4. **Webhook** (required for payment confirmation):  
   - Local: Use [Stripe CLI](https://stripe.com/docs/stripe-cli): `stripe listen --forward-to localhost:3000/api/webhooks/stripe`  
   - Production: Add `https://yourdomain.com/api/webhooks/stripe` in [Stripe Webhooks](https://dashboard.stripe.com/webhooks), select `payment_intent.succeeded`

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Booking widget (website embed)

Add a "Book Now" modal to your marketing site (e.g. basementbikemechanic.com) that posts directly to the Job Board.

1. Add the widget script to your site, replacing `YOUR-BIKEOPS-DOMAIN.com` with your deployed Bike Ops URL:

```html
<script src="https://YOUR-BIKEOPS-DOMAIN.com/widget.js" data-base-url="https://YOUR-BIKEOPS-DOMAIN.com"></script>
```

2. Add `data-bikeops-book` to your Book Now button or link:

```html
<a href="#" data-bikeops-book>Book Now</a>
```

When clicked, a modal opens with the booking form. Customers enter their info, bike details, preferred dates, and services. On success, the job appears in the Job Board and the customer receives the booking confirmation email.

**Direct booking URL:** You can also link directly to `/book` if you prefer (e.g. `https://YOUR-BIKEOPS-DOMAIN.com/book`).

**Custom selector:** Use `data-bikeops-selector=".my-class"` on the script tag to target different elements.

## Cron (3-day follow-up)

On Vercel, the cron runs daily at 9:00 UTC. For local or other hosts, call:

```
GET /api/cron/send-follow-ups
```

Optionally set `CRON_SECRET` in env and pass `Authorization: Bearer <CRON_SECRET>`.
