import { NextRequest, NextResponse } from "next/server";
import { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sendBookingRequestNotification, sendBookingReceivedEmail } from "@/lib/email";
import { sendPushToAllStaff } from "@/lib/push";
import { syncCollectionJobService } from "@/lib/collection-fee";
import { coerceCustomerPhone } from "@/lib/phone";

const bikeItemSchema = z.object({
  make: z.string().min(1, "Bike make is required"),
  model: z.string().min(1).optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional(),
});

const bookSchema = z
  .object({
    // Customer
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Valid email is required"),
    phone: z.string().min(1, "Phone is required"),
    smsConsent: z.literal(true, {
      message:
        "SMS consent is required to receive repair updates and service messages by text",
    }),
    address: z.string().optional().nullable(),
    // Bikes — new array format (preferred)
    bikes: z.array(bikeItemSchema).min(1, "At least one bike is required").optional(),
    // Legacy single-bike fields (kept for backward compatibility)
    bikeMake: z.string().optional(),
    bikeModel: z.string().optional(),
    bikeType: z.enum(["REGULAR", "E_BIKE"]).optional(),
    // Job
    deliveryType: z.enum(["DROP_OFF_AT_SHOP", "COLLECTION_SERVICE"]).default("DROP_OFF_AT_SHOP"),
    dropOffDate: z.string().optional().nullable(),
    pickupDate: z.string().optional().nullable(),
    collectionAddress: z.string().optional().nullable(),
    collectionWindowStart: z.string().optional().nullable(),
    collectionWindowEnd: z.string().optional().nullable(),
    customerNotes: z.string().optional().nullable(),
    serviceIds: z.array(z.string()).optional().default([]),
  })
  .superRefine((data, ctx) => {
    const hasBikesArray = data.bikes && data.bikes.length > 0;
    const hasLegacyBike = data.bikeMake && data.bikeModel;
    if (!hasBikesArray && !hasLegacyBike) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one bike is required",
        path: ["bikes"],
      });
    }
  });

function addCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  const allowed =
    origin &&
    (origin.endsWith("basementbikemechanic.com") ||
      origin.endsWith(".basementbikemechanic.com") ||
      origin.includes("localhost"));
  if (allowed && origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  return response;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = NextResponse.json({}, { status: 204 });
  return addCorsHeaders(res, origin);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const res = NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
      return addCorsHeaders(res, origin);
    }

    const data = bookSchema.parse(body);

    // Normalize to a bikes array (support both new array format and legacy single-bike fields)
    const bikesInput =
      data.bikes && data.bikes.length > 0
        ? data.bikes
        : [{ make: data.bikeMake!.trim(), model: data.bikeModel!.trim(), bikeType: data.bikeType }];

    const emailNormalized = data.email.trim().toLowerCase();
    const phoneStored = coerceCustomerPhone(data.phone);

    const job = await prisma.$transaction(async (tx) => {
      let customer = await tx.customer.findFirst({
        where: {
          email: { equals: emailNormalized, mode: "insensitive" },
        },
      });

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            firstName: data.firstName,
            lastName: data.lastName ?? null,
            email: data.email.trim(),
            phone: phoneStored,
            address: data.address ?? null,
          },
        });
      } else {
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            firstName: data.firstName,
            lastName: data.lastName ?? null,
            phone: phoneStored,
            address: data.address ?? customer.address,
          },
        });
      }

      // Build summary fields for the job (first bike's make/model, or "Multiple" for many)
      const bikeMakeSummary =
        bikesInput.length === 1 ? bikesInput[0].make.trim() : "Multiple";
      const bikeModelSummary =
        bikesInput.length === 1 ? (bikesInput[0].model?.trim() ?? "") : `${bikesInput.length} bikes`;

      const newJob = await tx.job.create({
        data: {
          stage: Stage.PENDING_APPROVAL,
          bikeMake: bikeMakeSummary,
          bikeModel: bikeModelSummary,
          customerId: customer.id,
          deliveryType: data.deliveryType as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
          dropOffDate: data.dropOffDate ? new Date(data.dropOffDate) : null,
          pickupDate: data.pickupDate ? new Date(data.pickupDate) : null,
          collectionAddress: data.collectionAddress ?? null,
          collectionWindowStart: data.collectionWindowStart ?? null,
          collectionWindowEnd: data.collectionWindowEnd ?? null,
          customerNotes: data.customerNotes ?? null,
        },
      });

      // For each submitted bike: find-or-create a customer Bike record, then create a JobBike
      for (let i = 0; i < bikesInput.length; i++) {
        const b = bikesInput[i];
        const makeNormalized = b.make.trim();
        const modelNormalized = b.model?.trim() || null;

        let bike = await tx.bike.findFirst({
          where: {
            customerId: customer.id,
            make: { equals: makeNormalized, mode: "insensitive" },
            model: modelNormalized ? { equals: modelNormalized, mode: "insensitive" } : null,
          },
        });
        if (!bike) {
          bike = await tx.bike.create({
            data: {
              customerId: customer.id,
              make: makeNormalized,
              model: modelNormalized,
              bikeType: b.bikeType ?? null,
            },
          });
        }

        await tx.jobBike.create({
          data: {
            jobId: newJob.id,
            make: makeNormalized,
            model: modelNormalized,
            sortOrder: i,
            bikeType: b.bikeType ?? null,
            bikeId: bike.id,
          },
        });
      }

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

      await syncCollectionJobService(tx, newJob.id);

      return tx.job.findUnique({
        where: { id: newJob.id },
        include: {
          customer: true,
          jobBikes: { orderBy: { sortOrder: "asc" } },
          jobServices: { include: { service: true } },
        },
      });
    });

    if (!job) {
      const res = NextResponse.json(
        { error: "Failed to create booking" },
        { status: 500 }
      );
      return addCorsHeaders(res, origin);
    }

    // Notify shop owner of new booking request (email + push)
    sendBookingRequestNotification(job).then((result) => {
      if (!result.ok) console.error("[Widget book] Staff email failed:", result.error);
    }).catch((e) => console.error("[Widget book] Staff email threw:", e));

    sendPushToAllStaff({
      title: "New Booking Request",
      body: `${job.customer?.firstName ?? "Unknown"} ${job.customer?.lastName ?? ""} — ${job.bikeMake} ${job.bikeModel}`.trim(),
      data: { type: "booking_request", jobId: job.id },
    }).catch((e) => console.error("[Widget book] Staff push failed:", e));

    // Send booking received confirmation to customer
    sendBookingReceivedEmail(job).then((result) => {
      if (!result.ok) console.error("[Widget book] Customer email failed:", result.error);
    }).catch((e) => console.error("[Widget book] Customer email threw:", e));

    const res = NextResponse.json({
      id: job.id,
      statusUrl: `${process.env.NEXT_PUBLIC_APP_URL || ""}/status/${job.id}`,
    });
    return addCorsHeaders(res, origin);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const flattened = error.flatten();
      const fieldErrors = Object.entries(flattened.fieldErrors ?? {})
        .flatMap(([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs])
            .filter(Boolean)
            .map((m) => `${field}: ${m}`)
        );
      const message = fieldErrors.length ? fieldErrors.join("; ") : "Invalid input";
      const res = NextResponse.json({ error: message }, { status: 400 });
      return addCorsHeaders(res, origin);
    }
    console.error("POST /api/widget/book error:", error);
    const res = NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
    return addCorsHeaders(res, origin);
  }
}
