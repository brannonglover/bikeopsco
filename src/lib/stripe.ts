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

/** Stripe's standard fee: 2.9% + $0.30 for domestic online card payments */
const DEFAULT_SURCHARGE_PERCENT = 2.9;
const DEFAULT_SURCHARGE_FIXED_CENTS = 30;

/**
 * Computes the amount to charge so that after Stripe fees you receive the job total.
 * Only applies for mode "online"; in-person payments use the base total.
 */
export function computeAmountWithSurcharge(
  total: number,
  mode: "online" | "in_person"
): number {
  if (mode !== "online") return total;

  const percent = Number(process.env.CARD_SURCHARGE_PERCENT);
  const fixedCents = Number(process.env.CARD_SURCHARGE_FIXED_CENTS);
  const useDefaults = Number.isNaN(percent) || process.env.CARD_SURCHARGE_PERCENT === undefined;
  const pct = useDefaults ? DEFAULT_SURCHARGE_PERCENT : percent;
  const fix = Number.isNaN(fixedCents)
    ? DEFAULT_SURCHARGE_FIXED_CENTS / 100
    : fixedCents / 100;

  if (pct === 0 && fix === 0) return total;

  // amount - (amount * pct/100 + fix) = total  =>  amount = (total + fix) / (1 - pct/100)
  const amount = (total + fix) / (1 - pct / 100);
  return Math.round(amount * 100) / 100;
}
