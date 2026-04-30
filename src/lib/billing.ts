import "server-only";

import Stripe from "stripe";
import { prisma } from "@/lib/db";

export const BIKEOPS_MONTHLY_PRICE = 39.99;
export const BIKEOPS_TRIAL_DAYS = 14;

const ACTIVE_BILLING_STATUSES = new Set(["active", "trialing"]);
const DEFAULT_BILLING_EXEMPT_SUBDOMAINS = ["bbm"];

export function getBikeOpsPriceId(): string {
  const priceId =
    process.env.STRIPE_BIKEOPS_MONTHLY_PRICE_ID?.trim() ||
    process.env.STRIPE_SAAS_PRICE_ID?.trim();
  if (!priceId) {
    throw new Error("STRIPE_BIKEOPS_MONTHLY_PRICE_ID is not set.");
  }
  return priceId;
}

export function addTrialDays(from = new Date()): Date {
  const trialEndsAt = new Date(from);
  trialEndsAt.setDate(trialEndsAt.getDate() + BIKEOPS_TRIAL_DAYS);
  return trialEndsAt;
}

export function isBillingExemptShop(input: { subdomain: string }): boolean {
  const configuredSubdomains = process.env.BIKEOPS_BILLING_EXEMPT_SUBDOMAINS?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const exemptSubdomains = configuredSubdomains?.length
    ? configuredSubdomains
    : DEFAULT_BILLING_EXEMPT_SUBDOMAINS;

  return exemptSubdomains.includes(input.subdomain);
}

export function isBillingActive(input: {
  billingStatus: string;
  trialEndsAt: Date | null;
}): boolean {
  if (ACTIVE_BILLING_STATUSES.has(input.billingStatus)) return true;
  return !!input.trialEndsAt && input.trialEndsAt.getTime() > Date.now();
}

export function toStripeDate(timestamp: number | null | undefined): Date | null {
  return typeof timestamp === "number" ? new Date(timestamp * 1000) : null;
}

export function getSubscriptionPriceId(subscription: Stripe.Subscription): string | null {
  return subscription.items.data[0]?.price.id ?? null;
}

export function getSubscriptionCurrentPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const periodEnd = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((value): value is number => typeof value === "number")
    .sort((a, b) => a - b)[0];
  return toStripeDate(periodEnd);
}

export async function syncStripeSubscription(subscription: Stripe.Subscription) {
  const shopId =
    typeof subscription.metadata?.shopId === "string" && subscription.metadata.shopId.trim()
      ? subscription.metadata.shopId.trim()
      : null;
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  await prisma.shop.updateMany({
    where: {
      OR: [
        ...(shopId ? [{ id: shopId }] : []),
        { stripeCustomerId: customerId },
        { stripeSubscriptionId: subscription.id },
      ],
    },
    data: {
      billingStatus: subscription.status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: getSubscriptionPriceId(subscription),
      trialEndsAt: toStripeDate(subscription.trial_end),
      stripeCurrentPeriodEnd: getSubscriptionCurrentPeriodEnd(subscription),
      stripeCancelAtPeriodEnd: subscription.cancel_at_period_end,
      stripeSubscriptionUpdatedAt: new Date(),
    },
  });
}
