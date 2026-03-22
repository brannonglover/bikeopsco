import Stripe from "stripe";

let stripeInstance: Stripe | null = null;

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.trim() === "") {
    throw new Error("STRIPE_SECRET_KEY is not set. Add your key to .env to enable payments.");
  }
  if (key === "sk_test_xxx" || key === "sk_live_xxx") {
    throw new Error("STRIPE_SECRET_KEY is still the placeholder. Replace with your real key from Stripe Dashboard → Developers → API keys.");
  }
  return new Stripe(key, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });
}

function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = getStripeClient();
  }
  return stripeInstance;
}

export { getStripe };

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}
