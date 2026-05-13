import { NextRequest, NextResponse } from "next/server";
import { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getToken } from "next-auth/jwt";
import { sendJobEmail, getTemplateForStage } from "@/lib/email";
import { syncCollectionJobService } from "@/lib/collection-fee";
import { sendPushToAllStaff } from "@/lib/push";
import { getAppFeatures } from "@/lib/app-settings";
import { computeJobSubtotal, computeTotalPaid, getJobPaymentSummary } from "@/lib/job-payments";
import { getShopForHost } from "@/lib/shop";
import { getEffectiveEmailUpdatesConsent, getEffectiveSmsConsent } from "@/lib/sms-consent";

export const dynamic = "force-dynamic";

const bikeSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1).optional().nullable(),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  bikeId: z.string().optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional(),
});

const createJobSchema = z.object({
  bikeMake: z.string().min(1),
  bikeModel: z.string().optional().nullable(),
  bikes: z.array(bikeSchema).optional(),
  customerId: z.string().optional().nullable(),
  deliveryType: z.enum(["DROP_OFF_AT_SHOP", "COLLECTION_SERVICE"]).default("DROP_OFF_AT_SHOP"),
  dropOffDate: z.string().optional().nullable(),
  pickupDate: z.string().optional().nullable(),
  collectionAddress: z.string().optional().nullable(),
  collectionWindowStart: z.string().optional().nullable(),
  collectionWindowEnd: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
  serviceIds: z.array(z.string()).optional().default([]),
});

async function getAuthorizedShopId(request: NextRequest): Promise<string | null> {
  const token = await getToken({ req: request });
  if (!token?.shopId) return null;

  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const shop = await getShopForHost(hostHeader);
  if (!shop || shop.id !== token.shopId) return null;

  return shop.id;
}

export async function GET(request: NextRequest) {
  const shopId = await getAuthorizedShopId(request);
  if (!shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const weekStart = searchParams.get("weekStart");
    const weekEnd = searchParams.get("weekEnd");
    const archived = searchParams.get("archived") === "true";
    const customerIdFilter = searchParams.get("customerId");
    const view = searchParams.get("view");
    const summary = searchParams.get("summary") === "1" || searchParams.get("summary") === "true";

    const where: Record<string, unknown> = { shopId };

    if (customerIdFilter) {
      where.customerId = customerIdFilter;
    }

    const andClauses: Record<string, unknown>[] = [];

    if (archived) {
      if (view === "board") {
        // Archive page (board payload): archived completions plus active cancelled jobs (no board column).
        andClauses.push({
          OR: [{ archivedAt: { not: null } }, { stage: Stage.CANCELLED }],
        });
      } else {
        where.archivedAt = { not: null };
      }
    } else {
      where.archivedAt = null;
      if (view === "board") {
        andClauses.push({ stage: { not: Stage.CANCELLED } });
      }
    }

    if (weekStart && weekEnd) {
      const start = new Date(weekStart);
      const end = new Date(weekEnd);
      andClauses.push({
        OR: [
          {
            dropOffDate: {
              gte: start,
              lte: end,
            },
          },
          {
            pickupDate: {
              gte: start,
              lte: end,
            },
          },
          {
            dropOffDate: null,
            pickupDate: null,
            createdAt: {
              gte: start,
              lte: end,
            },
          },
        ],
      });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }
    // No week filter: returns all jobs so the board shows everything in one view

    const orderBy =
      archived && view === "board"
        ? { updatedAt: "desc" as const }
        : archived
          ? { archivedAt: "desc" as const }
          : [
              { columnSortOrder: { sort: "asc" as const, nulls: "last" as const } },
              { dropOffDate: { sort: "asc" as const, nulls: "last" as const } },
              { createdAt: "asc" as const },
            ];

    if (summary) {
      const jobs = await prisma.job.findMany({
        where,
        select: { id: true, stage: true },
        orderBy,
      });
      const res = NextResponse.json(jobs);
      res.headers.set("Cache-Control", "no-store");
      return res;
    }

    if (view === "board") {
      const jobs = await prisma.job.findMany({
        where,
        select: {
          id: true,
          bikeMake: true,
          bikeModel: true,
          stage: true,
          deliveryType: true,
          dropOffDate: true,
          pickupDate: true,
          collectionAddress: true,
          collectionWindowStart: true,
          collectionWindowEnd: true,
          customerId: true,
          customerNotes: true,
          notes: true,
          internalNotes: true,
          cancellationReason: true,
          completedAt: true,
          archivedAt: true,
          columnSortOrder: true,
          paymentStatus: true,
          workingOnJobBikeId: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              emailUpdatesConsent: true,
              emailUpdatesConsentSource: true,
              emailUpdatesConsentUpdatedAt: true,
              smsConsent: true,
              smsConsentSource: true,
              smsConsentUpdatedAt: true,
              address: true,
              notes: true,
              createdAt: true,
              updatedAt: true,
              // Include bikes so job card display can fall back to the customer's profile bike when a JobBike
              // is not linked (bikeId null), and so nickname edits reflect on the board reliably.
              bikes: {
                select: {
                  id: true,
                  make: true,
                  model: true,
                  bikeType: true,
                  nickname: true,
                  imageUrl: true,
                },
              },
            },
          },
          jobBikes: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              jobId: true,
              make: true,
              model: true,
              bikeType: true,
              nickname: true,
              imageUrl: true,
              bikeId: true,
              sortOrder: true,
              completedAt: true,
              waitingOnPartsAt: true,
              bike: {
                select: {
                  make: true,
                  model: true,
                  bikeType: true,
                  nickname: true,
                  imageUrl: true,
                },
              },
            },
          },
          jobServices: {
            select: {
              id: true,
              serviceId: true,
              customServiceName: true,
              quantity: true,
              unitPrice: true,
              notes: true,
              jobBikeId: true,
              service: true,
              jobBike: {
                select: {
                  id: true,
                  make: true,
                  model: true,
                  nickname: true,
                },
              },
            },
          },
          jobProducts: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              unitPrice: true,
              notes: true,
              jobBikeId: true,
              product: true,
              jobBike: {
                select: {
                  id: true,
                  make: true,
                  model: true,
                  nickname: true,
                },
              },
            },
          },
          payments: {
            select: {
              amount: true,
              status: true,
              stripePaymentIntentId: true,
              paymentMethod: true,
            },
          },
        },
        orderBy,
      });
      const jobsWithPaymentState = jobs.map((job) => {
        const subtotal = computeJobSubtotal({
          jobServices: job.jobServices,
          jobProducts: job.jobProducts,
        });
        const totalPaid = computeTotalPaid(job.payments);
        const paymentSummary = getJobPaymentSummary({
          currentStatus: job.paymentStatus,
          subtotal,
          totalPaid,
        });
        return {
          ...job,
          customer: job.customer
            ? {
                ...job.customer,
                emailUpdatesConsent: getEffectiveEmailUpdatesConsent(job.customer),
                smsConsent: getEffectiveSmsConsent(job.customer),
              }
            : null,
          paymentStatus: paymentSummary.paymentStatus,
          totalPaid,
          payments: undefined,
        };
      });
      const res = NextResponse.json(jobsWithPaymentState);
      res.headers.set("Cache-Control", "no-store");
      return res;
    }

    const jobs = await prisma.job.findMany({
      where,
      include: {
        customer: { include: { bikes: true } },
        jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
        jobServices: {
          include: { service: true },
        },
        jobProducts: { include: { product: true } },
        payments: {
          select: {
            amount: true,
            status: true,
            stripePaymentIntentId: true,
            paymentMethod: true,
          },
        },
      },
      orderBy,
    });
    const jobsWithPaymentState = jobs.map((job) => {
      const subtotal = computeJobSubtotal({
        jobServices: job.jobServices,
        jobProducts: job.jobProducts,
      });
      const totalPaid = computeTotalPaid(job.payments);
      const paymentSummary = getJobPaymentSummary({
        currentStatus: job.paymentStatus,
        subtotal,
        totalPaid,
      });
      return {
        ...job,
        paymentStatus: paymentSummary.paymentStatus,
        totalPaid,
        payments: undefined,
      };
    });

    const res = NextResponse.json(jobsWithPaymentState);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    console.error("GET /api/jobs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const shopId = await getAuthorizedShopId(request);
  if (!shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const features = await getAppFeatures();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    const data = createJobSchema.parse(body);
    if (data.deliveryType === "COLLECTION_SERVICE" && !features.collectionServiceEnabled) {
      return NextResponse.json(
        { error: "Collection service is currently disabled." },
        { status: 400 }
      );
    }
    const bikes = data.bikes && data.bikes.length > 0 ? data.bikes : [{ make: data.bikeMake, model: data.bikeModel }];
    const customerId = data.customerId ?? null;

    const job = await prisma.$transaction(async (tx) => {
      const newJob = await tx.job.create({
        data: {
          shop: { connect: { id: shopId } },
          stage: Stage.BOOKED_IN,
          bikeMake: bikes.length === 1 ? bikes[0].make : "Multiple",
          bikeModel: bikes.length === 1 ? (bikes[0].model ?? "") : `${bikes.length} bikes`,
          customer: customerId ? { connect: { id: customerId, shopId } } : undefined,
          deliveryType: data.deliveryType as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
          dropOffDate: data.dropOffDate ? new Date(data.dropOffDate) : null,
          pickupDate: data.pickupDate ? new Date(data.pickupDate) : null,
          collectionAddress: data.collectionAddress ?? null,
          collectionWindowStart: data.collectionWindowStart ?? null,
          collectionWindowEnd: data.collectionWindowEnd ?? null,
          notes: data.notes ?? null,
          internalNotes: data.internalNotes ?? null,
          customerNotes: data.customerNotes ?? null,
        },
      });

      // For each bike without a bikeId, find or create a Bike record on the customer's profile.
      const resolvedBikes: Array<(typeof bikes)[number] & { bikeId: string | null }> = [];
      for (const b of bikes) {
        let bikeId: string | null = b.bikeId ?? null;
        if (!bikeId && customerId) {
          const trimmedModel = b.model?.trim() || null;
          const existing = await tx.bike.findFirst({
            where: {
              shopId,
              customerId,
              make: { equals: b.make.trim(), mode: "insensitive" },
              model: trimmedModel ? { equals: trimmedModel, mode: "insensitive" } : null,
            },
          });
          if (existing) {
            bikeId = existing.id;
          } else {
            const created = await tx.bike.create({
              data: {
                shopId,
                customerId,
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
        resolvedBikes.push({ ...b, bikeId });
      }

      await tx.jobBike.createMany({
        data: resolvedBikes.map((b, i) => ({
          shopId,
          jobId: newJob.id,
          make: b.make,
          model: b.model,
          nickname: b.nickname ?? null,
          imageUrl: b.imageUrl ?? null,
          bikeId: b.bikeId,
          bikeType: b.bikeType ?? null,
          sortOrder: i,
        })),
      });

      if (data.serviceIds && data.serviceIds.length > 0) {
        const services = await tx.service.findMany({
          where: { shopId, id: { in: data.serviceIds }, isSystem: false },
        });
        await tx.jobService.createMany({
          data: services.map((s) => ({
            shopId,
            jobId: newJob.id,
            serviceId: s.id,
            quantity: 1,
            unitPrice: s.price,
          })),
        });
      }

      if (features.collectionServiceEnabled) {
        await syncCollectionJobService(tx, newJob.id);
      }

      return tx.job.findUnique({
        where: { id: newJob.id, shopId },
        include: {
          customer: true,
          jobBikes: { include: { bike: true }, orderBy: { sortOrder: "asc" } },
          jobServices: { include: { service: true } },
          jobProducts: { include: { product: true } },
        },
      });
    });

    if (!job) {
      return NextResponse.json({ error: "Failed to create job" }, { status: 500 });
    }

    const templateSlug = getTemplateForStage("BOOKED_IN", job.deliveryType);
    const customerEmail = getEffectiveEmailUpdatesConsent(job.customer)
      ? job.customer?.email?.trim()
      : null;
    if (!customerEmail) {
      console.log("[Job created] No customer email – skipping booking confirmation");
    } else if (!templateSlug) {
      console.warn("[Job created] No template for BOOKED_IN – run `npx prisma db seed` to add templates");
    } else {
      const result = await sendJobEmail(templateSlug, customerEmail, job);
      if (!result.ok) {
        console.error("[Job created] Booking email failed:", result.error);
      }
    }

    const customerName = [job.customer?.firstName, job.customer?.lastName].filter(Boolean).join(" ") || "Walk-in";
    sendPushToAllStaff(shopId, {
      title: "New Job",
      body: `${customerName} — ${job.bikeMake} ${job.bikeModel}`.trim(),
      data: { type: "new_job", jobId: job.id },
    }).catch((e) => console.error("[Job created] Staff push failed:", e));

    return NextResponse.json(job);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const flattened = error.flatten();
      const fieldErrors = Object.entries(flattened.fieldErrors ?? {})
        .flatMap(([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean).map((m) => `${field}: ${m}`)
        );
      const formErrors = Array.isArray(flattened.formErrors) ? flattened.formErrors : [];
      const messages = [...formErrors, ...fieldErrors];
      const message = messages.length ? messages.join("; ") : "Invalid input";
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error("POST /api/jobs error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to create job";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
