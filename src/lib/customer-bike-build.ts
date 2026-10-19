import "server-only";

import { prisma } from "@/lib/db";
import { catalogPrisma, isCatalogConfigured } from "../../bike-catalog/lib/db";
import { isYearCompatible, normalizeModelName } from "../../bike-catalog/lib/match";

/**
 * A customer's bike remembers which catalog build (model + trim) it is, once a
 * mechanic has confirmed it on a job — picking it from the possible matches,
 * or confirming an automatic match. Every later job for that bike links to the
 * same build straight away: no matching, no paid search, no asking again.
 *
 * Only a mechanic's confirmation is remembered; an automatic match is not.
 */

type JobBikeIdentity = {
  bikeId: string | null;
  make: string;
  model: string | null;
  year: number | null;
};

/** The customer bike fields that say which build a mechanic confirmed. */
export const BIKE_BUILD_SELECT = {
  make: true,
  model: true,
  catalogBikeId: true,
  catalogConfirmedAt: true,
  catalogConfirmedBy: true,
} as const;

export type BikeBuildFields = {
  make: string;
  model: string | null;
  catalogBikeId: string | null;
  catalogConfirmedAt: Date | null;
  catalogConfirmedBy: string | null;
};

/**
 * The build a mechanic confirmed for this customer bike, when the job
 * describes the same bike. Doesn't check the year — the caller does, against
 * the catalog row.
 */
export function rememberedBuildId(
  jobBike: { make: string; model: string | null },
  bike: Pick<BikeBuildFields, "make" | "model" | "catalogBikeId" | "catalogConfirmedAt"> | null
): string | null {
  if (!bike?.catalogBikeId || !bike.catalogConfirmedAt) return null;
  // The job describes a different bike than the one that was confirmed.
  if (
    normalizeModelName(bike.make) !== normalizeModelName(jobBike.make) ||
    normalizeModelName(bike.model) !== normalizeModelName(jobBike.model)
  ) {
    return null;
  }
  return bike.catalogBikeId;
}

/**
 * The confirmed build for this job bike's customer bike, if it still applies.
 * Pass the customer bike when it's already loaded to skip reading it again.
 */
export async function confirmedBuildForJobBike(
  jobBike: JobBikeIdentity,
  loadedBike?: BikeBuildFields | null
): Promise<string | null> {
  if (!jobBike.bikeId || !isCatalogConfigured()) return null;
  const bike =
    loadedBike !== undefined
      ? loadedBike
      : await prisma.bike.findUnique({ where: { id: jobBike.bikeId }, select: BIKE_BUILD_SELECT });
  const remembered = rememberedBuildId(jobBike, bike);
  if (!remembered) return null;
  const row = await catalogPrisma.catalogBike.findUnique({
    where: { id: remembered },
    select: { id: true, yearStart: true, yearEnd: true },
  });
  if (!row || !isYearCompatible(jobBike.year, row)) return null;
  return row.id;
}

/**
 * A mechanic confirms this job bike is that catalog build: link the job bike,
 * and remember it on the customer's bike (with who, when and on which job).
 */
export async function confirmBuildForJobBike(input: {
  jobBikeId: string;
  catalogBikeId: string;
  confirmedBy: string | null;
}): Promise<{
  rememberedOnBike: boolean;
  /** The job bike's link as written. */
  jobBike: { catalogBikeId: string | null; catalogMatchedAt: Date | null; catalogLookupAt: Date | null };
  /** The customer bike's confirmation as written (null when the job bike has no customer bike). */
  bike: BikeBuildFields | null;
}> {
  const { jobId, bikeId, ...jobBike } = await prisma.jobBike.update({
    where: { id: input.jobBikeId },
    data: { catalogBikeId: input.catalogBikeId, catalogMatchedAt: new Date(), catalogLookupAt: new Date() },
    select: { jobId: true, bikeId: true, catalogBikeId: true, catalogMatchedAt: true, catalogLookupAt: true },
  });
  if (!bikeId) return { rememberedOnBike: false, jobBike, bike: null };
  const bike = await prisma.bike.update({
    where: { id: bikeId },
    data: {
      catalogBikeId: input.catalogBikeId,
      catalogConfirmedAt: new Date(),
      catalogConfirmedBy: input.confirmedBy,
      catalogConfirmedJobId: jobId,
    },
    select: BIKE_BUILD_SELECT,
  });
  return { rememberedOnBike: true, jobBike, bike };
}

/** Name to record for the signed-in staff user. */
export async function staffDisplayName(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
  return user?.name?.trim() || user?.email || null;
}
