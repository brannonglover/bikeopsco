import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sendJobEmail, getTemplateForStage, sendBookingDeclinedEmail } from "@/lib/email";
import { sendJobSms, getTemplateSlugForStage } from "@/lib/sms";

const bikeSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  bikeId: z.string().optional().nullable(),
});

const updateJobSchema = z.object({
  stage: z.enum(["BOOKED_IN", "RECEIVED", "WORKING_ON", "WAITING_ON_PARTS", "BIKE_READY", "COMPLETED", "CANCELLED"]).optional(),
  cancellationReason: z.string().min(1).optional(),
  bikeMake: z.string().min(1).optional(),
  bikeModel: z.string().min(1).optional(),
  bikes: z.array(bikeSchema).optional(),
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
        customer: { include: { bikes: true } },
        jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
        jobServices: { include: { service: true } },
        jobProducts: { include: { product: true } },
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

    const existingJob = await prisma.job.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
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

    if (data.bikes !== undefined) {
      const bikes =
        data.bikes.length > 0
          ? data.bikes
          : [{ make: existingJob.bikeMake, model: existingJob.bikeModel }];
      updateData.bikeMake = bikes.length === 1 ? bikes[0].make : "Multiple";
      updateData.bikeModel = bikes.length === 1 ? bikes[0].model : `${bikes.length} bikes`;
    }

    const job = await prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id },
        data: updateData,
      });
      if (data.bikes !== undefined) {
        await tx.jobBike.deleteMany({ where: { jobId: id } });
        const bikes =
          data.bikes.length > 0
            ? data.bikes
            : [{ make: existingJob.bikeMake, model: existingJob.bikeModel }];
        await tx.jobBike.createMany({
          data: bikes.map((b, i) => ({
            jobId: id,
            make: b.make,
            model: b.model,
            nickname: b.nickname ?? null,
            imageUrl: b.imageUrl ?? null,
            bikeId: b.bikeId ?? null,
            sortOrder: i,
          })),
        });
      }
      const result = await tx.job.findUnique({
        where: { id },
        include: {
          customer: { include: { bikes: true } },
          jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
          jobServices: { include: { service: true } },
          jobProducts: { include: { product: true } },
        },
      });
      if (!result) throw new Error("Job not found");
      return result;
    });

    // Send booking declined email when rejecting a pending-approval widget booking
    if (
      data.stage === "CANCELLED" &&
      existingJob?.stage === "PENDING_APPROVAL" &&
      job.customer?.email
    ) {
      const reason = (data.cancellationReason ?? job.cancellationReason ?? "").trim();
      sendBookingDeclinedEmail(job.customer.email, {
        bikeMake: job.bikeMake,
        bikeModel: job.bikeModel,
        cancellationReason: reason || "We're unable to accommodate this booking at this time.",
        customer: job.customer,
      }).catch((e) => console.error("[Reject] Declined email failed:", e));
    }

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
