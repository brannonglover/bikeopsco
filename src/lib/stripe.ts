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

function getCardSurchargeConfig(): { pct: number; fixed: number } {
  const percent = Number(process.env.CARD_SURCHARGE_PERCENT);
  const fixedCents = Number(process.env.CARD_SURCHARGE_FIXED_CENTS);
  const useDefaults = Number.isNaN(percent) || process.env.CARD_SURCHARGE_PERCENT === undefined;
  const pct = useDefaults ? DEFAULT_SURCHARGE_PERCENT : percent;
  const fixed = Number.isNaN(fixedCents)
    ? DEFAULT_SURCHARGE_FIXED_CENTS / 100
    : fixedCents / 100;
  return { pct, fixed };
}

/**
 * Computes the amount to charge so that after Stripe fees you receive the job total.
 * Applies for "online" and "in_person" (both use Stripe's standard card rate).
 * Terminal (card_present hardware) has a different fee structure and uses the base total.
 */
export function computeAmountWithSurcharge(
  total: number,
  mode: "online" | "in_person" | "terminal"
): number {
  if (mode === "terminal") return total;

  const { pct, fixed: fix } = getCardSurchargeConfig();

  if (pct === 0 && fix === 0) return total;

  // amount - (amount * pct/100 + fix) = total  =>  amount = (total + fix) / (1 - pct/100)
  const amount = (total + fix) / (1 - pct / 100);
  return Math.round(amount * 100) / 100;
}

/**
 * Computes the base job total a given charge amount pays down, excluding the configured card surcharge.
 * This is the inverse of `computeAmountWithSurcharge()` for "online" and "in_person".
 */
export function computeTotalFromChargedAmount(
  amountCharged: number,
  mode: "online" | "in_person" | "terminal"
): number {
  if (mode === "terminal") return amountCharged;
  const { pct, fixed } = getCardSurchargeConfig();
  if (pct === 0 && fixed === 0) return amountCharged;

  // total = amount - (amount * pct/100 + fixed)
  const total = amountCharged - (amountCharged * (pct / 100) + fixed);
  return Math.round(total * 100) / 100;
}
