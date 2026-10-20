import type { CatalogBike, CatalogBrand, CatalogComponent, Prisma } from "../generated/client";
import { catalogPrisma } from "./db";
import { formatYearSpan, yearGap, type YearSpan } from "./years";

export type CatalogBikeWithRelations = CatalogBike & {
  brand: CatalogBrand;
  components: CatalogComponent[];
};

/** What matching reads: a row and its brand. Parts are loaded only for the bike that matched. */
export type CatalogBikeWithBrand = CatalogBike & { brand: CatalogBrand };

/**
 * Matching decides one thing: is there exactly one catalog build sheet that is
 * unmistakably this bike? Only then is a job bike linked automatically.
 * Everything short of that — a different trim, a neighbouring year, an
 * approximate generation guide, two builds sold under one name — is offered to
 * the mechanic as a possible match on the Parts tab instead, because a wrong
 * automatic match is how a shop orders a part that doesn't fit.
 *
 * Auto-match needs all of:
 * - the brand is the catalog brand (name or alias), not a near spelling;
 * - the model typed is the catalog model, word for word;
 * - the job year is inside the row's year span (no one-year tolerance);
 * - the row isn't APPROXIMATE;
 * - no other row passes the same tests.
 */

/** Rows a year either side of the span are still worth offering. */
const MAX_YEAR_GAP_FOR_CANDIDATE = 1;
const MAX_CANDIDATES = 8;

export type ScoredCatalogBike<T extends CatalogBikeWithBrand = CatalogBikeWithBrand> = {
  bike: T;
  score: number;
  brandExact: boolean;
  /** Typed model and catalog model are the same words. */
  modelExact: boolean;
  /** The catalog model names the typed model (equal, or the typed name plus a trim). */
  modelContains: boolean;
  /** 0 when the model shares nothing with this row. */
  modelScore: number;
  /** Years outside the span; 0 inside, null when either side is undated. */
  yearGap: number | null;
};

/** Lower-case words and numbers only: "Fuel EX-8" and "fuel ex 8" compare equal. */
export function normalizeModelName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreBike<T extends CatalogBikeWithBrand>(
  bike: T,
  make: string,
  model: string | null,
  year: number | null
): ScoredCatalogBike<T> {
  const makeNorm = normalizeModelName(make);
  const modelNorm = normalizeModelName(model);

  const brandNames = [bike.brand.name, ...bike.brand.aliases].map(normalizeModelName);
  const brandExact = brandNames.includes(makeNorm);
  const brandNear =
    !brandExact && brandNames.some((b) => b && (b.includes(makeNorm) || makeNorm.includes(b)));

  const bikeModel = normalizeModelName(bike.model);
  const bikeFamily = normalizeModelName(bike.family);
  const modelExact = Boolean(modelNorm) && bikeModel === modelNorm;
  const modelContains =
    Boolean(modelNorm) && (` ${bikeModel} `.includes(` ${modelNorm} `) || modelExact);

  let modelScore = 0;
  if (modelExact) modelScore = 40;
  else if (modelContains) modelScore = 28;
  else if (modelNorm && bikeModel && ` ${modelNorm} `.includes(` ${bikeModel} `)) modelScore = 20;
  else if (modelNorm && bikeFamily && ` ${modelNorm} `.includes(` ${bikeFamily} `)) modelScore = 15;
  else if (modelNorm) {
    const tokens = modelNorm.split(" ").filter((t) => t.length > 1);
    const shared = tokens.filter((t) => ` ${bikeModel} ${bikeFamily} `.includes(` ${t} `));
    modelScore = Math.min(12, shared.length * 4);
  }

  const gap = yearGap(year, bike);
  const yearScore = gap === 0 ? 30 : gap === 1 ? 10 : 0;
  const statusScore = bike.specStatus === "VERIFIED" ? 6 : bike.specStatus === "SOURCED" ? 3 : 0;

  return {
    bike,
    score: (brandExact ? 50 : brandNear ? 20 : 0) + modelScore + yearScore + statusScore,
    brandExact,
    modelExact,
    modelContains,
    modelScore,
    yearGap: gap,
  };
}

export type MatchResult<T extends CatalogBikeWithBrand = CatalogBikeWithBrand> =
  | { ok: true; bike: T; score: number }
  | {
      ok: false;
      /**
       * no_results: nothing close. low_confidence: close rows, none certain.
       * ambiguous: several build sheets fit this name and year equally — a
       * mechanic has to say which one the bike is.
       */
      reason: "no_results" | "low_confidence" | "ambiguous" | "not_configured";
      candidates?: T[];
      /** Rows that would each have auto-matched on their own (ambiguous only). */
      ambiguousIds?: string[];
      message?: string;
    };

/** matchCatalogBike's result: the matched bike comes with its parts; candidates don't need them. */
export type CatalogMatch =
  | { ok: true; bike: CatalogBikeWithRelations; score: number }
  | Extract<MatchResult, { ok: false }>;

/** True when this row could be auto-matched on its own merits. */
function isAutoEligible(s: ScoredCatalogBike<CatalogBikeWithBrand>): boolean {
  return (
    s.brandExact &&
    s.modelContains &&
    s.yearGap === 0 &&
    s.bike.specStatus !== "APPROXIMATE"
  );
}

/** Pure matching over a pool of catalog rows; see the module comment for the rules. */
export function evaluateCatalogMatches<T extends CatalogBikeWithBrand>(
  pool: T[],
  make: string,
  model: string | null,
  year: number | null
): MatchResult<T> {
  const trimmedMake = make.trim();
  if (!trimmedMake) return { ok: false, reason: "no_results", message: "Make is required" };
  if (pool.length === 0) {
    return { ok: false, reason: "no_results", message: "No matching bike found in the catalog" };
  }

  const scored = pool
    .map((bike) => scoreBike(bike, trimmedMake, model, year))
    .filter((s) => s.yearGap == null || s.yearGap <= MAX_YEAR_GAP_FOR_CANDIDATE)
    // A row from the right brand with an unrelated model is not a possible match.
    .filter((s) => s.score >= 30 && (!model?.trim() || s.modelScore > 0))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    const nearestYears = [
      ...new Set(
        pool
          .filter((b) => b.yearStart != null)
          .sort((a, b) => (yearGap(year, a) ?? 0) - (yearGap(year, b) ?? 0))
          .map((b) => formatYearSpan(b)!)
      ),
    ].slice(0, 5);
    const label = [year, trimmedMake, model?.trim()].filter(Boolean).join(" ");
    return {
      ok: false,
      reason: "no_results",
      message:
        nearestYears.length > 0
          ? `No catalog entry for ${label}. Closest years we have: ${nearestYears.join(", ")}. Parts change by year — we won’t show a mismatched year.`
          : `No catalog entry for ${label}.`,
    };
  }

  const eligible = scored.filter(isAutoEligible);
  if (eligible.length === 1 && eligible[0].modelExact) {
    return { ok: true, bike: eligible[0].bike, score: eligible[0].score };
  }

  const candidates = [...eligible, ...scored.filter((s) => !isAutoEligible(s))]
    .slice(0, MAX_CANDIDATES)
    .map((s) => s.bike);

  if (eligible.length > 1) {
    return {
      ok: false,
      reason: "ambiguous",
      candidates,
      ambiguousIds: eligible.map((s) => s.bike.id),
      message: "This model was sold in more than one build — pick the one on this bike.",
    };
  }

  return {
    ok: false,
    reason: "low_confidence",
    candidates,
    message: "No catalog entry is certainly this bike — pick a possible match, or refine the make, model, or year.",
  };
}

/** When both sides have a year, keep an existing link only within a year of the span. */
export function isYearCompatible(
  jobYear: number | null | undefined,
  catalogSpan: YearSpan
): boolean {
  const gap = yearGap(jobYear, catalogSpan);
  return gap == null || gap <= MAX_YEAR_GAP_FOR_CANDIDATE;
}

/** Parts in build-sheet order. */
function componentsOf(bikeId: string): Promise<CatalogComponent[]> {
  return catalogPrisma.catalogComponent.findMany({ where: { bikeId }, orderBy: { sortOrder: "asc" } });
}

export async function getCatalogBikeById(id: string): Promise<CatalogBikeWithRelations | null> {
  // Side by side rather than one nested read: each read is a round trip.
  const [bike, components] = await Promise.all([
    catalogPrisma.catalogBike.findUnique({ where: { id }, include: { brand: true } }),
    componentsOf(id),
  ]);
  return bike ? { ...bike, components } : null;
}

/** The matching catalog row, without its parts — for callers that only link. */
export async function matchCatalogRow(
  make: string,
  model: string | null,
  year: number | null = null
): Promise<MatchResult> {
  const trimmedMake = make.trim();
  if (!trimmedMake) {
    return { ok: false, reason: "no_results", message: "Make is required" };
  }

  const modelTrimmed = model?.trim() ?? "";
  // Rows from a brand named, slugged or aliased as typed (a name containing the
  // make covers an exact name too), or whose model or family names the model.
  const orFilters: Prisma.CatalogBikeWhereInput[] = [
    {
      brand: {
        OR: [
          { name: { contains: trimmedMake, mode: "insensitive" } },
          { slug: { equals: trimmedMake.toLowerCase().replace(/\s+/g, "-"), mode: "insensitive" } },
          { aliases: { has: trimmedMake } },
        ],
      },
    },
  ];
  if (modelTrimmed) {
    orFilters.push({ model: { contains: modelTrimmed, mode: "insensitive" } });
    orFilters.push({ family: { contains: modelTrimmed, mode: "insensitive" } });
  }

  // Scoring never looks at parts, so the pool is read without them. Soft-merged
  // rows are left out: their survivor's span covers their years.
  const pool = await catalogPrisma.catalogBike.findMany({
    where: { OR: orFilters, mergedIntoId: null },
    include: { brand: true },
    take: 100,
  });

  return evaluateCatalogMatches(pool, trimmedMake, model, year);
}

/** The matching catalog bike with its parts; candidates come without. */
export async function matchCatalogBike(
  make: string,
  model: string | null,
  year: number | null = null
): Promise<CatalogMatch> {
  const result = await matchCatalogRow(make, model, year);
  if (!result.ok) return result;
  return { ...result, bike: { ...result.bike, components: await componentsOf(result.bike.id) } };
}
