/**
 * App-facing bike catalog client. All catalog DB access from the Next.js app
 * should go through this module — never join catalog tables into shop queries.
 */
import { catalogPrisma, isCatalogConfigured } from "../../bike-catalog/lib/db";
import {
  getCatalogBikeById,
  matchCatalogBike,
  matchCatalogRow,
  isYearCompatible,
  type CatalogMatch,
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
  CatalogMatch,
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
    const match = await matchCatalogRow(trimmedMake, model ?? null, year ?? null);
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

export type SpecsResult =
  | { ok: true; catalogBikeId: string; specs: BikeSpecsPayload }
  | {
      ok: false;
      /**
       * catalog_unavailable: the catalog couldn't be read, so nothing is known
       * about this bike — never treat it as a miss.
       */
      reason: "not_configured" | "no_match" | "low_confidence" | "ambiguous" | "catalog_unavailable";
      candidates?: MatchedCatalogBike[];
      message?: string;
    };

export async function fetchSpecsForJobBike(
  make: string,
  model: string | null,
  year: number | null,
  existingCatalogBikeId?: string | null
): Promise<SpecsResult> {
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
      if (bike && isYearCompatible(year, bike)) {
        return { ok: true, catalogBikeId: bike.id, specs: toSpecsPayload(bike) };
      }
    }

    const match = await matchCatalogBike(make, model, year);
    if (!match.ok) {
      return {
        ok: false,
        reason: match.reason === "no_results" ? "no_match" : match.reason,
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
    // A failed read says nothing about whether the bike is in the catalog.
    // Reporting it as a miss would unlink a correct build and start a paid
    // web lookup, so it gets its own reason.
    console.error("[bike-catalog] catalog read failed:", error instanceof Error ? error.message : error);
    return {
      ok: false,
      reason: "catalog_unavailable",
      message: "The parts catalog couldn’t be reached. Try again in a moment.",
    };
  }
}
