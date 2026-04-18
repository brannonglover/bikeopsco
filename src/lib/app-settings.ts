import { prisma } from "@/lib/db";

export type AppFeatures = {
  collectionServiceEnabled: boolean;
  notifyCustomerEnabled: boolean;
  chatEnabled: boolean;
  reviewsEnabled: boolean;
};

const DEFAULT_FEATURES: AppFeatures = {
  collectionServiceEnabled: true,
  notifyCustomerEnabled: true,
  chatEnabled: true,
  reviewsEnabled: true,
};

export async function getAppFeatures(): Promise<AppFeatures> {
  try {
    const row = await prisma.appSettings.findUnique({ where: { id: "default" } });
    if (!row) return DEFAULT_FEATURES;
    return {
      collectionServiceEnabled: row.collectionServiceEnabled,
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
    collectionServiceEnabled: updated.collectionServiceEnabled,
    notifyCustomerEnabled: updated.notifyCustomerEnabled,
    chatEnabled: updated.chatEnabled,
    reviewsEnabled: updated.reviewsEnabled,
  };
}
