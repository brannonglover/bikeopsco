import "server-only";

import { prisma } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

const DEFAULT_SHOP_ID = "shop_default";

export type PlatformShopRow = {
  id: string;
  name: string;
  subdomain: string;
  createdAt: Date;
  billingStatus: string;
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
  userCount: number;
  customerCount: number;
  jobCount: number;
};

export async function listPlatformShops(): Promise<PlatformShopRow[]> {
  const shops = await prisma.shop.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      subdomain: true,
      createdAt: true,
      billingStatus: true,
      trialEndsAt: true,
      stripeCustomerId: true,
      users: {
        orderBy: { createdAt: "asc" },
        take: 1,
        select: {
          email: true,
          name: true,
        },
      },
      _count: {
        select: {
          users: true,
          customers: true,
          jobs: true,
        },
      },
    },
  });

  return shops.map((shop) => ({
    id: shop.id,
    name: shop.name,
    subdomain: shop.subdomain,
    createdAt: shop.createdAt,
    billingStatus: shop.billingStatus,
    trialEndsAt: shop.trialEndsAt,
    stripeCustomerId: shop.stripeCustomerId,
    ownerEmail: shop.users[0]?.email ?? null,
    ownerName: shop.users[0]?.name ?? null,
    userCount: shop._count.users,
    customerCount: shop._count.customers,
    jobCount: shop._count.jobs,
  }));
}

export type DeletePlatformShopResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "protected" | "error"; message?: string };

export async function deletePlatformShop(shopId: string): Promise<DeletePlatformShopResult> {
  if (shopId === DEFAULT_SHOP_ID) {
    return { ok: false, reason: "protected", message: "The default shop cannot be deleted." };
  }

  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: {
      id: true,
      subdomain: true,
      stripeSubscriptionId: true,
    },
  });

  if (!shop) {
    return { ok: false, reason: "not_found" };
  }

  if (shop.stripeSubscriptionId) {
    try {
      const stripe = getStripe();
      await stripe.subscriptions.cancel(shop.stripeSubscriptionId);
    } catch (error) {
      console.error(`deletePlatformShop: Stripe cancel failed for ${shopId}:`, error);
      return {
        ok: false,
        reason: "error",
        message: "Could not cancel the shop's Stripe subscription.",
      };
    }
  }

  try {
    await prisma.$transaction([
      prisma.pendingSignup.deleteMany({ where: { subdomain: shop.subdomain } }),
      prisma.shop.delete({ where: { id: shop.id } }),
    ]);
    return { ok: true };
  } catch (error) {
    console.error(`deletePlatformShop: delete failed for ${shopId}:`, error);
    return { ok: false, reason: "error", message: "Could not delete shop." };
  }
}
