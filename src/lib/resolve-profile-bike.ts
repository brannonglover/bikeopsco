import type { Prisma } from "@prisma/client";

/**
 * Find or create the customer profile Bike that a job bike should link to.
 *
 * Auto-matching by make + model is what links a repeat customer's bike back to its profile
 * row across visits. It becomes a bug within one job: two Guardians with the same model
 * both match the first profile row, so they share a Bike, and an edit to that row fans out
 * to every job bike linked to it — they all take on one model and one nickname.
 *
 * `claimedBikeIds` are the profile rows already taken by other bikes on the same job. A
 * match against one of those means this is a *different* physical bike that happens to
 * share a make and model, so it gets its own profile row instead.
 */
export async function resolveProfileBikeForJobBike({
  tx,
  shopId,
  customerId,
  bike,
  claimedBikeIds,
}: {
  tx: Prisma.TransactionClient;
  shopId: string;
  customerId: string;
  bike: {
    make: string;
    model?: string | null;
    year?: number | null;
    bikeType?: "REGULAR" | "E_BIKE" | null;
    nickname?: string | null;
    imageUrl?: string | null;
  };
  claimedBikeIds: ReadonlySet<string>;
}): Promise<string> {
  const trimmedModel = bike.model?.trim() || null;

  const candidates = await tx.bike.findMany({
    where: {
      shopId,
      customerId,
      make: { equals: bike.make.trim(), mode: "insensitive" },
      model: trimmedModel ? { equals: trimmedModel, mode: "insensitive" } : null,
    },
    orderBy: { createdAt: "asc" },
  });

  const unclaimed = candidates.find((c) => !claimedBikeIds.has(c.id));
  if (unclaimed) return unclaimed.id;

  const created = await tx.bike.create({
    data: {
      shopId,
      customerId,
      make: bike.make.trim(),
      model: trimmedModel,
      year: bike.year ?? null,
      bikeType: bike.bikeType ?? null,
      nickname: bike.nickname ?? null,
      imageUrl: bike.imageUrl ?? null,
    },
  });
  return created.id;
}
