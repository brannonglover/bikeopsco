import "server-only";

import { prisma } from "@/lib/db";
import { requireCurrentShop } from "@/lib/shop";

export type AppFeatures = {
  bookingsEnabled: boolean;
  maxActiveBikes: number;
  closedDates: ClosedDate[];
  collectionServiceEnabled: boolean;
  collectionRadiusMiles: number;
  collectionFeeRegular: number;
  collectionFeeEbike: number;
  notifyCustomerEnabled: boolean;
  chatEnabled: boolean;
  reviewsEnabled: boolean;
};

export type ClosedDate = {
  date: string;
  reason?: string;
};

export type AppBranding = {
  logoUrl: string | null;
  logoAlt: string;
};

const CLOSED_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_FEATURES: AppFeatures = {
  bookingsEnabled: true,
  maxActiveBikes: 5,
  closedDates: [],
  collectionServiceEnabled: true,
  collectionRadiusMiles: 5,
  collectionFeeRegular: 20,
  collectionFeeEbike: 30,
  notifyCustomerEnabled: true,
  chatEnabled: true,
  reviewsEnabled: true,
};

function normalizeClosedDates(value: unknown): ClosedDate[] {
  if (!Array.isArray(value)) return [];

  const byDate = new Map<string, ClosedDate>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rawDate = (item as { date?: unknown }).date;
    if (typeof rawDate !== "string" || !CLOSED_DATE_RE.test(rawDate)) continue;

    const rawReason = (item as { reason?: unknown }).reason;
    const reason =
      typeof rawReason === "string" && rawReason.trim()
        ? rawReason.trim().slice(0, 80)
        : undefined;
    byDate.set(rawDate, reason ? { date: rawDate, reason } : { date: rawDate });
  }

  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

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
      closedDates: normalizeClosedDates(row.closedDates),
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
  const normalizedNext = {
    ...next,
    ...(next.closedDates !== undefined
      ? { closedDates: normalizeClosedDates(next.closedDates) }
      : {}),
  };
  const updated = await prisma.appSettings.upsert({
    where: { shopId },
    create: {
      shopId,
      ...DEFAULT_FEATURES,
      ...normalizedNext,
    },
    update: normalizedNext,
  });
  return {
    bookingsEnabled: updated.bookingsEnabled,
    maxActiveBikes: updated.maxActiveBikes,
    closedDates: normalizeClosedDates(updated.closedDates),
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
