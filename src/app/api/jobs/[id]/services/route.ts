import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getShopForHost } from "@/lib/shop";

async function getAuthorizedShopId(request: NextRequest): Promise<string | null> {
  const token = await getToken({ req: request });
  if (!token?.shopId) return null;

  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const shop = await getShopForHost(hostHeader);
  if (!shop || shop.id !== token.shopId) return null;

  return shop.id;
}

const addServiceSchema = z.union([
  z.object({
    serviceId: z.string().min(1),
    quantity: z.number().int().min(1).optional().default(1),
    jobBikeId: z.string().optional().nullable(),
  }),
  z.object({
    customServiceName: z.string().min(1),
    unitPrice: z.number().min(0).optional().default(0),
    quantity: z.number().int().min(1).optional().default(1),
    jobBikeId: z.string().optional().nullable(),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const shopId = await getAuthorizedShopId(request);
  if (!shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = addServiceSchema.parse(body);

    const job = await prisma.job.findFirst({ where: { id: jobId, shopId }, select: { id: true } });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    if ("serviceId" in data) {
      const service = await prisma.service.findUnique({
        where: { id: data.serviceId, shopId },
      });

      if (!service) {
        return NextResponse.json(
          { error: "Service not found" },
          { status: 404 }
        );
      }

      if (service.isSystem) {
        return NextResponse.json(
          { error: "This service is added automatically (e.g. collection fee)." },
          { status: 400 }
        );
      }

      if (data.jobBikeId) {
        const jobBike = await prisma.jobBike.findFirst({
          where: { id: data.jobBikeId, jobId, shopId },
          select: { id: true },
        });
        if (!jobBike) {
          return NextResponse.json({ error: "Job bike not found" }, { status: 404 });
        }
      }

      const jobService = await prisma.jobService.create({
        data: {
          shopId,
          jobId,
          serviceId: data.serviceId,
          quantity: data.quantity,
          unitPrice: service.price,
          jobBikeId: data.jobBikeId ?? null,
        },
        include: { service: true, jobBike: { select: { id: true, make: true, model: true, nickname: true } } },
      });

      return NextResponse.json(jobService);
    }

    if (data.jobBikeId) {
      const jobBike = await prisma.jobBike.findFirst({
        where: { id: data.jobBikeId, jobId, shopId },
        select: { id: true },
      });
      if (!jobBike) {
        return NextResponse.json({ error: "Job bike not found" }, { status: 404 });
      }
    }

    const jobService = await prisma.jobService.create({
      data: {
        shopId,
        jobId,
        customServiceName: data.customServiceName,
        quantity: data.quantity,
        unitPrice: data.unitPrice,
        jobBikeId: data.jobBikeId ?? null,
      },
      include: { jobBike: { select: { id: true, make: true, model: true, nickname: true } } },
    });

    return NextResponse.json(jobService);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/jobs/[id]/services error:", error);
    return NextResponse.json(
      { error: "Failed to add service to job" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const shopId = await getAuthorizedShopId(request);
  if (!shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: jobId } = params;
    const { searchParams } = new URL(request.url);
    const jobServiceId = searchParams.get("jobServiceId");

    if (!jobServiceId) {
      return NextResponse.json(
        { error: "jobServiceId query param required" },
        { status: 400 }
      );
    }

    const existing = await prisma.jobService.findFirst({
      where: { id: jobServiceId, jobId, shopId },
      include: { service: true },
    });
    if (existing?.service?.isSystem) {
      return NextResponse.json(
        {
          error:
            "Cannot remove this line. Change delivery type to drop-off at the shop, or edit the job.",
        },
        { status: 400 }
      );
    }

    const result = await prisma.jobService.deleteMany({
      where: {
        id: jobServiceId,
        jobId,
        shopId,
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: "Job service not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/jobs/[id]/services error:", error);
    return NextResponse.json(
      { error: "Failed to remove service from job" },
      { status: 500 }
    );
  }
}

const patchServiceSchema = z
  .object({
    jobServiceId: z.string().min(1),
    quantity: z.number().int().min(1).optional(),
    unitPrice: z.number().min(0).optional(),
    jobBikeId: z.string().nullable().optional(),
    applyToAllBikes: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.quantity !== undefined ||
      data.unitPrice !== undefined ||
      "jobBikeId" in data ||
      data.applyToAllBikes === true,
    { message: "Provide quantity, unitPrice, and/or jobBikeId" }
  );

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const shopId = await getAuthorizedShopId(request);
  if (!shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = patchServiceSchema.parse(body);

    const existing = await prisma.jobService.findFirst({
      where: { id: data.jobServiceId, jobId, shopId },
      include: { service: true },
    });

    if (!existing) {
      return NextResponse.json(
        { error: "Job service not found" },
        { status: 404 }
      );
    }

    if (existing.service?.isSystem) {
      return NextResponse.json(
        {
          error:
            "Cannot change this line. Change delivery type or edit the job.",
        },
        { status: 400 }
      );
    }

    if (data.applyToAllBikes) {
      const jobBikes = await prisma.jobBike.findMany({
        where: { jobId, shopId },
        select: { id: true },
        orderBy: { sortOrder: "asc" },
      });

      // Legacy / single-bike jobs don't need fan-out; keep the existing line as-is.
      if (jobBikes.length <= 1) {
        const updated = await prisma.jobService.update({
          where: { id: data.jobServiceId, shopId },
          data: {},
          include: {
            service: true,
            jobBike: { select: { id: true, make: true, model: true, nickname: true } },
          },
        });
        return NextResponse.json({ updated, createdCount: 0 });
      }

      const bikeIds = jobBikes.map((b) => b.id);
      const baseBikeId =
        existing.jobBikeId && bikeIds.includes(existing.jobBikeId) ? existing.jobBikeId : bikeIds[0];

      const identityWhere: { serviceId: string | null; customServiceName?: string | null } =
        existing.serviceId
          ? { serviceId: existing.serviceId }
          : { serviceId: null, customServiceName: existing.customServiceName ?? null };

      const { updated, createdIds } = await prisma.$transaction(async (tx) => {
        const updated = await tx.jobService.update({
          where: { id: existing.id, shopId },
          data: { jobBikeId: baseBikeId },
          include: {
            service: true,
            jobBike: { select: { id: true, make: true, model: true, nickname: true } },
          },
        });

        const existingMatches = await tx.jobService.findMany({
          where: {
            shopId,
            jobId,
            id: { not: existing.id },
            jobBikeId: { in: bikeIds },
            ...identityWhere,
            quantity: existing.quantity,
            unitPrice: existing.unitPrice,
            notes: existing.notes,
          },
          select: { id: true, jobBikeId: true },
        });

        const bikesWithLine = new Set<string>(
          [baseBikeId, ...existingMatches.map((m) => m.jobBikeId).filter(Boolean)] as string[]
        );

        const createdIds: string[] = [];
        for (const bikeId of bikeIds) {
          if (bikesWithLine.has(bikeId)) continue;
          const created = await tx.jobService.create({
            data: {
              shopId,
              jobId,
              serviceId: existing.serviceId,
              customServiceName: existing.customServiceName,
              quantity: existing.quantity,
              unitPrice: existing.unitPrice,
              notes: existing.notes,
              jobBikeId: bikeId,
            },
            select: { id: true },
          });
          createdIds.push(created.id);
        }

        return { updated, createdIds };
      });

      return NextResponse.json({
        updated,
        createdCount: createdIds.length,
        createdIds,
      });
    }

    const updateData: { quantity?: number; unitPrice?: number; jobBikeId?: string | null } = {};
    if (data.quantity !== undefined) {
      updateData.quantity = data.quantity;
    }
    if (data.unitPrice !== undefined) {
      updateData.unitPrice = Math.round(data.unitPrice * 100) / 100;
    }
    if ("jobBikeId" in data) {
      updateData.jobBikeId = data.jobBikeId ?? null;
    }

    const updated = await prisma.jobService.update({
      where: { id: data.jobServiceId, shopId },
      data: updateData,
      include: { service: true, jobBike: { select: { id: true, make: true, model: true, nickname: true } } },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/jobs/[id]/services error:", error);
    return NextResponse.json(
      { error: "Failed to update service line" },
      { status: 500 }
    );
  }
}
