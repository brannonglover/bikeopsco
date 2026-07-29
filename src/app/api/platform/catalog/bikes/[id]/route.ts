import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  catalogPrisma,
  isCatalogConfigured,
  deleteCatalogBike,
  replaceCatalogComponents,
  updateCatalogBikeMeta,
} from "@/lib/bike-catalog-admin";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  brandName: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  family: z.string().optional().nullable(),
  year: z.number().int().min(1970).max(2100).optional().nullable(),
  category: z.string().optional().nullable(),
  subcategory: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
  confidence: z.number().min(0).max(1).optional(),
  components: z
    .array(
      z.object({
        slot: z.string().min(1),
        value: z.string(),
        label: z.string().optional(),
        standard: z.string().optional().nullable(),
        detail: z.string().optional().nullable(),
        visibility: z.enum(["VISUAL", "INTERNAL", "STANDARD"]).optional(),
      })
    )
    .optional(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  if (!isCatalogConfigured()) {
    return NextResponse.json({ error: "Catalog database is not configured" }, { status: 503 });
  }

  const bike = await catalogPrisma.catalogBike.findUnique({
    where: { id: params.id },
    include: { brand: true, components: { orderBy: { sortOrder: "asc" } } },
  });
  if (!bike) {
    return NextResponse.json({ error: "Bike not found" }, { status: 404 });
  }

  return NextResponse.json({ bike });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  if (!isCatalogConfigured()) {
    return NextResponse.json({ error: "Catalog database is not configured" }, { status: 503 });
  }

  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const updated = await updateCatalogBikeMeta(params.id, {
    brandName: body.brandName,
    model: body.model,
    family: body.family,
    year: body.year,
    category: body.category,
    subcategory: body.subcategory,
    sourceUrl: body.sourceUrl?.trim() || null,
    thumbnailUrl: body.thumbnailUrl,
    confidence: body.confidence,
  });
  if (!updated) {
    return NextResponse.json({ error: "Bike not found" }, { status: 404 });
  }

  if (body.components) {
    await replaceCatalogComponents(
      params.id,
      body.components.map((c) => ({
        slot: c.slot as never,
        value: c.value,
        label: c.label,
        standard: c.standard,
        detail: c.detail,
        visibility: c.visibility,
      }))
    );
  }

  const bike = await catalogPrisma.catalogBike.findUnique({
    where: { id: params.id },
    include: { brand: true, components: { orderBy: { sortOrder: "asc" } } },
  });

  return NextResponse.json({ bike });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requirePlatformAdmin(request);
  if (!auth.ok) return auth.response;

  if (!isCatalogConfigured()) {
    return NextResponse.json({ error: "Catalog database is not configured" }, { status: 503 });
  }

  try {
    await deleteCatalogBike(params.id);
  } catch {
    return NextResponse.json({ error: "Bike not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
