import { prisma } from "@/lib/db";

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

export async function getAppFeatures(): Promise<AppFeatures> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { id: "default" } });
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
    // Allows the app to boot if migrations haven’t run yet.
    console.warn("[app-settings] Failed to load AppSettings; using defaults:", e);
    return DEFAULT_FEATURES;
  }
}

export async function upsertAppFeatures(next: Partial<AppFeatures>): Promise<AppFeatures> {
  const updated = await prisma.appSettings.upsert({
    where: { id: "default" },
    create: {
      id: "default",
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
