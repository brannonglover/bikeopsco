import "server-only";

import type { Prisma } from "@prisma/client";
import { COLLECTION_SERVICE_SLUGS } from "@/lib/collection-fee";

const DEFAULT_SHOP_ID = "shop_default";
const DEFAULT_SHOP_NAME = "Basement Bike Mechanic";

function personalizeTemplate(value: string, shopName: string): string {
  return value
    .split(DEFAULT_SHOP_NAME)
    .join("{{shopName}}")
    .split("Bike Ops")
    .join(shopName);
}

export async function provisionShopDefaults(
  tx: Prisma.TransactionClient,
  shopId: string,
  shopName: string,
) {
  const [defaultSettings, defaultTemplates] = await Promise.all([
    tx.appSettings.findUnique({ where: { shopId: DEFAULT_SHOP_ID } }).catch(() => null),
    tx.emailTemplate.findMany({ where: { shopId: DEFAULT_SHOP_ID } }).catch(() => []),
  ]);

  const collectionFeeRegular = defaultSettings?.collectionFeeRegular ?? 20;
  const collectionFeeEbike = defaultSettings?.collectionFeeEbike ?? 30;

  await tx.appSettings.create({
    data: {
      shopId,
      bookingsEnabled: defaultSettings?.bookingsEnabled ?? true,
      maxActiveBikes: defaultSettings?.maxActiveBikes ?? 5,
      collectionServiceEnabled: defaultSettings?.collectionServiceEnabled ?? true,
      collectionRadiusMiles: defaultSettings?.collectionRadiusMiles ?? 5,
      collectionFeeRegular,
      collectionFeeEbike,
      notifyCustomerEnabled: defaultSettings?.notifyCustomerEnabled ?? true,
      chatEnabled: defaultSettings?.chatEnabled ?? true,
      reviewsEnabled: defaultSettings?.reviewsEnabled ?? true,
    },
  });

  await tx.reviewSettings.create({
    data: {
      shopId,
    },
  });

  await tx.service.createMany({
    data: [
      {
        shopId,
        name: "Pickup/dropoff - standard bike",
        description:
          "Pickup and return within the configured collection radius. Added automatically for collection jobs.",
        price: collectionFeeRegular,
        slug: COLLECTION_SERVICE_SLUGS.regular,
        isSystem: true,
      },
      {
        shopId,
        name: "Pickup/dropoff - e-bike",
        description:
          "Pickup and return within the configured collection radius (e-bike). Added automatically for collection jobs.",
        price: collectionFeeEbike,
        slug: COLLECTION_SERVICE_SLUGS.ebike,
        isSystem: true,
      },
    ],
    skipDuplicates: true,
  });

  if (defaultTemplates.length > 0) {
    await tx.emailTemplate.createMany({
      data: defaultTemplates.map((template) => ({
        shopId,
        slug: template.slug,
        name: template.name,
        subject: personalizeTemplate(template.subject, shopName),
        bodyHtml: personalizeTemplate(template.bodyHtml, shopName),
        triggerType: template.triggerType,
        stage: template.stage,
        deliveryType: template.deliveryType,
        delayDays: template.delayDays,
      })),
      skipDuplicates: true,
    });
  }
}
