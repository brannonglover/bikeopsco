import type { UpsertBikeInput, UpsertComponentInput } from "./upsert";

export const SEED_YEAR_MIN = 1990;
export const SEED_YEAR_MAX = 2026;

export type GenerationTemplate = {
  brandName: string;
  brandAliases?: string[];
  scraperKey?: string;
  model: string;
  family?: string | null;
  yearStart: number;
  yearEnd: number;
  category?: string | null;
  subcategory?: string | null;
  sourceUrl?: string | null;
  confidence?: number;
  components: UpsertComponentInput[];
};

function clampYear(year: number): number {
  return Math.min(SEED_YEAR_MAX, Math.max(SEED_YEAR_MIN, year));
}

function withSharedDetail(
  components: UpsertComponentInput[],
  yearStart: number,
  yearEnd: number
): UpsertComponentInput[] {
  const note = `Shared build sheet for ${yearStart}–${yearEnd}`;
  return components.map((c) => ({
    ...c,
    detail: c.detail ? `${c.detail}; ${note}` : note,
  }));
}

/** Expand generation templates into one CatalogBike upsert per year (clamped to 1990–2026). */
export function expandGenerations(templates: GenerationTemplate[]): UpsertBikeInput[] {
  const bikes: UpsertBikeInput[] = [];

  for (const template of templates) {
    const start = clampYear(template.yearStart);
    const end = clampYear(template.yearEnd);
    if (end < start) continue;

    const components = withSharedDetail(template.components, start, end);

    for (let year = start; year <= end; year++) {
      bikes.push({
        brandName: template.brandName,
        brandAliases: template.brandAliases,
        scraperKey: template.scraperKey,
        model: template.model,
        family: template.family ?? null,
        year,
        category: template.category ?? null,
        subcategory: template.subcategory ?? null,
        sourceUrl: template.sourceUrl ?? null,
        confidence: template.confidence ?? 0.65,
        components,
      });
    }
  }

  return bikes;
}
