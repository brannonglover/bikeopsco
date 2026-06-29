import "server-only";

import { prisma } from "@/lib/db";

export async function getShopNotifyEmail(shopId: string): Promise<string | null> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { shopId },
      select: { staffNotifyEmail: true },
    });
    const fromSettings = row?.staffNotifyEmail?.trim();
    if (fromSettings) return fromSettings;
  } catch {
    // Fall through to env defaults.
  }

  return (
    process.env.SHOP_NOTIFY_EMAIL?.trim() ||
    process.env.ADMIN_EMAIL?.trim() ||
    null
  );
}
