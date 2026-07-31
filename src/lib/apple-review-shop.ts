import "server-only";

import { prisma } from "@/lib/db";
import { haversineMiles } from "@/lib/collection-radius";

/**
 * Temporary App Store Review demo shop near Cupertino / Apple Park.
 * Remove this module (and callers) after App Store approval.
 */

export const DEFAULT_APPLE_REVIEW_EMAIL = "appreview@bikeops.co";
export const DEFAULT_APPLE_REVIEW_SHOP_SUBDOMAIN = "appreview";

export const APPLE_REVIEW_SHOP_NAME = "Stevens Creek Cycles";
export const APPLE_REVIEW_SHOP_ADDRESS =
  "1 Apple Park Way, Cupertino, CA 95014";
/** Apple Park Visitor Center area — so App Review devices find the shop nearby. */
export const APPLE_REVIEW_SHOP_LAT = 37.3349;
export const APPLE_REVIEW_SHOP_LNG = -122.009;

/** Include the demo shop when the search origin is within this radius of Cupertino. */
const CUPERTINO_VISIBILITY_MILES = 75;

export type AppleReviewConfig = {
  email: string;
  password: string;
  shopSubdomain: string;
};

/** Returns config when App Review password is set; otherwise null (feature disabled). */
export function getAppleReviewConfig(): AppleReviewConfig | null {
  const password = process.env.APPLE_REVIEW_PASSWORD?.trim();
  if (!password) return null;

  const rawSubdomain = (
    process.env.APPLE_REVIEW_SHOP_SUBDOMAIN?.trim() ||
    DEFAULT_APPLE_REVIEW_SHOP_SUBDOMAIN
  ).toLowerCase();

  // Never bind review login to the real BBM shop.
  const shopSubdomain =
    rawSubdomain === "bbm"
      ? DEFAULT_APPLE_REVIEW_SHOP_SUBDOMAIN
      : rawSubdomain;

  return {
    email: (
      process.env.APPLE_REVIEW_EMAIL?.trim() || DEFAULT_APPLE_REVIEW_EMAIL
    ).toLowerCase(),
    password,
    shopSubdomain,
  };
}

export function isNearCupertinoForAppReview(origin: {
  lat: number;
  lng: number;
}): boolean {
  const miles = haversineMiles(origin, {
    lat: APPLE_REVIEW_SHOP_LAT,
    lng: APPLE_REVIEW_SHOP_LNG,
  });
  return miles <= CUPERTINO_VISIBILITY_MILES;
}

export type AppleReviewShopRow = {
  id: string;
  name: string;
  subdomain: string;
  address: string | null;
  latitude: number;
  longitude: number;
};

/**
 * Upsert the fictitious Cupertino shop used for App Review.
 * No-ops (returns null) when App Review env is not configured.
 */
export async function ensureAppleReviewShop(): Promise<AppleReviewShopRow | null> {
  const config = getAppleReviewConfig();
  if (!config) return null;

  const shop = await prisma.shop.upsert({
    where: { subdomain: config.shopSubdomain },
    update: {
      name: APPLE_REVIEW_SHOP_NAME,
      address: APPLE_REVIEW_SHOP_ADDRESS,
      latitude: APPLE_REVIEW_SHOP_LAT,
      longitude: APPLE_REVIEW_SHOP_LNG,
    },
    create: {
      name: APPLE_REVIEW_SHOP_NAME,
      subdomain: config.shopSubdomain,
      address: APPLE_REVIEW_SHOP_ADDRESS,
      latitude: APPLE_REVIEW_SHOP_LAT,
      longitude: APPLE_REVIEW_SHOP_LNG,
      billingStatus: "active",
    },
    select: {
      id: true,
      name: true,
      subdomain: true,
      address: true,
      latitude: true,
      longitude: true,
    },
  });

  if (shop.latitude == null || shop.longitude == null) return null;

  return {
    id: shop.id,
    name: shop.name,
    subdomain: shop.subdomain,
    address: shop.address,
    latitude: shop.latitude,
    longitude: shop.longitude,
  };
}
