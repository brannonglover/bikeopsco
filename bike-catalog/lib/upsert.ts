import type { CatalogComponentSlot, ComponentVisibility, Prisma } from "../generated/client";
import { catalogPrisma } from "./db";
import { SLOT_META, slugify } from "./slots";

export type UpsertComponentInput = {
  slot: CatalogComponentSlot;
  value: string;
  maker?: string | null;
  model?: string | null;
  standard?: string | null;
  detail?: string | null;
  visibility?: ComponentVisibility;
  label?: string;
};

export type UpsertBikeInput = {
  brandName: string;
  brandSlug?: string;
  brandAliases?: string[];
  scraperKey?: string;
  model: string;
  family?: string | null;
  year?: number | null;
  category?: string | null;
  subcategory?: string | null;
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  externalKey?: string | null;
  confidence?: number;
  components: UpsertComponentInput[];
};

export async function ensureBrand(input: {
  name: string;
  slug?: string;
  aliases?: string[];
  scraperKey?: string;
}) {
  const slug = input.slug ?? slugify(input.name);
  return catalogPrisma.catalogBrand.upsert({
    where: { slug },
    create: {
      name: input.name,
      slug,
      aliases: input.aliases ?? [],
      scraperKey: input.scraperKey ?? slug,
    },
    update: {
      name: input.name,
      aliases: input.aliases ?? undefined,
      scraperKey: input.scraperKey ?? undefined,
    },
  });
}

export async function upsertCatalogBike(input: UpsertBikeInput) {
  const brand = await ensureBrand({
    name: input.brandName,
    slug: input.brandSlug,
    aliases: input.brandAliases,
    scraperKey: input.scraperKey,
  });

  const externalKey =
    input.externalKey?.trim() ||
    slugify(brand.slug, input.model, input.year ?? "na");

  const bike = await catalogPrisma.catalogBike.upsert({
    where: {
      brandId_externalKey: { brandId: brand.id, externalKey },
    },
    create: {
      brandId: brand.id,
      model: input.model,
      family: input.family ?? null,
      year: input.year ?? null,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
      sourceUrl: input.sourceUrl ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      externalKey,
      confidence: input.confidence ?? 1,
    },
    update: {
      model: input.model,
      family: input.family ?? null,
      year: input.year ?? null,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
      sourceUrl: input.sourceUrl ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      confidence: input.confidence ?? 1,
    },
  });

  let componentsUpserted = 0;
  for (const component of input.components) {
    if (!component.value?.trim()) continue;
    const meta = SLOT_META[component.slot];
    const data: Prisma.CatalogComponentUncheckedCreateInput = {
      bikeId: bike.id,
      slot: component.slot,
      label: component.label ?? meta.label,
      value: component.value.trim(),
      maker: component.maker ?? null,
      model: component.model ?? null,
      standard: component.standard ?? null,
      detail: component.detail ?? null,
      visibility: component.visibility ?? meta.visibility,
      sortOrder: meta.sortOrder,
    };
    await catalogPrisma.catalogComponent.upsert({
      where: { bikeId_slot: { bikeId: bike.id, slot: component.slot } },
      create: data,
      update: {
        label: data.label,
        value: data.value,
        maker: data.maker,
        model: data.model,
        standard: data.standard,
        detail: data.detail,
        visibility: data.visibility,
        sortOrder: data.sortOrder,
      },
    });
    componentsUpserted += 1;
  }

  return { bike, brand, componentsUpserted };
}
