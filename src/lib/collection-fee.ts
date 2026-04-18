import type { Prisma } from "@prisma/client";
import { resolveEffectiveBikeType } from "./bike-type";

/** Seeded Service.slug values — pickup/dropoff within 5 mi */
export const COLLECTION_SERVICE_SLUGS = {
  regular: "collection_pickup_5mi",
  ebike: "collection_pickup_5mi_ebike",
} as const;

/**
 * Ensures the job has exactly one collection line item when delivery is collection,
 * priced by whether any bike is treated as an e-bike. Removes system collection lines
 * when delivery is not collection.
 */
export async function syncCollectionJobService(
  tx: Prisma.TransactionClient,
  jobId: string
): Promise<void> {
  const slugList = [COLLECTION_SERVICE_SLUGS.regular, COLLECTION_SERVICE_SLUGS.ebike];

  await tx.jobService.deleteMany({
    where: {
      jobId,
      service: { slug: { in: slugList } },
    },
  });

  const job = await tx.job.findUnique({
    where: { id: jobId },
    include: {
      jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!job || job.deliveryType !== "COLLECTION_SERVICE") return;

  const services = await tx.service.findMany({
    where: { slug: { in: slugList } },
  });
  const bySlug = new Map(services.map((s) => [s.slug as string, s]));

  const regular = bySlug.get(COLLECTION_SERVICE_SLUGS.regular);
  const ebike = bySlug.get(COLLECTION_SERVICE_SLUGS.ebike);
  if (!regular || !ebike) {
    console.warn(
      "[collection-fee] Missing collection services in DB; run `npx prisma db seed`"
    );
    return;
  }

  const needsEbike = job.jobBikes.some((jb) => resolveEffectiveBikeType(jb) === "E_BIKE");
  const chosen = needsEbike ? ebike : regular;

  const settings = await tx.appSettings.findUnique({ where: { id: "default" } }).catch(() => null);
  const fee =
    settings && needsEbike
      ? Number(settings.collectionFeeEbike)
      : settings
        ? Number(settings.collectionFeeRegular)
        : chosen.price;

  await tx.jobService.create({
    data: {
      jobId,
      serviceId: chosen.id,
      quantity: 1,
      unitPrice: fee,
    },
  });
}
