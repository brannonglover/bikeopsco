import type {
  CatalogComponentSlot,
  CatalogSpecStatus,
  ComponentSource,
  ComponentVisibility,
  Prisma,
} from "../generated/client";
import { catalogPrisma } from "./db";
import { SLOT_META, slugify } from "./slots";
import { normalizeYearSpan } from "./years";

export type UpsertComponentInput = {
  slot: CatalogComponentSlot;
  value: string;
  maker?: string | null;
  model?: string | null;
  standard?: string | null;
  detail?: string | null;
  visibility?: ComponentVisibility;
  label?: string;
  source?: ComponentSource;
  sourceUrl?: string | null;
};

export type UpsertBikeInput = {
  brandName: string;
  brandSlug?: string;
  brandAliases?: string[];
  scraperKey?: string;
  model: string;
  family?: string | null;
  /** Single model year — shorthand for yearStart = yearEnd = year. */
  year?: number | null;
  yearStart?: number | null;
  yearEnd?: number | null;
  category?: string | null;
  subcategory?: string | null;
  sourceUrl?: string | null;
  thumbnailUrl?: string | null;
  externalKey?: string | null;
  confidence?: number;
  /** Defaults to APPROXIMATE on create; left alone on update unless given. */
  specStatus?: CatalogSpecStatus;
  components: UpsertComponentInput[];
};

/** Stable key for one build sheet: brand, model and the years it covers. */
export function catalogExternalKey(
  brandSlug: string,
  model: string,
  span: { yearStart: number | null; yearEnd: number | null }
): string {
  if (span.yearStart == null) return slugify(brandSlug, model, "na");
  if (span.yearEnd == null || span.yearEnd === span.yearStart) {
    return slugify(brandSlug, model, span.yearStart);
  }
  return slugify(brandSlug, model, span.yearStart, span.yearEnd);
}

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

  const span = normalizeYearSpan(input.yearStart ?? input.year, input.yearEnd ?? input.year);
  const externalKey =
    input.externalKey?.trim() || catalogExternalKey(brand.slug, input.model, span);

  // A re-seed or re-scrape must never overwrite a build sheet a person checked.
  const existing = await catalogPrisma.catalogBike.findUnique({
    where: { brandId_externalKey: { brandId: brand.id, externalKey } },
  });
  if (existing?.specStatus === "VERIFIED") {
    return { bike: existing, brand, componentsUpserted: 0, skippedVerified: true as const };
  }

  const bike = await catalogPrisma.catalogBike.upsert({
    where: {
      brandId_externalKey: { brandId: brand.id, externalKey },
    },
    create: {
      brandId: brand.id,
      model: input.model,
      family: input.family ?? null,
      yearStart: span.yearStart,
      yearEnd: span.yearEnd,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
      sourceUrl: input.sourceUrl ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      externalKey,
      confidence: input.confidence ?? 1,
      specStatus: input.specStatus ?? "APPROXIMATE",
    },
    update: {
      model: input.model,
      family: input.family ?? null,
      yearStart: span.yearStart,
      yearEnd: span.yearEnd,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
      sourceUrl: input.sourceUrl ?? null,
      // Keep a thumbnail found earlier when a re-seed has none.
      ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
      confidence: input.confidence ?? 1,
      ...(input.specStatus ? { specStatus: input.specStatus } : {}),
    },
  });

  // Nor a part someone verified on an otherwise unverified row.
  const verifiedSlots = new Set(
    (
      await catalogPrisma.catalogComponent.findMany({
        where: { bikeId: bike.id, verifiedAt: { not: null } },
        select: { slot: true },
      })
    ).map((c) => c.slot)
  );

  let componentsUpserted = 0;
  const componentOps = input.components
    .filter((component) => Boolean(component.value?.trim()) && !verifiedSlots.has(component.slot))
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
        source: component.source ?? "APPROXIMATE",
        sourceUrl: component.sourceUrl ?? null,
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
          source: data.source,
          sourceUrl: data.sourceUrl,
        },
      });
    });

  if (componentOps.length > 0) {
    await catalogPrisma.$transaction(componentOps);
    componentsUpserted = componentOps.length;
  }

  return { bike, brand, componentsUpserted, skippedVerified: false as const };
}

/**
 * Create a build sheet and all its parts in one statement, so an interrupted
 * write can never leave a bike with no parts that still matches jobs.
 */
export async function createCatalogBikeWithComponents(input: {
  brandId: string;
  model: string;
  family?: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  category?: string | null;
  subcategory?: string | null;
  sourceUrl?: string | null;
  externalKey: string;
  confidence: number;
  specStatus: CatalogSpecStatus;
  components: UpsertComponentInput[];
}) {
  return catalogPrisma.catalogBike.create({
    data: {
      brandId: input.brandId,
      model: input.model,
      family: input.family ?? null,
      yearStart: input.yearStart,
      yearEnd: input.yearEnd,
      category: input.category ?? null,
      subcategory: input.subcategory ?? null,
      sourceUrl: input.sourceUrl ?? null,
      externalKey: input.externalKey,
      confidence: input.confidence,
      specStatus: input.specStatus,
      components: {
        create: input.components
          .filter((c) => Boolean(c.value?.trim()))
          .map((c) => {
            const meta = SLOT_META[c.slot];
            if (!meta) throw new Error(`Unknown component slot: ${c.slot}`);
            return {
              slot: c.slot,
              label: c.label ?? meta.label,
              value: c.value.trim(),
              maker: c.maker ?? null,
              model: c.model ?? null,
              standard: c.standard ?? null,
              detail: c.detail ?? null,
              visibility: c.visibility ?? meta.visibility,
              sortOrder: meta.sortOrder,
              source: c.source ?? "APPROXIMATE",
              sourceUrl: c.sourceUrl ?? null,
            };
          }),
      },
    },
  });
}

export async function deleteCatalogBike(id: string) {
  return catalogPrisma.catalogBike.delete({ where: { id } });
}

export async function updateCatalogBikeMeta(
  id: string,
  data: {
    model?: string;
    family?: string | null;
    yearStart?: number | null;
    yearEnd?: number | null;
    category?: string | null;
    subcategory?: string | null;
    sourceUrl?: string | null;
    thumbnailUrl?: string | null;
    confidence?: number;
    specStatus?: CatalogSpecStatus;
    brandName?: string;
  }
) {
  const existing = await catalogPrisma.catalogBike.findUnique({
    where: { id },
    include: { brand: true },
  });
  if (!existing) return null;

  if (data.specStatus === "VERIFIED" && existing.specStatus !== "VERIFIED") {
    throw new Error("Use the verification workflow to mark a build verified");
  }

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
      ...(data.yearStart !== undefined || data.yearEnd !== undefined
        ? normalizeYearSpan(
            data.yearStart !== undefined ? data.yearStart : existing.yearStart,
            data.yearEnd !== undefined ? data.yearEnd : existing.yearEnd
          )
        : {}),
      ...(data.category !== undefined ? { category: data.category } : {}),
      ...(data.subcategory !== undefined ? { subcategory: data.subcategory } : {}),
      ...(data.sourceUrl !== undefined ? { sourceUrl: data.sourceUrl } : {}),
      ...(data.thumbnailUrl !== undefined ? { thumbnailUrl: data.thumbnailUrl } : {}),
      ...(data.confidence !== undefined ? { confidence: data.confidence } : {}),
      ...(identityChanged(existing, data, brandId) && existing.specStatus === "VERIFIED"
        ? // What was verified isn't what's here any more.
          { specStatus: "SOURCED", verifiedAt: null, verifiedBy: null, verificationNote: null }
        : data.specStatus !== undefined && data.specStatus !== existing.specStatus
          ? {
              specStatus: data.specStatus,
              ...(existing.specStatus === "VERIFIED"
                ? { verifiedAt: null, verifiedBy: null, verificationNote: null }
                : {}),
            }
          : {}),
    },
    include: {
      brand: true,
      components: { orderBy: { sortOrder: "asc" } },
    },
  });
}

function identityChanged(
  existing: { brandId: string; model: string; yearStart: number | null; yearEnd: number | null },
  data: { model?: string; yearStart?: number | null; yearEnd?: number | null },
  brandId: string
): boolean {
  const span =
    data.yearStart !== undefined || data.yearEnd !== undefined
      ? normalizeYearSpan(
          data.yearStart !== undefined ? data.yearStart : existing.yearStart,
          data.yearEnd !== undefined ? data.yearEnd : existing.yearEnd
        )
      : { yearStart: existing.yearStart, yearEnd: existing.yearEnd };
  return (
    brandId !== existing.brandId ||
    (data.model != null && data.model !== existing.model) ||
    span.yearStart !== existing.yearStart ||
    span.yearEnd !== existing.yearEnd
  );
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

  const existing = new Map(
    (await catalogPrisma.catalogComponent.findMany({ where: { bikeId } })).map((c) => [c.slot, c])
  );

  let componentsUpserted = 0;
  for (const component of components) {
    if (!component.value?.trim()) continue;
    const meta = SLOT_META[component.slot];
    const value = component.value.trim();
    const standard = component.standard ?? null;
    const before = existing.get(component.slot);
    // A part the admin typed or changed is the admin's word, not the original
    // source's; an untouched part keeps where it came from.
    const unchanged = before && before.value === value && (before.standard ?? null) === standard;
    const provenance = unchanged
      ? { source: before.source, sourceUrl: before.sourceUrl }
      : // A changed part is a new claim: the admin's, and not yet verified.
        { source: "ADMIN" as const, sourceUrl: null, verifiedAt: null, verifiedBy: null, verifiedAgainst: null };
    await catalogPrisma.catalogComponent.upsert({
      where: { bikeId_slot: { bikeId, slot: component.slot } },
      create: {
        bikeId,
        slot: component.slot,
        label: component.label ?? meta.label,
        value,
        maker: component.maker ?? null,
        model: component.model ?? null,
        standard,
        detail: component.detail ?? null,
        visibility: component.visibility ?? meta.visibility,
        sortOrder: meta.sortOrder,
        ...provenance,
      },
      update: {
        label: component.label ?? meta.label,
        value,
        maker: component.maker ?? null,
        model: component.model ?? null,
        standard,
        detail: component.detail ?? null,
        visibility: component.visibility ?? meta.visibility,
        sortOrder: meta.sortOrder,
        ...provenance,
      },
    });
    componentsUpserted += 1;
  }

  return componentsUpserted;
}
