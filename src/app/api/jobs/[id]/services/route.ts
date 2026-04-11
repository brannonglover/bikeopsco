import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { z } from "zod";

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
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = addServiceSchema.parse(body);

    if ("serviceId" in data) {
      const service = await prisma.service.findUnique({
        where: { id: data.serviceId },
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

      const jobService = await prisma.jobService.create({
        data: {
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

    const jobService = await prisma.jobService.create({
      data: {
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
  const token = await getToken({ req: request });
  if (!token) {
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
      where: { id: jobServiceId, jobId },
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
  })
  .refine(
    (data) =>
      data.quantity !== undefined ||
      data.unitPrice !== undefined ||
      "jobBikeId" in data,
    { message: "Provide quantity, unitPrice, and/or jobBikeId" }
  );

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = patchServiceSchema.parse(body);

    const existing = await prisma.jobService.findFirst({
      where: { id: data.jobServiceId, jobId },
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
      where: { id: data.jobServiceId },
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
