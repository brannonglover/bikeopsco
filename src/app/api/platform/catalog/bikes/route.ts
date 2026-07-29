import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  catalogPrisma,
  isCatalogConfigured,
  listCatalogSlotOptions,
  upsertCatalogBike,
} from "@/lib/bike-catalog-admin";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  brandName: z.string().min(1),
  model: z.string().min(1),
  family: z.string().optional().nullable(),
  year: z.number().int().min(1970).max(2100).optional().nullable(),
  category: z.string().optional().nullable(),
  subcategory: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  confidence: z.number().min(0).max(1).optional(),
  components: z
    .array(
      z.object({
        slot: z.string().min(1),
        value: z.string().min(1),
        label: z.string().optional(),
        standard: z.string().optional().nullable(),
        detail: z.string().optional().nullable(),
        visibility: z.enum(["VISUAL", "INTERNAL", "STANDARD"]).optional(),
      })
    )
    .optional()
    .default([]),
});

export async function GET(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  if (!isCatalogConfigured()) {
    return NextResponse.json({ error: "Catalog database is not configured" }, { status: 503 });
  }

  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const brand = request.nextUrl.searchParams.get("brand")?.trim() ?? "";
  const yearRaw = request.nextUrl.searchParams.get("year")?.trim();
  const year = yearRaw ? Number(yearRaw) : null;

  const bikes = await catalogPrisma.catalogBike.findMany({
    where: {
      AND: [
        q
          ? {
              OR: [
                { model: { contains: q, mode: "insensitive" } },
                { family: { contains: q, mode: "insensitive" } },
                { brand: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {},
        brand ? { brand: { name: { equals: brand, mode: "insensitive" } } } : {},
        year != null && Number.isFinite(year) ? { year } : {},
      ],
    },
    include: {
      brand: true,
      _count: { select: { components: true } },
    },
    orderBy: [{ brand: { name: "asc" } }, { year: "desc" }, { model: "asc" }],
    take: 200,
  });

  const brands = await catalogPrisma.catalogBrand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });

  return NextResponse.json({
    bikes: bikes.map((b) => ({
      id: b.id,
      brandName: b.brand.name,
      model: b.model,
      family: b.family,
      year: b.year,
      category: b.category,
      subcategory: b.subcategory,
      sourceUrl: b.sourceUrl,
      confidence: b.confidence,
      componentCount: b._count.components,
      updatedAt: b.updatedAt.toISOString(),
      thumbnailUrl: b.thumbnailUrl,
    })),
    brands,
    slots: listCatalogSlotOptions(),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  if (!isCatalogConfigured()) {
    return NextResponse.json({ error: "Catalog database is not configured" }, { status: 503 });
  }

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await upsertCatalogBike({
    brandName: body.brandName.trim(),
    model: body.model.trim(),
    family: body.family?.trim() || null,
    year: body.year ?? null,
    category: body.category?.trim() || null,
    subcategory: body.subcategory?.trim() || null,
    sourceUrl: body.sourceUrl?.trim() || null,
    confidence: body.confidence ?? 1,
    components: body.components.map((c) => ({
      slot: c.slot as never,
      value: c.value,
      label: c.label,
      standard: c.standard,
      detail: c.detail,
      visibility: c.visibility,
    })),
  });

  const bike = await catalogPrisma.catalogBike.findUnique({
    where: { id: result.bike.id },
    include: { brand: true, components: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json({ bike }, { status: 201 });
}
