import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const addServiceSchema = z.object({
  serviceId: z.string().min(1),
  quantity: z.number().int().min(1).optional().default(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = addServiceSchema.parse(body);

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
      },
      include: {
        service: true,
      },
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
    if (existing?.service.isSystem) {
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
