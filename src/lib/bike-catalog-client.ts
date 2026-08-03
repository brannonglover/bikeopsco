/**
 * App-facing bike catalog client. All catalog DB access from the Next.js app
 * should go through this module — never join catalog tables into shop queries.
 */
import { catalogPrisma, isCatalogConfigured } from "../../bike-catalog/lib/db";
import {
  getCatalogBikeById,
  matchCatalogBike,
  isYearCompatible,
  type MatchResult,
} from "../../bike-catalog/lib/match";
import {
  toMatchedCatalogBike,
  toSpecsPayload,
  type BikeSpecsPayload,
  type MatchedCatalogBike,
  type BikeSpecGroup,
  type BikeSpecItem,
} from "../../bike-catalog/lib/groups";

export type {
  BikeSpecsPayload,
  MatchedCatalogBike,
  BikeSpecGroup,
  BikeSpecItem,
  MatchResult,
};

export {
  isCatalogConfigured,
  getCatalogBikeById,
  matchCatalogBike,
  isYearCompatible,
  toMatchedCatalogBike,
  toSpecsPayload,
};

export type CatalogMatchFields = {
  catalogBikeId: string;
  catalogMatchedAt: Date;
};

/** Best-effort catalog match for job bike writes. Never throws; returns null on miss/errors. */
export async function matchCatalogFieldsForJobBike(
  make: string,
  model: string | null | undefined,
  year: number | null | undefined
): Promise<CatalogMatchFields | null> {
  if (!isCatalogConfigured()) return null;
  const trimmedMake = make?.trim();
  if (!trimmedMake) return null;
  try {
    const match = await matchCatalogBike(trimmedMake, model ?? null, year ?? null);
    if (!match.ok) return null;
    return { catalogBikeId: match.bike.id, catalogMatchedAt: new Date() };
  } catch {
    return null;
  }
}

/** Batch-load thumbnail URLs for catalog bike ids. Missing ids map to null. */
export async function getCatalogThumbnailUrlsByIds(
  ids: string[]
): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const map = new Map<string, string | null>();
  if (unique.length === 0 || !isCatalogConfigured()) return map;

  try {
    const rows = await catalogPrisma.catalogBike.findMany({
      where: { id: { in: unique } },
      select: { id: true, thumbnailUrl: true },
    });
    for (const id of unique) map.set(id, null);
    for (const row of rows) {
      map.set(row.id, row.thumbnailUrl?.trim() || null);
    }
  } catch {
    // Catalog DB unavailable — leave map empty so callers keep uploaded photos only.
  }
  return map;
}

type JobBikeLike = {
  imageUrl?: string | null;
  catalogBikeId?: string | null;
  bike?: { imageUrl?: string | null } | null;
  catalogThumbnailUrl?: string | null;
};

function jobBikeHasUploadedImage(bike: JobBikeLike): boolean {
  return Boolean(bike.bike?.imageUrl?.trim() || bike.imageUrl?.trim());
}

/** Attach catalogThumbnailUrl for job bikes that have no uploaded photo. */
export async function enrichJobBikesWithCatalogThumbnails<T extends JobBikeLike>(
  jobBikes: T[]
): Promise<(T & { catalogThumbnailUrl: string | null })[]> {
  const idsNeedingThumb = jobBikes
    .filter((b) => !jobBikeHasUploadedImage(b) && b.catalogBikeId)
    .map((b) => b.catalogBikeId!);

  const thumbMap = await getCatalogThumbnailUrlsByIds(idsNeedingThumb);

  return jobBikes.map((bike) => {
    if (jobBikeHasUploadedImage(bike) || !bike.catalogBikeId) {
      return { ...bike, catalogThumbnailUrl: null };
    }
    return {
      ...bike,
      catalogThumbnailUrl: thumbMap.get(bike.catalogBikeId) ?? null,
    };
  });
}

/** Enrich every job’s jobBikes with catalogThumbnailUrl. */
export async function enrichJobsWithCatalogThumbnails<
  T extends { jobBikes?: JobBikeLike[] | null },
>(jobs: T[]): Promise<T[]> {
  if (jobs.length === 0) return jobs;

  const allBikes = jobs.flatMap((job) => job.jobBikes ?? []);
  const idsNeedingThumb = allBikes
    .filter((b) => !jobBikeHasUploadedImage(b) && b.catalogBikeId)
    .map((b) => b.catalogBikeId!);
  const thumbMap = await getCatalogThumbnailUrlsByIds(idsNeedingThumb);

  return jobs.map((job) => {
    if (!job.jobBikes?.length) return job;
    return {
      ...job,
      jobBikes: job.jobBikes.map((bike) => {
        if (jobBikeHasUploadedImage(bike) || !bike.catalogBikeId) {
          return { ...bike, catalogThumbnailUrl: null };
        }
        return {
          ...bike,
          catalogThumbnailUrl: thumbMap.get(bike.catalogBikeId) ?? null,
        };
      }),
    };
  });
}

export async function fetchSpecsForJobBike(
  make: string,
  model: string | null,
  year: number | null,
  existingCatalogBikeId?: string | null
): Promise<
  | { ok: true; catalogBikeId: string; specs: BikeSpecsPayload }
  | {
      ok: false;
      reason: "not_configured" | "no_match" | "low_confidence";
      candidates?: MatchedCatalogBike[];
      message?: string;
    }
> {
  if (!isCatalogConfigured()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Bike catalog database is not configured",
    };
  }

  try {
    if (existingCatalogBikeId) {
      const bike = await getCatalogBikeById(existingCatalogBikeId);
      // Only reuse a sticky match when the year still lines up — never serve a 2024
      // catalog row for a 2005 job bike just because we matched earlier.
      if (bike && isYearCompatible(year, bike.year)) {
        return { ok: true, catalogBikeId: bike.id, specs: toSpecsPayload(bike) };
      }
    }

    const match = await matchCatalogBike(make, model, year);
    if (!match.ok) {
      return {
        ok: false,
        reason:
          match.reason === "not_configured"
            ? "not_configured"
            : match.reason === "no_results"
              ? "no_match"
              : "low_confidence",
        candidates: match.candidates?.map(toMatchedCatalogBike),
        message: match.message,
      };
    }

    return {
      ok: true,
      catalogBikeId: match.bike.id,
      specs: toSpecsPayload(match.bike),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch bike specs";
    return { ok: false, reason: "no_match", message };
  }
}
