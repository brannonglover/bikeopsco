import "server-only";

import { prisma } from "@/lib/db";

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
