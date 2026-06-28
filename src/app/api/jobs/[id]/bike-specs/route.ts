import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";
import { z } from "zod";
import {
  fetchSpecsForJobBike,
  isNinetyNineSpokesConfigured,
  type NinetyNineSpokesSpecsPayload,
} from "@/lib/ninety-nine-spokes";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const postSchema = z.object({
  jobBikeId: z.string().min(1),
  refresh: z.boolean().optional(),
  spokesId: z.string().optional(),
});

function serializeCached(
  jobBikeId: string,
  spokesId: string | null,
  specs: unknown,
  fetchedAt: Date | null
) {
  return {
    configured: isNinetyNineSpokesConfigured(),
    jobBikeId,
    status: specs ? ("cached" as const) : ("not_fetched" as const),
    spokesId,
    specs: specs as NinetyNineSpokesSpecsPayload | null,
    fetchedAt: fetchedAt?.toISOString() ?? null,
  };
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
      ninetyNineSpokesId: true,
      ninetyNineSpokesSpecs: true,
      ninetyNineSpokesSpecsFetchedAt: true,
    },
  });
  if (!jobBike) {
    return NextResponse.json({ error: "Job bike not found" }, { status: 404 });
  }

  return NextResponse.json(
    serializeCached(
      jobBike.id,
      jobBike.ninetyNineSpokesId,
      jobBike.ninetyNineSpokesSpecs,
      jobBike.ninetyNineSpokesSpecsFetchedAt
    )
  );
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
      ninetyNineSpokesId: true,
      ninetyNineSpokesSpecs: true,
      ninetyNineSpokesSpecsFetchedAt: true,
    },
  });
  if (!jobBike) {
    return NextResponse.json({ error: "Job bike not found" }, { status: 404 });
  }

  if (!isNinetyNineSpokesConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        jobBikeId: jobBike.id,
        status: "not_configured" as const,
        error: "99 Spokes API key is not configured",
      },
      { status: 503 }
    );
  }

  const useCached =
    !body.refresh &&
    !body.spokesId &&
    jobBike.ninetyNineSpokesSpecs &&
    jobBike.ninetyNineSpokesSpecsFetchedAt;
  if (useCached) {
    return NextResponse.json({
      ...serializeCached(
        jobBike.id,
        jobBike.ninetyNineSpokesId,
        jobBike.ninetyNineSpokesSpecs,
        jobBike.ninetyNineSpokesSpecsFetchedAt
      ),
      status: "cached" as const,
    });
  }

  const existingId = body.spokesId ?? (body.refresh ? null : jobBike.ninetyNineSpokesId);
  const result = await fetchSpecsForJobBike(jobBike.make, jobBike.model, existingId);

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
      ninetyNineSpokesId: result.spokesId,
      ninetyNineSpokesSpecs: result.specs as Prisma.InputJsonValue,
      ninetyNineSpokesSpecsFetchedAt: now,
    },
  });

  return NextResponse.json({
    configured: true,
    jobBikeId: jobBike.id,
    status: "fetched" as const,
    spokesId: result.spokesId,
    specs: result.specs,
    fetchedAt: now.toISOString(),
  });
}
