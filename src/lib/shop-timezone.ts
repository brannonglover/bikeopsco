import "server-only";

import { prisma } from "@/lib/db";
import { DEFAULT_SHOP_TIMEZONE, normalizeIANATimezone } from "@/lib/timezone";

export async function getShopTimezone(shopId: string): Promise<string> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { shopId },
      select: { timezone: true },
    });
    if (row?.timezone?.trim()) {
      return normalizeIANATimezone(row.timezone);
    }
  } catch {
    // Fall through to env default.
  }
  return normalizeIANATimezone(process.env.SHOP_TIMEZONE);
}
