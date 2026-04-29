import "server-only";

import { prisma } from "@/lib/db";
import { requireCurrentShop } from "@/lib/shop";

export type AppFeatures = {
  bookingsEnabled: boolean;
  maxActiveBikes: number;
  collectionServiceEnabled: boolean;
  collectionRadiusMiles: number;
  collectionFeeRegular: number;
  collectionFeeEbike: number;
  notifyCustomerEnabled: boolean;
  chatEnabled: boolean;
  reviewsEnabled: boolean;
};

export type AppBranding = {
  logoUrl: string | null;
  logoAlt: string;
};

const DEFAULT_FEATURES: AppFeatures = {
  bookingsEnabled: true,
  maxActiveBikes: 5,
  collectionServiceEnabled: true,
  collectionRadiusMiles: 5,
  collectionFeeRegular: 20,
  collectionFeeEbike: 30,
  notifyCustomerEnabled: true,
  chatEnabled: true,
  reviewsEnabled: true,
};

export const DEFAULT_BRANDING: AppBranding = {
  logoUrl: null,
  logoAlt: "Bike Ops",
};

export async function getAppFeatures(shopId?: string): Promise<AppFeatures> {
  try {
    const resolvedShopId = shopId ?? (await requireCurrentShop()).id;
    const row = await prisma.appSettings.findUnique({ where: { shopId: resolvedShopId } });
    if (!row) return DEFAULT_FEATURES;
    return {
      bookingsEnabled: row.bookingsEnabled,
      maxActiveBikes: row.maxActiveBikes,
      collectionServiceEnabled: row.collectionServiceEnabled,
      collectionRadiusMiles: row.collectionRadiusMiles,
      collectionFeeRegular: Number(row.collectionFeeRegular),
      collectionFeeEbike: Number(row.collectionFeeEbike),
      notifyCustomerEnabled: row.notifyCustomerEnabled,
      chatEnabled: row.chatEnabled,
      reviewsEnabled: row.reviewsEnabled,
    };
  } catch (e) {
    console.warn("[app-settings] Failed to load AppSettings; using defaults:", e);
    return DEFAULT_FEATURES;
  }
}

export async function upsertAppFeatures(
  shopId: string,
  next: Partial<AppFeatures>,
): Promise<AppFeatures> {
  const updated = await prisma.appSettings.upsert({
    where: { shopId },
    create: {
      shopId,
      ...DEFAULT_FEATURES,
      ...next,
    },
    update: next,
  });
  return {
    bookingsEnabled: updated.bookingsEnabled,
    maxActiveBikes: updated.maxActiveBikes,
    collectionServiceEnabled: updated.collectionServiceEnabled,
    collectionRadiusMiles: updated.collectionRadiusMiles,
    collectionFeeRegular: Number(updated.collectionFeeRegular),
    collectionFeeEbike: Number(updated.collectionFeeEbike),
    notifyCustomerEnabled: updated.notifyCustomerEnabled,
    chatEnabled: updated.chatEnabled,
    reviewsEnabled: updated.reviewsEnabled,
  };
}

export async function getAppBranding(shopId?: string): Promise<AppBranding> {
  try {
    const resolvedShopId = shopId ?? (await requireCurrentShop()).id;
    const [settings, shop] = await Promise.all([
      prisma.appSettings.findUnique({
        where: { shopId: resolvedShopId },
        select: { logoUrl: true },
      }),
      prisma.shop.findUnique({
        where: { id: resolvedShopId },
        select: { name: true },
      }),
    ]);

    return {
      logoUrl: settings?.logoUrl?.trim() || null,
      logoAlt: shop?.name?.trim() || DEFAULT_BRANDING.logoAlt,
    };
  } catch (e) {
    console.warn("[app-settings] Failed to load branding; using defaults:", e);
    return DEFAULT_BRANDING;
  }
}

export async function updateAppBranding(
  shopId: string,
  next: Partial<Pick<AppBranding, "logoUrl">>,
): Promise<AppBranding> {
  const updated = await prisma.appSettings.upsert({
    where: { shopId },
    create: {
      shopId,
      ...DEFAULT_FEATURES,
      logoUrl: next.logoUrl ?? null,
    },
    update: {
      logoUrl: next.logoUrl ?? null,
    },
    select: {
      logoUrl: true,
      shop: { select: { name: true } },
    },
  });

  return {
    logoUrl: updated.logoUrl?.trim() || null,
    logoAlt: updated.shop.name?.trim() || DEFAULT_BRANDING.logoAlt,
  };
}
