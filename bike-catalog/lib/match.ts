import type { CatalogBike, CatalogBrand, CatalogComponent, Prisma } from "../generated/client";
import { catalogPrisma } from "./db";

export type CatalogBikeWithRelations = CatalogBike & {
  brand: CatalogBrand;
  components: CatalogComponent[];
};

const MATCH_SCORE_THRESHOLD = 45;
/** Auto-match only when catalog year is within this many years of the job bike year. */
const MAX_YEAR_GAP_FOR_AUTO_MATCH = 1;

function scoreBikeMatch(
  bike: CatalogBikeWithRelations,
  make: string,
  model: string | null,
  year: number | null
): number {
  const makeLower = make.trim().toLowerCase();
  const modelLower = (model?.trim() ?? "").toLowerCase();
  let score = 0;

  const brandName = bike.brand.name.trim().toLowerCase();
  const aliases = bike.brand.aliases.map((a) => a.toLowerCase());
  if (brandName === makeLower || aliases.includes(makeLower)) score += 50;
  else if (
    brandName.includes(makeLower) ||
    makeLower.includes(brandName) ||
    aliases.some((a) => a.includes(makeLower) || makeLower.includes(a))
  ) {
    score += 20;
  }

  const bikeModel = bike.model.trim().toLowerCase();
  const bikeFamily = (bike.family ?? "").trim().toLowerCase();
  const searchTarget = `${bikeModel} ${bikeFamily}`.trim();

  if (modelLower) {
    if (bikeModel === modelLower) score += 40;
    else if (bikeModel.includes(modelLower) || modelLower.includes(bikeModel)) score += 28;
    else if (searchTarget.includes(modelLower) || modelLower.includes(searchTarget)) score += 18;
    else {
      const modelTokens = modelLower.split(/\s+/).filter((t) => t.length > 2);
      const matchedTokens = modelTokens.filter(
        (t) => bikeModel.includes(t) || bikeFamily.includes(t)
      );
      score += Math.min(20, matchedTokens.length * 6);
    }
  } else {
    score += 10;
  }

  if (year != null && bike.year != null) {
    const gap = Math.abs(bike.year - year);
    if (gap === 0) score += 35;
    else if (gap === 1) score += 8;
    // Larger gaps are excluded from auto-match via isYearCompatible().
  } else if (year != null && bike.year == null) {
    // Prefer dated catalog rows when the job bike has a year.
    score -= 10;
  }

  return score;
}

/** When both sides have a year, only allow auto-match within MAX_YEAR_GAP_FOR_AUTO_MATCH. */
export function isYearCompatible(
  jobYear: number | null | undefined,
  catalogYear: number | null | undefined
): boolean {
  if (jobYear == null || catalogYear == null) return true;
  return Math.abs(catalogYear - jobYear) <= MAX_YEAR_GAP_FOR_AUTO_MATCH;
}

export type MatchResult =
  | { ok: true; bike: CatalogBikeWithRelations; score: number }
  | {
      ok: false;
      reason: "no_results" | "low_confidence" | "not_configured";
      candidates?: CatalogBikeWithRelations[];
      message?: string;
    };

export async function getCatalogBikeById(id: string): Promise<CatalogBikeWithRelations | null> {
  return catalogPrisma.catalogBike.findUnique({
    where: { id },
    include: { brand: true, components: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function matchCatalogBike(
  make: string,
  model: string | null,
  year: number | null = null
): Promise<MatchResult> {
  const trimmedMake = make.trim();
  if (!trimmedMake) {
    return { ok: false, reason: "no_results", message: "Make is required" };
  }

  const makeLower = trimmedMake.toLowerCase();
  const modelLower = model?.trim() ?? "";

  const brandCandidates = await catalogPrisma.catalogBrand.findMany({
    where: {
      OR: [
        { name: { equals: trimmedMake, mode: "insensitive" } },
        { slug: { equals: makeLower.replace(/\s+/g, "-"), mode: "insensitive" } },
        { aliases: { has: trimmedMake } },
      ],
    },
    select: { id: true },
  });

  const brandIds = brandCandidates.map((b) => b.id);

  const orFilters: Prisma.CatalogBikeWhereInput[] = [];
  if (brandIds.length > 0) {
    orFilters.push({ brandId: { in: brandIds } });
  }
  orFilters.push({ brand: { name: { contains: trimmedMake, mode: "insensitive" } } });
  if (modelLower) {
    orFilters.push({ model: { contains: modelLower, mode: "insensitive" } });
    orFilters.push({ family: { contains: modelLower, mode: "insensitive" } });
  }

  const pool = await catalogPrisma.catalogBike.findMany({
    where: { OR: orFilters },
    include: { brand: true, components: { orderBy: { sortOrder: "asc" } } },
    take: 50,
  });

  if (pool.length === 0) {
    return {
      ok: false,
      reason: "no_results",
      message: "No matching bike found in the catalog",
    };
  }

  const yearCompatible = pool.filter((bike) => isYearCompatible(year, bike.year));
  const scored = yearCompatible
    .map((bike) => ({ bike, score: scoreBikeMatch(bike, trimmedMake, model, year) }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const nearestYears = [
      ...new Set(
        pool
          .map((b) => b.year)
          .filter((y): y is number => y != null)
          .sort((a, b) => Math.abs(a - (year ?? 0)) - Math.abs(b - (year ?? 0)))
      ),
    ].slice(0, 5);

    const label = [year, trimmedMake, modelLower].filter(Boolean).join(" ");
    return {
      ok: false,
      reason: "no_results",
      message:
        nearestYears.length > 0
          ? `No catalog entry for ${label}. Closest years we have: ${nearestYears.join(", ")}. Parts change by year — we won’t show a mismatched year.`
          : `No catalog entry for ${label}.`,
    };
  }

  const best = scored[0];
  if (!best || best.score < MATCH_SCORE_THRESHOLD) {
    return {
      ok: false,
      reason: "low_confidence",
      candidates: scored.slice(0, 5).map((s) => s.bike),
      message: "Could not confidently match this bike — try refining make, model, or year",
    };
  }

  return { ok: true, bike: best.bike, score: best.score };
}
