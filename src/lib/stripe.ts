import Stripe from "stripe";

function getStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.trim() === "" || key === "sk_test_xxx") {
    throw new Error("STRIPE_SECRET_KEY is not set. Add your key to .env to enable payments.");
  }
  return new Stripe(key, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });
}

export const stripe = getStripeClient();

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}
