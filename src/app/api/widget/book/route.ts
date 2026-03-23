import { NextRequest, NextResponse } from "next/server";
import { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { sendJobEmail, getTemplateForStage } from "@/lib/email";

const bookSchema = z.object({
  // Customer
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  phone: z.string().min(1, "Phone is required"),
  address: z.string().optional().nullable(),
  // Bike
  bikeMake: z.string().min(1, "Bike make is required"),
  bikeModel: z.string().min(1, "Bike model is required"),
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

    const job = await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName ?? null,
          email: data.email,
          phone: data.phone ?? null,
          address: data.address ?? null,
        },
      });

      const newJob = await tx.job.create({
        data: {
          stage: Stage.BOOKED_IN,
          bikeMake: data.bikeMake,
          bikeModel: data.bikeModel,
          customerId: customer.id,
          deliveryType: data.deliveryType as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
          dropOffDate: data.dropOffDate ? new Date(data.dropOffDate) : null,
          pickupDate: data.pickupDate ? new Date(data.pickupDate) : null,
          collectionAddress: data.collectionAddress ?? null,
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

    const templateSlug = getTemplateForStage("BOOKED_IN", job.deliveryType);
    const customerEmail = job.customer?.email?.trim();
    if (customerEmail && templateSlug) {
      sendJobEmail(templateSlug, customerEmail, job).catch(console.error);
    }

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
