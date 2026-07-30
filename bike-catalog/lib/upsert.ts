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
  const componentOps = input.components
    .filter((component) => Boolean(component.value?.trim()))
    .map((component) => {
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
      return catalogPrisma.catalogComponent.upsert({
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
    });

  if (componentOps.length > 0) {
    await catalogPrisma.$transaction(componentOps);
    componentsUpserted = componentOps.length;
  }

  return { bike, brand, componentsUpserted };
}

export async function deleteCatalogBike(id: string) {
  return catalogPrisma.catalogBike.delete({ where: { id } });
}

export async function updateCatalogBikeMeta(
  id: string,
  data: {
    model?: string;
    family?: string | null;
    year?: number | null;
    category?: string | null;
    subcategory?: string | null;
    sourceUrl?: string | null;
    thumbnailUrl?: string | null;
    confidence?: number;
    brandName?: string;
  }
) {
  const existing = await catalogPrisma.catalogBike.findUnique({
    where: { id },
    include: { brand: true },
  });
  if (!existing) return null;

  let brandId = existing.brandId;
  if (data.brandName?.trim() && data.brandName.trim() !== existing.brand.name) {
    const brand = await ensureBrand({ name: data.brandName.trim() });
    brandId = brand.id;
  }

  return catalogPrisma.catalogBike.update({
    where: { id },
    data: {
      brandId,
      ...(data.model != null ? { model: data.model } : {}),
      ...(data.family !== undefined ? { family: data.family } : {}),
      ...(data.year !== undefined ? { year: data.year } : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.subcategory !== undefined ? { subcategory: data.subcategory } : {}),
      ...(data.sourceUrl !== undefined ? { sourceUrl: data.sourceUrl } : {}),
      ...(data.thumbnailUrl !== undefined ? { thumbnailUrl: data.thumbnailUrl } : {}),
      ...(data.confidence !== undefined ? { confidence: data.confidence } : {}),
    },
    include: {
      brand: true,
      components: { orderBy: { sortOrder: "asc" } },
    },
  });
}

export async function replaceCatalogComponents(
  bikeId: string,
  components: UpsertComponentInput[]
) {
  const keepSlots = new Set(
    components.filter((c) => c.value?.trim()).map((c) => c.slot)
  );

  await catalogPrisma.catalogComponent.deleteMany({
    where: {
      bikeId,
      ...(keepSlots.size > 0 ? { slot: { notIn: [...keepSlots] } } : {}),
    },
  });

  let componentsUpserted = 0;
  for (const component of components) {
    if (!component.value?.trim()) continue;
    const meta = SLOT_META[component.slot];
    await catalogPrisma.catalogComponent.upsert({
      where: { bikeId_slot: { bikeId, slot: component.slot } },
      create: {
        bikeId,
        slot: component.slot,
        label: component.label ?? meta.label,
        value: component.value.trim(),
        maker: component.maker ?? null,
        model: component.model ?? null,
        standard: component.standard ?? null,
        detail: component.detail ?? null,
        visibility: component.visibility ?? meta.visibility,
        sortOrder: meta.sortOrder,
      },
      update: {
        label: component.label ?? meta.label,
        value: component.value.trim(),
        maker: component.maker ?? null,
        model: component.model ?? null,
        standard: component.standard ?? null,
        detail: component.detail ?? null,
        visibility: component.visibility ?? meta.visibility,
        sortOrder: meta.sortOrder,
      },
    });
    componentsUpserted += 1;
  }

  return componentsUpserted;
}
