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

/**
 * One CatalogBike upsert per generation template, covering its whole year span
 * (clamped to 1990–2026). The build sheet does not change year to year inside a
 * generation, so it is stored once and matched by range.
 */
export function expandGenerations(templates: GenerationTemplate[]): UpsertBikeInput[] {
  const bikes: UpsertBikeInput[] = [];

  for (const template of templates) {
    const start = clampYear(template.yearStart);
    const end = clampYear(template.yearEnd);
    if (end < start) continue;

    bikes.push({
      brandName: template.brandName,
      brandAliases: template.brandAliases,
      scraperKey: template.scraperKey,
      model: template.model,
      family: template.family ?? null,
      yearStart: start,
      yearEnd: end,
      category: template.category ?? null,
      subcategory: template.subcategory ?? null,
      sourceUrl: template.sourceUrl ?? null,
      confidence: template.confidence ?? 0.65,
      components: template.components,
    });
  }

  return bikes;
}
