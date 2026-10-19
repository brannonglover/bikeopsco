import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";
import { z } from "zod";
import { reconcileInstalledComponentsSafely } from "@/lib/bike-installed-components";
import { staffDisplayName } from "@/lib/customer-bike-build";
import { loadPartsTab, readPartsTab } from "@/lib/parts-tab";

export const dynamic = "force-dynamic";
// Catalog lookups scheduled here keep running after the response
// (LOOKUP_TIME_BUDGET_MS fits inside this).
export const maxDuration = 300;

/** The Parts tab — see src/lib/parts-tab.ts. */

const postSchema = z.object({
  jobBikeId: z.string().min(1),
  refresh: z.boolean().optional(),
  /** The mechanic picked this build from the possible matches. */
  catalogBikeId: z.string().optional(),
  /** The mechanic confirmed the automatically matched build is this bike. */
  confirm: z.boolean().optional(),
});

const overrideSchema = z.object({
  jobBikeId: z.string().min(1),
  slot: z.string().min(1),
  /** What's on the bike now, as the mechanic sees it. */
  confirmation: z.enum(["UNREVIEWED", "MATCHES_CATALOG", "CUSTOMIZED"]).optional(),
  customValue: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  /** Work on this job: PLANNED (proposed / ordered) or INSTALLED (fitted). */
  replacement: z
    .object({
      state: z.enum(["NONE", "PLANNED", "INSTALLED"]),
      value: z.string().optional().nullable(),
    })
    .optional(),
});

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  const jobBikeId = request.nextUrl.searchParams.get("jobBikeId")?.trim();
  if (!jobBikeId) {
    return NextResponse.json({ error: "jobBikeId is required" }, { status: 400 });
  }
  const { httpStatus, body } = await readPartsTab({ jobId: params.id, jobBikeId, shopId: auth.shopId });
  return NextResponse.json(body, { status: httpStatus });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await loadPartsTab({
    jobId: params.id,
    jobBikeId: body.jobBikeId,
    shopId: auth.shopId,
    userId: auth.userId,
    refresh: body.refresh,
    catalogBikeId: body.catalogBikeId,
    confirm: body.confirm,
  });
  return NextResponse.json(result.body, { status: result.httpStatus });
}

/**
 * Record what the mechanic sees on one part, or work on it in this job.
 * Nothing here reaches the customer's bike record until the work is done —
 * see bike-installed-components.ts.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  let body: z.infer<typeof overrideSchema>;
  try {
    body = overrideSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.confirmation && !body.replacement && body.notes === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const jobBike = await prisma.jobBike.findFirst({
    where: { id: body.jobBikeId, jobId: params.id, shopId: auth.shopId },
    select: { id: true },
  });
  if (!jobBike) {
    return NextResponse.json({ error: "Job bike not found" }, { status: 404 });
  }

  const existing = await prisma.jobBikeComponentOverride.findUnique({
    where: { jobBikeId_slot: { jobBikeId: jobBike.id, slot: body.slot } },
  });

  const data: {
    confirmation?: "UNREVIEWED" | "MATCHES_CATALOG" | "CUSTOMIZED";
    customValue?: string | null;
    notes?: string | null;
    replacementState?: "NONE" | "PLANNED" | "INSTALLED";
    replacementValue?: string | null;
    replacementInstalledAt?: Date | null;
  } = {};

  if (body.confirmation) {
    const customValue =
      body.confirmation === "CUSTOMIZED" ? body.customValue?.trim() || null : null;
    if (body.confirmation === "CUSTOMIZED" && !customValue) {
      return NextResponse.json(
        { error: "Say which part is on the bike" },
        { status: 400 }
      );
    }
    data.confirmation = body.confirmation;
    data.customValue = customValue;
  }
  if (body.notes !== undefined) data.notes = body.notes;

  if (body.replacement) {
    const state = body.replacement.state;
    const value =
      state === "NONE"
        ? null
        : body.replacement.value?.trim() || existing?.replacementValue?.trim() || null;
    if (state !== "NONE" && !value) {
      return NextResponse.json({ error: "Say which part is going on" }, { status: 400 });
    }
    data.replacementState = state;
    data.replacementValue = value;
    data.replacementInstalledAt =
      state === "INSTALLED"
        ? existing?.replacementState === "INSTALLED" && existing.replacementInstalledAt
          ? existing.replacementInstalledAt
          : new Date()
        : null;
  }

  const updatedBy = await staffDisplayName(auth.userId);
  const override = await prisma.jobBikeComponentOverride.upsert({
    where: { jobBikeId_slot: { jobBikeId: jobBike.id, slot: body.slot } },
    create: {
      shopId: auth.shopId,
      jobBikeId: jobBike.id,
      slot: body.slot,
      ...data,
      updatedBy,
    },
    update: { ...data, updatedBy },
  });

  // If the work is already done (e.g. noted after the bike was marked done),
  // this reaches — or leaves — the customer's bike record now.
  await reconcileInstalledComponentsSafely(params.id);

  return NextResponse.json({ override });
}
