import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/db";
import { requireCurrentShop } from "@/lib/shop";
import { DEFAULT_SHOP_TIMEZONE, normalizeIANATimezone } from "@/lib/timezone";
import { normalizePhone } from "@/lib/phone";

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
  jobBoardFiltersEnabled: boolean;
  timezone: string;
  staffNotifyEmail: string | null;
};

export type ClosedDate = {
  date: string;
  reason?: string;
};

export type AppBranding = {
  logoUrl: string | null;
  logoAlt: string;
  /** Public shop phone for customer call-to-action (E.164 when set). */
  shopPhone: string | null;
  /** Public street address used for nearby shop search. */
  address: string | null;
  latitude: number | null;
  longitude: number | null;
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
  jobBoardFiltersEnabled: false,
  timezone: DEFAULT_SHOP_TIMEZONE,
  staffNotifyEmail: null,
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
  shopPhone: null,
  address: null,
  latitude: null,
  longitude: null,
};

/** Normalize/clear shop phone. Throws if a non-empty value is invalid. */
export function coerceShopPhone(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = normalizePhone(trimmed);
  if (!normalized) {
    throw new Error("Enter a valid phone number.");
  }
  return normalized;
}

async function loadAppFeaturesForShop(shopId: string): Promise<AppFeatures> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { shopId } });
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
      jobBoardFiltersEnabled: row.jobBoardFiltersEnabled,
      timezone: normalizeIANATimezone(row.timezone),
      staffNotifyEmail: row.staffNotifyEmail?.trim() || null,
    };
  } catch (e) {
    console.warn("[app-settings] Failed to load AppSettings; using defaults:", e);
    return DEFAULT_FEATURES;
  }
}

export const getAppFeatures = cache(async (shopId?: string): Promise<AppFeatures> => {
  const resolvedShopId = shopId ?? (await requireCurrentShop()).id;
  return loadAppFeaturesForShop(resolvedShopId);
});

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
    jobBoardFiltersEnabled: updated.jobBoardFiltersEnabled,
    timezone: normalizeIANATimezone(updated.timezone),
    staffNotifyEmail: updated.staffNotifyEmail?.trim() || null,
  };
}

function toBranding(
  settings: { logoUrl: string | null; shopPhone: string | null } | null | undefined,
  shop:
    | {
        name: string | null | undefined;
        address?: string | null;
        latitude?: number | null;
        longitude?: number | null;
      }
    | null
    | undefined,
): AppBranding {
  return {
    logoUrl: settings?.logoUrl?.trim() || null,
    logoAlt: shop?.name?.trim() || DEFAULT_BRANDING.logoAlt,
    shopPhone: settings?.shopPhone?.trim() || null,
    address: shop?.address?.trim() || null,
    latitude: shop?.latitude ?? null,
    longitude: shop?.longitude ?? null,
  };
}

export async function getAppBranding(shopId?: string): Promise<AppBranding> {
  try {
    const resolvedShopId = shopId ?? (await requireCurrentShop()).id;
    const [settings, shop] = await Promise.all([
      prisma.appSettings.findUnique({
        where: { shopId: resolvedShopId },
        select: { logoUrl: true, shopPhone: true },
      }),
      prisma.shop.findUnique({
        where: { id: resolvedShopId },
        select: { name: true, address: true, latitude: true, longitude: true },
      }),
    ]);

    return toBranding(settings, shop);
  } catch (e) {
    console.warn("[app-settings] Failed to load branding; using defaults:", e);
    return DEFAULT_BRANDING;
  }
}

export async function updateAppBranding(
  shopId: string,
  next: Partial<Pick<AppBranding, "logoUrl" | "shopPhone" | "address">>,
): Promise<AppBranding> {
  const updateData: { logoUrl?: string | null; shopPhone?: string | null } = {};
  if (next.logoUrl !== undefined) updateData.logoUrl = next.logoUrl;
  if (next.shopPhone !== undefined) updateData.shopPhone = next.shopPhone;

  const updated = await prisma.appSettings.upsert({
    where: { shopId },
    create: {
      shopId,
      ...DEFAULT_FEATURES,
      logoUrl: next.logoUrl ?? null,
      shopPhone: next.shopPhone ?? null,
    },
    update: updateData,
    select: {
      logoUrl: true,
      shopPhone: true,
      shop: {
        select: { name: true, address: true, latitude: true, longitude: true },
      },
    },
  });

  let shop = updated.shop;

  if (next.address !== undefined) {
    const trimmed = next.address?.trim() || null;
    let latitude: number | null = null;
    let longitude: number | null = null;
    let address = trimmed;

    if (trimmed) {
      const { getGooglePlacesApiKey } = await import("@/lib/env");
      const { geocodeAddress } = await import("@/lib/collection-radius");
      const apiKey = getGooglePlacesApiKey();
      if (apiKey) {
        const geo = await geocodeAddress(trimmed, apiKey);
        if (geo) {
          latitude = geo.location.lat;
          longitude = geo.location.lng;
          address = geo.formattedAddress ?? trimmed;
        }
      }
    }

    shop = await prisma.shop.update({
      where: { id: shopId },
      data: { address, latitude, longitude },
      select: { name: true, address: true, latitude: true, longitude: true },
    });
  }

  return toBranding(updated, shop);
}
