import "server-only";

import { prisma } from "@/lib/db";

/** Earliest shop user — typically the account that signed up. */
export async function getShopOwnerEmail(shopId: string): Promise<string | null> {
  try {
    const owner = await prisma.user.findFirst({
      where: { shopId },
      orderBy: { createdAt: "asc" },
      select: { email: true },
    });
    return owner?.email?.trim() || null;
  } catch {
    return null;
  }
}

export async function getShopNotifyEmail(shopId: string): Promise<string | null> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { shopId },
      select: { staffNotifyEmail: true },
    });
    const fromSettings = row?.staffNotifyEmail?.trim();
    if (fromSettings) return fromSettings;
  } catch {
    // Fall through to owner / env defaults.
  }

  const ownerEmail = await getShopOwnerEmail(shopId);
  if (ownerEmail) return ownerEmail;

  return (
    process.env.SHOP_NOTIFY_EMAIL?.trim() ||
    process.env.ADMIN_EMAIL?.trim() ||
    null
  );
}
