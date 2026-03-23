import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sendJobEmail, getTemplateForStage } from "@/lib/email";
import { sendJobSms, getTemplateSlugForStage } from "@/lib/sms";

const updateJobSchema = z.object({
  stage: z.enum(["BOOKED_IN", "RECEIVED", "WORKING_ON", "WAITING_ON_PARTS", "BIKE_READY", "COMPLETED", "CANCELLED"]).optional(),
  cancellationReason: z.string().min(1).optional(),
  bikeMake: z.string().min(1).optional(),
  bikeModel: z.string().min(1).optional(),
  customerId: z.string().optional().nullable(),
  deliveryType: z.enum(["DROP_OFF_AT_SHOP", "COLLECTION_SERVICE"]).optional(),
  dropOffDate: z.string().datetime().optional().nullable(),
  pickupDate: z.string().datetime().optional().nullable(),
  collectionAddress: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const job = await prisma.job.findUnique({
      where: { id },
      include: {
        customer: true,
        jobServices: { include: { service: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (error) {
    console.error("GET /api/jobs/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to fetch job" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    const body = await request.json();
    const data = updateJobSchema.parse(body);

    if (data.stage === "CANCELLED" && (!data.cancellationReason || data.cancellationReason.trim() === "")) {
      return NextResponse.json(
        { error: "Cancellation reason is required when cancelling a job" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (data.stage !== undefined) updateData.stage = data.stage;
    if (data.cancellationReason !== undefined) updateData.cancellationReason = data.cancellationReason;
    if (data.bikeMake !== undefined) updateData.bikeMake = data.bikeMake;
    if (data.bikeModel !== undefined) updateData.bikeModel = data.bikeModel;
    if (data.customerId !== undefined) updateData.customerId = data.customerId;
    if (data.deliveryType !== undefined) updateData.deliveryType = data.deliveryType;
    if (data.dropOffDate !== undefined) updateData.dropOffDate = data.dropOffDate ? new Date(data.dropOffDate) : null;
    if (data.pickupDate !== undefined) updateData.pickupDate = data.pickupDate ? new Date(data.pickupDate) : null;
    if (data.collectionAddress !== undefined) updateData.collectionAddress = data.collectionAddress;
    if (data.notes !== undefined) updateData.notes = data.notes;

    if (data.stage === "COMPLETED") {
      updateData.completedAt = new Date();
    }

    const existingJob = await prisma.job.findUnique({
      where: { id },
      include: { customer: true },
    });

    const job = await prisma.job.update({
      where: { id },
      data: updateData,
      include: {
        customer: true,
        jobServices: { include: { service: true } },
      },
    });

    // Don't send notifications when cancelling or marking complete (internal status only)
    if (data.stage && data.stage !== "CANCELLED" && data.stage !== "COMPLETED" && existingJob) {
      const templateSlug = getTemplateForStage(data.stage, existingJob.deliveryType);
      const smsTemplateSlug = getTemplateSlugForStage(data.stage, existingJob.deliveryType);

      // Email
      const customerEmail = job.customer?.email;
      if (customerEmail && templateSlug) {
        const emailAlreadySent = await prisma.jobEmail.findFirst({
          where: { jobId: id, templateSlug },
        });
        if (!emailAlreadySent) {
          sendJobEmail(templateSlug, customerEmail, job).catch(console.error);
        }
      }

      // SMS
      const customerPhone = job.customer?.phone;
      if (customerPhone && smsTemplateSlug) {
        const smsAlreadySent = await prisma.jobSms.findFirst({
          where: { jobId: id, templateSlug: smsTemplateSlug },
        });
        if (!smsAlreadySent) {
          sendJobSms(smsTemplateSlug, customerPhone, job).catch(console.error);
        }
      }
    }

    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/jobs/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to update job" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const existingJob = await prisma.job.findUnique({ where: { id } });
    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    await prisma.job.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/jobs/[id] error:", error);
    return NextResponse.json(
      { error: "Failed to delete job" },
      { status: 500 }
    );
  }
}
