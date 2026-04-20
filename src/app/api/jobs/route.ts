import { NextRequest, NextResponse } from "next/server";
import { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { getToken } from "next-auth/jwt";
import { sendJobEmail, getTemplateForStage } from "@/lib/email";
import { syncCollectionJobService } from "@/lib/collection-fee";
import { sendPushToAllStaff } from "@/lib/push";
import { getAppFeatures } from "@/lib/app-settings";

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

export async function GET(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) {
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

    const where: Record<string, unknown> = {};

    if (archived) {
      where.archivedAt = { not: null };
    } else {
      where.archivedAt = null;
    }

    if (customerIdFilter) {
      where.customerId = customerIdFilter;
    }

    if (weekStart && weekEnd) {
      const start = new Date(weekStart);
      const end = new Date(weekEnd);
      where.OR = [
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
      ];
    }
    // No week filter: returns all jobs so the board shows everything in one view

    const orderBy = archived
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
      return NextResponse.json(jobs);
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
          customer: customerIdFilter
            ? { select: { id: true, firstName: true, lastName: true, email: true, phone: true, address: true, notes: true, createdAt: true, updatedAt: true } }
            : { select: { id: true, firstName: true, lastName: true, email: true, phone: true, address: true, notes: true, createdAt: true, updatedAt: true } },
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
            },
          },
        },
        orderBy,
      });
      return NextResponse.json(jobs);
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
      },
      orderBy,
    });

    return NextResponse.json(jobs);
  } catch (error) {
    console.error("GET /api/jobs error:", error);
    return NextResponse.json(
      { error: "Failed to fetch jobs" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) {
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

    const job = await prisma.$transaction(async (tx) => {
      const newJob = await tx.job.create({
        data: {
          stage: Stage.BOOKED_IN,
          bikeMake: bikes.length === 1 ? bikes[0].make : "Multiple",
          bikeModel: bikes.length === 1 ? (bikes[0].model ?? "") : `${bikes.length} bikes`,
          customerId: data.customerId,
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
        if (!bikeId && data.customerId) {
          const trimmedModel = b.model?.trim() || null;
          const existing = await tx.bike.findFirst({
            where: {
              customerId: data.customerId,
              make: { equals: b.make.trim(), mode: "insensitive" },
              model: trimmedModel ? { equals: trimmedModel, mode: "insensitive" } : null,
            },
          });
          if (existing) {
            bikeId = existing.id;
          } else {
            const created = await tx.bike.create({
              data: {
                customerId: data.customerId,
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
          where: { id: { in: data.serviceIds }, isSystem: false },
        });
        await tx.jobService.createMany({
          data: services.map((s) => ({
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
        where: { id: newJob.id },
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
    const customerEmail = job.customer?.email?.trim();
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
    sendPushToAllStaff({
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
