import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";
import { z } from "zod";
import {
  fetchSpecsForJobBike,
  isCatalogConfigured,
  type BikeSpecsPayload,
} from "@/lib/bike-catalog-client";
import type { ComponentConfirmation } from "@prisma/client";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  jobBikeId: z.string().min(1),
  refresh: z.boolean().optional(),
  catalogBikeId: z.string().optional(),
});

const overrideSchema = z.object({
  jobBikeId: z.string().min(1),
  slot: z.string().min(1),
  confirmation: z.enum(["UNREVIEWED", "MATCHES_CATALOG", "CUSTOMIZED"]),
  customValue: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

type OverrideRow = {
  slot: string;
  confirmation: ComponentConfirmation;
  customValue: string | null;
  notes: string | null;
};

function applyOverridesToSpecs(specs: BikeSpecsPayload, overrides: OverrideRow[]): BikeSpecsPayload {
  const bySlot = new Map(overrides.map((o) => [o.slot, o]));
  return {
    ...specs,
    groups: specs.groups.map((group) => ({
      ...group,
      items: group.items.map((item) => {
        const override = bySlot.get(item.slot);
        if (!override) {
          return { ...item, confirmation: "UNREVIEWED" as const };
        }
        if (override.confirmation === "CUSTOMIZED" && override.customValue?.trim()) {
          return {
            ...item,
            value: override.customValue.trim(),
            detail: override.notes ?? item.detail,
            confirmation: "CUSTOMIZED" as const,
            catalogValue: item.value,
          };
        }
        return {
          ...item,
          confirmation: override.confirmation,
          catalogValue: item.value,
        };
      }),
    })),
  };
}

async function loadOverrides(jobBikeId: string, shopId: string) {
  return prisma.jobBikeComponentOverride.findMany({
    where: { jobBikeId, shopId },
    select: { slot: true, confirmation: true, customValue: true, notes: true },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  const jobBikeId = request.nextUrl.searchParams.get("jobBikeId")?.trim();
  if (!jobBikeId) {
    return NextResponse.json({ error: "jobBikeId is required" }, { status: 400 });
  }

  const jobBike = await prisma.jobBike.findFirst({
    where: { id: jobBikeId, jobId: params.id, shopId: auth.shopId },
    select: {
      id: true,
      make: true,
      model: true,
      year: true,
      catalogBikeId: true,
      catalogMatchedAt: true,
    },
  });
  if (!jobBike) {
    return NextResponse.json({ error: "Job bike not found" }, { status: 404 });
  }

  if (!jobBike.catalogBikeId) {
    return NextResponse.json({
      configured: isCatalogConfigured(),
      jobBikeId: jobBike.id,
      status: "not_fetched" as const,
      catalogBikeId: null,
      specs: null,
      fetchedAt: null,
      overrides: [],
    });
  }

  const result = await fetchSpecsForJobBike(
    jobBike.make,
    jobBike.model,
    jobBike.year,
    jobBike.catalogBikeId
  );

  if (!result.ok) {
    return NextResponse.json({
      configured: isCatalogConfigured(),
      jobBikeId: jobBike.id,
      status: result.reason,
      catalogBikeId: jobBike.catalogBikeId,
      specs: null,
      fetchedAt: jobBike.catalogMatchedAt?.toISOString() ?? null,
      error: result.message,
      candidates: result.candidates ?? [],
      overrides: [],
    });
  }

  const overrides = await loadOverrides(jobBike.id, auth.shopId);
  return NextResponse.json({
    configured: true,
    jobBikeId: jobBike.id,
    status: "cached" as const,
    catalogBikeId: result.catalogBikeId,
    specs: applyOverridesToSpecs(result.specs, overrides),
    fetchedAt: jobBike.catalogMatchedAt?.toISOString() ?? null,
    overrides,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const jobBike = await prisma.jobBike.findFirst({
    where: { id: body.jobBikeId, jobId: params.id, shopId: auth.shopId },
    select: {
      id: true,
      make: true,
      model: true,
      year: true,
      catalogBikeId: true,
      catalogMatchedAt: true,
    },
  });
  if (!jobBike) {
    return NextResponse.json({ error: "Job bike not found" }, { status: 404 });
  }

  if (!isCatalogConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        jobBikeId: jobBike.id,
        status: "not_configured" as const,
        error: "Bike catalog database is not configured",
      },
      { status: 503 }
    );
  }

  const useCached =
    !body.refresh &&
    !body.catalogBikeId &&
    jobBike.catalogBikeId &&
    jobBike.catalogMatchedAt;

  if (useCached) {
    const result = await fetchSpecsForJobBike(
      jobBike.make,
      jobBike.model,
      jobBike.year,
      jobBike.catalogBikeId
    );
    if (result.ok) {
      const overrides = await loadOverrides(jobBike.id, auth.shopId);
      return NextResponse.json({
        configured: true,
        jobBikeId: jobBike.id,
        status: "cached" as const,
        catalogBikeId: result.catalogBikeId,
        specs: applyOverridesToSpecs(result.specs, overrides),
        fetchedAt: jobBike.catalogMatchedAt?.toISOString() ?? null,
        overrides,
      });
    }
  }

  const existingId = body.catalogBikeId ?? (body.refresh ? null : jobBike.catalogBikeId);
  const result = await fetchSpecsForJobBike(jobBike.make, jobBike.model, jobBike.year, existingId);

  if (!result.ok) {
    return NextResponse.json(
      {
        configured: true,
        jobBikeId: jobBike.id,
        status: result.reason,
        error: result.message ?? "Could not fetch bike specs",
        candidates: result.candidates ?? [],
      },
      { status: result.reason === "not_configured" ? 503 : 404 }
    );
  }

  const now = new Date();
  await prisma.jobBike.update({
    where: { id: jobBike.id },
    data: {
      catalogBikeId: result.catalogBikeId,
      catalogMatchedAt: now,
    },
  });

  const overrides = await loadOverrides(jobBike.id, auth.shopId);
  return NextResponse.json({
    configured: true,
    jobBikeId: jobBike.id,
    status: "fetched" as const,
    catalogBikeId: result.catalogBikeId,
    specs: applyOverridesToSpecs(result.specs, overrides),
    fetchedAt: now.toISOString(),
    overrides,
  });
}

/** Upsert a per-slot confirmation / customization for this job bike. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof overrideSchema>;
  try {
    body = overrideSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const jobBike = await prisma.jobBike.findFirst({
    where: { id: body.jobBikeId, jobId: params.id, shopId: auth.shopId },
    select: { id: true },
  });
  if (!jobBike) {
    return NextResponse.json({ error: "Job bike not found" }, { status: 404 });
  }

  const customValue =
    body.confirmation === "CUSTOMIZED" ? body.customValue?.trim() || null : null;

  if (body.confirmation === "CUSTOMIZED" && !customValue) {
    return NextResponse.json(
      { error: "customValue is required when marking a part as customized" },
      { status: 400 }
    );
  }

  const override = await prisma.jobBikeComponentOverride.upsert({
    where: {
      jobBikeId_slot: { jobBikeId: jobBike.id, slot: body.slot },
    },
    create: {
      shopId: auth.shopId,
      jobBikeId: jobBike.id,
      slot: body.slot,
      confirmation: body.confirmation,
      customValue,
      notes: body.notes ?? null,
    },
    update: {
      confirmation: body.confirmation,
      customValue,
      notes: body.notes ?? null,
    },
  });

  return NextResponse.json({ override });
}
