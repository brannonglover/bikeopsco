import { NextRequest, NextResponse } from "next/server";
import { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sendJobEmail, getTemplateForStage } from "@/lib/email";

const createJobSchema = z.object({
  bikeMake: z.string().min(1),
  bikeModel: z.string().min(1),
  customerId: z.string().optional().nullable(),
  deliveryType: z.enum(["DROP_OFF_AT_SHOP", "COLLECTION_SERVICE"]).default("DROP_OFF_AT_SHOP"),
  dropOffDate: z.string().optional().nullable(),
  pickupDate: z.string().optional().nullable(),
  collectionAddress: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  internalNotes: z.string().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
  serviceIds: z.array(z.string()).optional().default([]),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const weekStart = searchParams.get("weekStart");
    const weekEnd = searchParams.get("weekEnd");

    const where: Record<string, unknown> = {};

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

    const jobs = await prisma.job.findMany({
      where,
      include: {
        customer: true,
        jobServices: {
          include: { service: true },
        },
        jobProducts: { include: { product: true } },
      },
      orderBy: { createdAt: "desc" },
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
  try {
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

    const job = await prisma.$transaction(async (tx) => {
      const newJob = await tx.job.create({
        data: {
          stage: Stage.BOOKED_IN,
          bikeMake: data.bikeMake,
          bikeModel: data.bikeModel,
          customerId: data.customerId,
          deliveryType: data.deliveryType as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
          dropOffDate: data.dropOffDate ? new Date(data.dropOffDate) : null,
          pickupDate: data.pickupDate ? new Date(data.pickupDate) : null,
          collectionAddress: data.collectionAddress ?? null,
          notes: data.notes ?? null,
          internalNotes: data.internalNotes ?? null,
          customerNotes: data.customerNotes ?? null,
        },
      });

      if (data.serviceIds && data.serviceIds.length > 0) {
        const services = await tx.service.findMany({
          where: { id: { in: data.serviceIds } },
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

      return tx.job.findUnique({
        where: { id: newJob.id },
        include: {
          customer: true,
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
