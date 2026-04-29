import "server-only";

import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import { cache } from "react";
import { getSubdomainFromHost, isSharedAppHost } from "@/lib/tenant-domain";

export type CurrentShop = {
  id: string;
  name: string;
  subdomain: string;
};

const DEFAULT_SHOP_ID = "shop_default";
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "bikeops.co";

export const getShopForHost = cache(async (hostHeader: string | null): Promise<CurrentShop | null> => {
  if (isSharedAppHost(hostHeader, { rootDomain: ROOT_DOMAIN })) {
    return null;
  }

  const subdomain = getSubdomainFromHost(hostHeader, {
    rootDomain: ROOT_DOMAIN,
    defaultSubdomain: process.env.DEFAULT_SHOP_SUBDOMAIN ?? null,
  });

  if (subdomain) {
    const shop = await prisma.shop.findUnique({ where: { subdomain } });
    if (shop) return { id: shop.id, name: shop.name, subdomain: shop.subdomain };
    return null;
  }

  // Default shop fallback (keeps existing single-tenant installs working during migration).
  const defaultShop = await prisma.shop.findUnique({ where: { id: DEFAULT_SHOP_ID } });
  if (!defaultShop) return null;
  return { id: defaultShop.id, name: defaultShop.name, subdomain: defaultShop.subdomain };
});

export const requireCurrentShop = cache(async (): Promise<CurrentShop> => {
  const shop = await getShopForHost(headers().get("host"));
  if (!shop) {
    throw new Error("Shop not found for request host");
  }
  return shop;
});
