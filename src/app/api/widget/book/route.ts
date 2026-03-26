import { NextRequest, NextResponse } from "next/server";
import { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sendBookingRequestNotification } from "@/lib/email";
import { syncCollectionJobService } from "@/lib/collection-fee";
import { coerceCustomerPhone } from "@/lib/phone";

const bookSchema = z.object({
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
  // Bike
  bikeMake: z.string().min(1, "Bike make is required"),
  bikeModel: z.string().min(1, "Bike model is required"),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional(),
  // Job
  deliveryType: z.enum(["DROP_OFF_AT_SHOP", "COLLECTION_SERVICE"]).default("DROP_OFF_AT_SHOP"),
  dropOffDate: z.string().optional().nullable(),
  pickupDate: z.string().optional().nullable(),
  collectionAddress: z.string().optional().nullable(),
  customerNotes: z.string().optional().nullable(),
  serviceIds: z.array(z.string()).optional().default([]),
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

      const newJob = await tx.job.create({
        data: {
          stage: Stage.PENDING_APPROVAL,
          bikeMake: data.bikeMake.trim(),
          bikeModel: data.bikeModel.trim(),
          customerId: customer.id,
          deliveryType: data.deliveryType as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
          dropOffDate: data.dropOffDate ? new Date(data.dropOffDate) : null,
          pickupDate: data.pickupDate ? new Date(data.pickupDate) : null,
          collectionAddress: data.collectionAddress ?? null,
          customerNotes: data.customerNotes ?? null,
        },
      });

      await tx.jobBike.create({
        data: {
          jobId: newJob.id,
          make: data.bikeMake.trim(),
          model: data.bikeModel.trim(),
          sortOrder: 0,
          bikeType: data.bikeType ?? null,
        },
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

    // Notify shop owner of new booking request
    sendBookingRequestNotification(job).catch((e) =>
      console.error("[Widget book] Staff notification failed:", e)
    );

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
