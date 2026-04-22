import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getToken } from "next-auth/jwt";
import { sendJobEmail, getTemplateForStage, sendBookingDeclinedEmail } from "@/lib/email";
import { sendJobSms, getTemplateSlugForStage } from "@/lib/sms";
import { syncCollectionJobService } from "@/lib/collection-fee";
import { getAppFeatures } from "@/lib/app-settings";
import { computeTotalFromChargedAmount } from "@/lib/stripe";

const bikeSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1).optional().nullable(),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  bikeId: z.string().optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional(),
});

const updateJobSchema = z.object({
  stage: z.enum(["BOOKED_IN", "RECEIVED", "WORKING_ON", "WAITING_ON_CUSTOMER", "WAITING_ON_PARTS", "BIKE_READY", "COMPLETED", "CANCELLED"]).optional(),
  /** Archive/unarchive a job. When true, sets archivedAt; when false, clears it. */
  archived: z.boolean().optional(),
  /** When false, skip customer email and SMS for this update (stage / pending rejection). Defaults to true if omitted. */
  notifyCustomer: z.boolean().optional(),
  cancellationReason: z.string().min(1).optional(),
  bikeMake: z.string().min(1).optional(),
  bikeModel: z.string().min(1).optional(),
  bikes: z.array(bikeSchema).optional(),
  /** Append a single bike to the job without touching existing JobBike workflow state. */
  addBike: bikeSchema.optional(),
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

function computeTotalPaid(
  payments: Array<{
    amount: unknown;
    status: unknown;
    stripePaymentIntentId?: string | null;
    paymentMethod?: string | null;
  }> | null | undefined
): number {
  const totalPaid = (payments ?? []).reduce((sum, p) => {
    const status = String(p.status ?? "").toLowerCase();
    if (status !== "succeeded") return sum;
    const n = Number.parseFloat(String(p.amount));
    if (!Number.isFinite(n)) return sum;

    const method = String(p.paymentMethod ?? "").toLowerCase();
    const isStripe = Boolean(p.stripePaymentIntentId);
    const mode =
      method === "terminal" || method === "card_present" ? "terminal" : "online";

    // Stripe "amount" is stored as the charged amount (includes card surcharge for online/in_person).
    // For the invoice/remaining calculation we want the base job total it pays down (i.e. after fees).
    const paidTowardJobTotal = isStripe ? computeTotalFromChargedAmount(n, mode) : n;
    return sum + paidTowardJobTotal;
  }, 0);
  return Math.round(totalPaid * 100) / 100;
}

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
        jobServices: { include: { service: true, jobBike: { select: { id: true, make: true, model: true, nickname: true } } } },
        jobProducts: { include: { product: true, jobBike: { select: { id: true, make: true, model: true, nickname: true } } } },
        payments: { select: { amount: true, status: true, stripePaymentIntentId: true, paymentMethod: true } },
      },
    });
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    const totalPaid = computeTotalPaid(job.payments);
    const jobWithoutPayments = { ...job, payments: undefined };
    const res = NextResponse.json({
      ...jobWithoutPayments,
      totalPaid,
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
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
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const features = await getAppFeatures();
    const { id } = params;
    const body = await request.json();
    const data = updateJobSchema.parse(body);

    if (data.deliveryType === "COLLECTION_SERVICE" && !features.collectionServiceEnabled) {
      return NextResponse.json(
        { error: "Collection service is currently disabled." },
        { status: 400 }
      );
    }

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
    if (data.archived !== undefined) updateData.archivedAt = data.archived ? new Date() : null;
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

    // Reset column sort order when moving between stages so the job falls back
    // to dropOffDate ordering in its new column.
    if (data.stage !== undefined && data.stage !== existingJob.stage) {
      updateData.columnSortOrder = null;
    }

    if (data.bikes !== undefined) {
      const bikes =
        data.bikes.length > 0
          ? data.bikes
          : [{ make: existingJob.bikeMake, model: existingJob.bikeModel }];
      updateData.bikeMake = bikes.length === 1 ? bikes[0].make : "Multiple";
      updateData.bikeModel = bikes.length === 1 ? bikes[0].model : `${bikes.length} bikes`;
    }

    if (data.addBike !== undefined) {
      const existingCount = existingJob.jobBikes?.length ?? 0;
      const totalCount = existingCount + 1;
      if (totalCount === 1) {
        updateData.bikeMake = data.addBike.make;
        updateData.bikeModel = data.addBike.model;
      } else {
        updateData.bikeMake = "Multiple";
        updateData.bikeModel = `${totalCount} bikes`;
      }
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
            const trimmedModel = b.model?.trim() || null;
            const existing = await tx.bike.findFirst({
              where: {
                customerId: effectiveCustomerId,
                make: { equals: b.make.trim(), mode: "insensitive" },
                model: trimmedModel ? { equals: trimmedModel, mode: "insensitive" } : null,
              },
            });
            if (existing) {
              bikeId = existing.id;
            } else {
              const created = await tx.bike.create({
                data: {
                  customerId: effectiveCustomerId,
                  make: b.make.trim(),
                  model: trimmedModel,
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
      if (data.addBike !== undefined) {
        const b = data.addBike;
        const effectiveCustomerId =
          data.customerId !== undefined ? data.customerId : existingJob.customerId;
        let bikeId: string | null = b.bikeId ?? null;
        if (!bikeId && effectiveCustomerId) {
          const trimmedModel = b.model?.trim() || null;
          const found = await tx.bike.findFirst({
            where: {
              customerId: effectiveCustomerId,
              make: { equals: b.make.trim(), mode: "insensitive" },
              model: trimmedModel ? { equals: trimmedModel, mode: "insensitive" } : null,
            },
          });
          if (found) {
            bikeId = found.id;
          } else {
            const created = await tx.bike.create({
              data: {
                customerId: effectiveCustomerId,
                make: b.make.trim(),
                model: trimmedModel,
                bikeType: b.bikeType ?? null,
                nickname: b.nickname ?? null,
                imageUrl: b.imageUrl ?? null,
              },
            });
            bikeId = created.id;
          }
        }
        const nextSortOrder = (existingJob.jobBikes?.length ?? 0);
        await tx.jobBike.create({
          data: {
            jobId: id,
            make: b.make,
            model: b.model,
            nickname: b.nickname ?? null,
            imageUrl: b.imageUrl ?? null,
            bikeId,
            bikeType: b.bikeType ?? null,
            sortOrder: nextSortOrder,
          },
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
      /** Clear the active-bike pointer whenever the job leaves WORKING_ON (WAITING_ON_PARTS already handles its own branch above). */
      if (
        data.stage !== undefined &&
        data.stage !== "WORKING_ON" &&
        data.stage !== "WAITING_ON_PARTS" &&
        existingJob.workingOnJobBikeId
      ) {
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
      const nextDeliveryType =
        data.deliveryType !== undefined ? data.deliveryType : existingJob.deliveryType;
      if (
        features.collectionServiceEnabled &&
        (existingJob.deliveryType === "COLLECTION_SERVICE" ||
          nextDeliveryType === "COLLECTION_SERVICE")
      ) {
        await syncCollectionJobService(tx, id);
      }
      const result = await tx.job.findUnique({
        where: { id },
        include: {
          customer: { include: { bikes: true } },
          jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
          jobServices: { include: { service: true, jobBike: { select: { id: true, make: true, model: true, nickname: true } } } },
          jobProducts: { include: { product: true, jobBike: { select: { id: true, make: true, model: true, nickname: true } } } },
          payments: { select: { amount: true, status: true, stripePaymentIntentId: true, paymentMethod: true } },
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
      features.notifyCustomerEnabled &&
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
      features.notifyCustomerEnabled &&
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

    const totalPaid = computeTotalPaid(job.payments);
    const jobWithoutPayments = { ...job, payments: undefined };
    const res = NextResponse.json({ ...jobWithoutPayments, totalPaid });
    res.headers.set("Cache-Control", "no-store");
    return res;
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
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
