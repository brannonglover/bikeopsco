import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sendJobEmail, getTemplateForStage, sendBookingDeclinedEmail } from "@/lib/email";
import { sendJobSms, getTemplateSlugForStage } from "@/lib/sms";
import { syncCollectionJobService } from "@/lib/collection-fee";

const bikeSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  bikeId: z.string().optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional(),
});

const updateJobSchema = z.object({
  stage: z.enum(["BOOKED_IN", "RECEIVED", "WORKING_ON", "WAITING_ON_PARTS", "BIKE_READY", "COMPLETED", "CANCELLED"]).optional(),
  /** When false, skip customer email and SMS for this update (stage / pending rejection). Defaults to true if omitted. */
  notifyCustomer: z.boolean().optional(),
  cancellationReason: z.string().min(1).optional(),
  bikeMake: z.string().min(1).optional(),
  bikeModel: z.string().min(1).optional(),
  bikes: z.array(bikeSchema).optional(),
  workingOnJobBikeId: z.string().optional().nullable(),
  completeJobBikeId: z.string().optional(),
  uncompleteJobBikeId: z.string().optional(),
  waitForPartsJobBikeId: z.string().optional(),
  unwaitForPartsJobBikeId: z.string().optional(),
  customerId: z.string().optional().nullable(),
  deliveryType: z.enum(["DROP_OFF_AT_SHOP", "COLLECTION_SERVICE"]).optional(),
  dropOffDate: z.string().datetime().optional().nullable(),
  pickupDate: z.string().datetime().optional().nullable(),
  collectionAddress: z.string().optional().nullable(),
  collectionWindowStart: z.string().optional().nullable(),
  collectionWindowEnd: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
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
      include: {
        customer: true,
        jobBikes: { select: { id: true, completedAt: true } },
      },
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
    if (data.collectionWindowStart !== undefined) updateData.collectionWindowStart = data.collectionWindowStart;
    if (data.collectionWindowEnd !== undefined) updateData.collectionWindowEnd = data.collectionWindowEnd;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.internalNotes !== undefined) updateData.internalNotes = data.internalNotes;
    if (data.workingOnJobBikeId !== undefined) updateData.workingOnJobBikeId = data.workingOnJobBikeId;

    /** When moving to Working on, pick the only open bike automatically; multiple bikes need an explicit tap in the job modal. */
    let autoWorkingOnJobBikeId: string | null = null;
    if (
      data.stage === "WORKING_ON" &&
      data.workingOnJobBikeId === undefined
    ) {
      const incomplete = (existingJob.jobBikes ?? []).filter((b) => !b.completedAt);
      if (incomplete.length === 1) {
        autoWorkingOnJobBikeId = incomplete[0].id;
        updateData.workingOnJobBikeId = incomplete[0].id;
      }
    }

    const workingOnBikeIdToClearWaiting: string | null =
      data.workingOnJobBikeId !== undefined
        ? data.workingOnJobBikeId
        : autoWorkingOnJobBikeId;

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
      if (workingOnBikeIdToClearWaiting) {
        await tx.jobBike.update({
          where: { id: workingOnBikeIdToClearWaiting, jobId: id },
          data: { waitingOnPartsAt: null },
        });
      }
      if (data.bikes !== undefined) {
        await tx.jobBike.deleteMany({ where: { jobId: id } });
        const bikes =
          data.bikes.length > 0
            ? data.bikes
            : [{ make: existingJob.bikeMake, model: existingJob.bikeModel }];

        // Determine the effective customerId (may be changing in this same PATCH).
        const effectiveCustomerId =
          data.customerId !== undefined ? data.customerId : existingJob.customerId;

        // For each bike without a bikeId, find or create a Bike record on the customer's profile.
        const resolvedBikes: Array<(typeof bikes)[number] & { bikeId: string | null }> = [];
        for (const b of bikes) {
          let bikeId: string | null = ("bikeId" in b ? b.bikeId : null) ?? null;
          if (!bikeId && effectiveCustomerId) {
            const existing = await tx.bike.findFirst({
              where: {
                customerId: effectiveCustomerId,
                make: { equals: b.make.trim(), mode: "insensitive" },
                model: { equals: b.model.trim(), mode: "insensitive" },
              },
            });
            if (existing) {
              bikeId = existing.id;
            } else {
              const created = await tx.bike.create({
                data: {
                  customerId: effectiveCustomerId,
                  make: b.make.trim(),
                  model: b.model.trim(),
                  bikeType: ("bikeType" in b ? b.bikeType : null) ?? null,
                  nickname: ("nickname" in b ? b.nickname : null) ?? null,
                  imageUrl: ("imageUrl" in b ? b.imageUrl : null) ?? null,
                },
              });
              bikeId = created.id;
            }
          }
          resolvedBikes.push({ ...b, bikeId });
        }

        await tx.jobBike.createMany({
          data: resolvedBikes.map((b, i) => ({
            jobId: id,
            make: b.make,
            model: b.model,
            nickname: b.nickname ?? null,
            imageUrl: b.imageUrl ?? null,
            bikeId: b.bikeId,
            bikeType: b.bikeType ?? null,
            sortOrder: i,
          })),
        });
      }
      if (data.completeJobBikeId) {
        await tx.jobBike.update({
          where: { id: data.completeJobBikeId, jobId: id },
          data: { completedAt: new Date(), waitingOnPartsAt: null },
        });
        if (existingJob.workingOnJobBikeId === data.completeJobBikeId) {
          await tx.job.update({ where: { id }, data: { workingOnJobBikeId: null } });
        }
      }
      if (data.uncompleteJobBikeId) {
        await tx.jobBike.update({
          where: { id: data.uncompleteJobBikeId, jobId: id },
          data: { completedAt: null },
        });
      }
      if (data.waitForPartsJobBikeId) {
        await tx.jobBike.update({
          where: { id: data.waitForPartsJobBikeId, jobId: id },
          data: { waitingOnPartsAt: new Date() },
        });
        if (existingJob.workingOnJobBikeId === data.waitForPartsJobBikeId) {
          await tx.job.update({ where: { id }, data: { workingOnJobBikeId: null } });
        }
      }
      if (data.unwaitForPartsJobBikeId) {
        await tx.jobBike.update({
          where: { id: data.unwaitForPartsJobBikeId, jobId: id },
          data: { waitingOnPartsAt: null },
        });
      }
      /** Only when the job actually moves into this column — not idempotent WOP PATCHs (would re-set waiting after resume / unwait). */
      if (
        data.stage === "WAITING_ON_PARTS" &&
        existingJob.stage !== "WAITING_ON_PARTS" &&
        existingJob.workingOnJobBikeId &&
        !data.unwaitForPartsJobBikeId
      ) {
        await tx.jobBike.update({
          where: { id: existingJob.workingOnJobBikeId, jobId: id },
          data: { waitingOnPartsAt: new Date() },
        });
        await tx.job.update({ where: { id }, data: { workingOnJobBikeId: null } });
      }
      /** Dragging the card out of Waiting on parts (or any other column) must drop bike-level flags; only staying in WAITING_ON_PARTS keeps them. */
      if (data.stage !== undefined && data.stage !== "WAITING_ON_PARTS") {
        await tx.jobBike.updateMany({
          where: {
            jobId: id,
            completedAt: null,
            waitingOnPartsAt: { not: null },
          },
          data: { waitingOnPartsAt: null },
        });
      }
      await syncCollectionJobService(tx, id);
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
      job.customer?.email &&
      data.notifyCustomer !== false
    ) {
      const reason = (data.cancellationReason ?? job.cancellationReason ?? "").trim();
      sendBookingDeclinedEmail(job.customer.email, {
        bikeMake: job.bikeMake,
        bikeModel: job.bikeModel,
        cancellationReason: reason || "We're unable to accommodate this booking at this time.",
        customer: job.customer,
      }).catch((e) => console.error("[Reject] Declined email failed:", e));
    }

    // Dedup checks + sends run after the response is built so the board PATCH returns as soon as the DB work finishes.
    if (
      data.notifyCustomer !== false &&
      data.stage &&
      data.stage !== "CANCELLED" &&
      data.stage !== "COMPLETED" &&
      existingJob
    ) {
      const templateSlug = getTemplateForStage(data.stage, existingJob.deliveryType);
      const smsTemplateSlug = getTemplateSlugForStage(data.stage, existingJob.deliveryType);
      const customerEmail = job.customer?.email;
      const customerPhone = job.customer?.phone;

      void (async () => {
        try {
          const emailPromise =
            customerEmail && templateSlug
              ? prisma.jobEmail.findFirst({
                  where: { jobId: id, templateSlug },
                })
              : Promise.resolve(null);
          const smsPromise =
            customerPhone && smsTemplateSlug
              ? prisma.jobSms.findFirst({
                  where: { jobId: id, templateSlug: smsTemplateSlug },
                })
              : Promise.resolve(null);
          const [emailAlreadySent, smsAlreadySent] = await Promise.all([
            emailPromise,
            smsPromise,
          ]);
          if (customerEmail && templateSlug && !emailAlreadySent) {
            sendJobEmail(templateSlug, customerEmail, job).catch(console.error);
          }
          if (customerPhone && smsTemplateSlug && !smsAlreadySent) {
            sendJobSms(smsTemplateSlug, customerPhone, job).catch(console.error);
          }
        } catch (e) {
          console.error("[PATCH job] stage notification dedup/send failed:", e);
        }
      })();
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
