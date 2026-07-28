import type { CatalogBike, CatalogBrand, CatalogComponent, Prisma } from "../generated/client";
import { catalogPrisma } from "./db";

export type CatalogBikeWithRelations = CatalogBike & {
  brand: CatalogBrand;
  components: CatalogComponent[];
};

const MATCH_SCORE_THRESHOLD = 45;

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
    if (bike.year === year) score += 25;
    else if (Math.abs(bike.year - year) === 1) score += 8;
    else score -= 15;
  }

  return score;
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

  const scored = pool
    .map((bike) => ({ bike, score: scoreBikeMatch(bike, trimmedMake, model, year) }))
    .sort((a, b) => b.score - a.score);

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
