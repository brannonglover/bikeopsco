import "server-only";

import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import { cache } from "react";
import { classifyHost, parseDefaultShopHosts } from "@/lib/tenant-domain";

export type CurrentShop = {
  id: string;
  name: string;
  subdomain: string;
};

export const DEFAULT_SHOP_ID = "shop_default";
const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? "bikeops.co";

/**
 * The shop a request's host serves, or null. Fails closed: only a shop
 * subdomain, or a host explicitly allowed to serve the default shop
 * (localhost in dev, DEFAULT_SHOP_HOSTS), resolves to a shop — an unknown host
 * (apex, `www.`, another domain, a `*.vercel.app` URL) resolves to nothing,
 * never silently to the default shop. See classifyHost.
 */
export const getShopForHost = cache(async (hostHeader: string | null): Promise<CurrentShop | null> => {
  const host = classifyHost(hostHeader, {
    rootDomain: ROOT_DOMAIN,
    defaultSubdomain: process.env.DEFAULT_SHOP_SUBDOMAIN ?? null,
    defaultShopHosts: parseDefaultShopHosts(process.env.DEFAULT_SHOP_HOSTS),
  });

  if (host.kind === "tenant") {
    const shop = await prisma.shop.findUnique({ where: { subdomain: host.subdomain } });
    return shop ? { id: shop.id, name: shop.name, subdomain: shop.subdomain } : null;
  }
  if (host.kind === "default") {
    const defaultShop = await prisma.shop.findUnique({ where: { id: DEFAULT_SHOP_ID } });
    return defaultShop ? { id: defaultShop.id, name: defaultShop.name, subdomain: defaultShop.subdomain } : null;
  }
  return null;
});

export const requireCurrentShop = cache(async (): Promise<CurrentShop> => {
  const shop = await getShopForHost(headers().get("host"));
  if (!shop) {
    throw new Error("Shop not found for request host");
  }
  return shop;
});
