import { NextRequest, NextResponse } from "next/server";
import { Stage } from "@prisma/client";
import { prisma } from "@/lib/db";
import { z } from "zod";
import {
  sendBookingRequestNotification,
  sendBookingReceivedEmail,
  sendWaitlistReceivedEmail,
  sendWaitlistRequestNotification,
} from "@/lib/email";
import { sendPushToAllStaff } from "@/lib/push";
import { syncCollectionJobService } from "@/lib/collection-fee";
import { coerceCustomerPhone } from "@/lib/phone";
import { checkCollectionEligibility } from "@/lib/collection-radius";
import { getAppFeatures } from "@/lib/app-settings";
import { addWidgetCorsHeaders } from "@/lib/widget-cors";
import { buildSmsConsentUpdate } from "@/lib/sms-consent";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

type WaitlistTxnResult = {
  entry: {
    id: string;
    email: string;
    phone: string;
    deliveryType: string;
    customerNotes: string | null;
    bikes: { make: string; model: string | null }[];
  };
  customer: {
    firstName: string;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
};

const bikeItemSchema = z.object({
  make: z.string().min(1, "Bike make is required"),
  model: z.string().min(1).optional().nullable(),
  bikeType: z.enum(["REGULAR", "E_BIKE"]).optional(),
});

const bookSchema = z
  .object({
    // Customer
    customerId: z.string().optional().nullable(),
    firstName: z.string().min(1, "First name is required"),
    lastName: z.string().min(1, "Last name is required"),
    email: z.string().email("Valid email is required"),
    phone: z.string().min(1, "Phone is required"),
    smsConsent: z.boolean().optional().default(false),
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

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = new NextResponse(null, { status: 204 });
  return addWidgetCorsHeaders(res, origin, {
    methods: "POST, OPTIONS",
    allowHeaders: "Content-Type, Authorization",
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const hostHeader =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const shop = await getShopForHost(hostHeader);
    if (!shop) {
      const res = NextResponse.json({ error: "Shop not found" }, { status: 404 });
      return addWidgetCorsHeaders(res, origin, {
        methods: "POST, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const res = NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
      return addWidgetCorsHeaders(res, origin, {
        methods: "POST, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }

    const data = bookSchema.parse(body);
    const features = await getAppFeatures(shop.id);

    if (data.deliveryType === "COLLECTION_SERVICE") {
      if (!features.collectionServiceEnabled) {
        const res = NextResponse.json(
          { error: "Collection service is currently unavailable." },
          { status: 400 }
        );
        return addWidgetCorsHeaders(res, origin, {
          methods: "POST, OPTIONS",
          allowHeaders: "Content-Type, Authorization",
        });
      }
      const addr = (data.collectionAddress ?? "").trim();
      const eligibility = await checkCollectionEligibility(addr, features.collectionRadiusMiles);
      if (eligibility.ok && eligibility.enabled && !eligibility.eligible) {
        const res = NextResponse.json(
          { error: `Collection is only available within ${eligibility.radiusMiles} miles of the shop.` },
          { status: 400 }
        );
        return addWidgetCorsHeaders(res, origin, {
          methods: "POST, OPTIONS",
          allowHeaders: "Content-Type, Authorization",
        });
      }
      if (!eligibility.ok && eligibility.enabled) {
        const res = NextResponse.json(
          { error: eligibility.error },
          { status: 400 }
        );
        return addWidgetCorsHeaders(res, origin, {
          methods: "POST, OPTIONS",
          allowHeaders: "Content-Type, Authorization",
        });
      }
    }

    // Normalize to a bikes array (support both new array format and legacy single-bike fields)
    const bikesInput =
      data.bikes && data.bikes.length > 0
        ? data.bikes
        : [{ make: data.bikeMake!.trim(), model: data.bikeModel!.trim(), bikeType: data.bikeType }];

    const emailNormalized = data.email.trim().toLowerCase();
    const phoneStored = coerceCustomerPhone(data.phone);

    const maxActiveBikes = features.maxActiveBikes ?? 5;
    const bookingsEnabled = features.bookingsEnabled ?? true;
    const incomingBikesCount = bikesInput.length;
    const activeBikesCount =
      maxActiveBikes > 0
        ? await prisma.jobBike.count({
            where: {
              shopId: shop.id,
              job: {
                archivedAt: null,
                stage: { in: [Stage.RECEIVED, Stage.WORKING_ON] },
              },
            },
          })
        : 0;

    const shouldWaitlist =
      !bookingsEnabled ||
      (maxActiveBikes > 0 && activeBikesCount + incomingBikesCount > maxActiveBikes);

    if (shouldWaitlist) {
      let waitlist: WaitlistTxnResult;
      try {
        waitlist = await prisma.$transaction(async (tx) => {
          let customer = null;

          if (data.customerId) {
            customer = await tx.customer.findFirst({
              where: { id: data.customerId, shopId: shop.id },
            });
          }

          if (!customer) {
            customer = await tx.customer.findFirst({
              where: {
                shopId: shop.id,
                email: { equals: emailNormalized, mode: "insensitive" },
              },
            });
          }

          if (!customer) {
            customer = await tx.customer.create({
              data: {
                shopId: shop.id,
                firstName: data.firstName,
                lastName: data.lastName ?? null,
                email: data.email.trim(),
                phone: phoneStored,
                ...buildSmsConsentUpdate(Boolean(data.smsConsent), "BOOKING_FORM"),
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
                ...(data.smsConsent
                  ? buildSmsConsentUpdate(true, "BOOKING_FORM")
                  : {}),
                address: data.address ?? customer.address,
              },
            });
          }

          const entry = await tx.waitlistEntry.create({
            data: {
              shopId: shop.id,
              customerId: customer.id,
              firstName: data.firstName,
              lastName: data.lastName,
              email: data.email.trim(),
              phone: phoneStored ?? data.phone.trim(),
              address: data.address ?? null,
              deliveryType: data.deliveryType as "DROP_OFF_AT_SHOP" | "COLLECTION_SERVICE",
              dropOffDate: data.dropOffDate ? new Date(data.dropOffDate) : null,
              pickupDate: data.pickupDate ? new Date(data.pickupDate) : null,
              collectionAddress: data.collectionAddress ?? null,
              collectionWindowStart: data.collectionWindowStart ?? null,
              collectionWindowEnd: data.collectionWindowEnd ?? null,
              customerNotes: data.customerNotes ?? null,
              serviceIds: data.serviceIds ?? [],
              bikes: {
                create: bikesInput.map((b, i) => ({
                  shopId: shop.id,
                  make: b.make.trim(),
                  model: b.model?.trim() || null,
                  bikeType: b.bikeType ?? null,
                  sortOrder: i,
                })),
              },
            },
            include: { bikes: { orderBy: { sortOrder: "asc" } } },
          });

          return { entry, customer };
        });
      } catch (e) {
        console.error("[Widget book] Failed to create waitlist entry:", e);
        const res = NextResponse.json(
          {
            error:
              "We’re currently at capacity and can’t accept new bookings right now. Please try again in a few minutes.",
          },
          { status: 503 }
        );
        return addWidgetCorsHeaders(res, origin, {
          methods: "POST, OPTIONS",
          allowHeaders: "Content-Type, Authorization",
        });
      }

      const services =
        data.serviceIds && data.serviceIds.length > 0
          ? await prisma.service.findMany({
              where: { shopId: shop.id, id: { in: data.serviceIds }, isSystem: false },
              select: { name: true },
            })
          : [];
      const servicesList = services.map((s) => s.name).join(", ") || "None specified";
      const bikeSummary =
        waitlist.entry.bikes.length === 1
          ? `${waitlist.entry.bikes[0].make}${waitlist.entry.bikes[0].model ? ` ${waitlist.entry.bikes[0].model}` : ""}`
          : `${waitlist.entry.bikes.length} bikes`;

      const customerName = waitlist.customer.lastName
        ? `${waitlist.customer.firstName} ${waitlist.customer.lastName}`
        : waitlist.customer.firstName;

      sendWaitlistRequestNotification({
        id: waitlist.entry.id,
        customerName,
        email: waitlist.customer.email ?? waitlist.entry.email,
        phone: waitlist.customer.phone ?? waitlist.entry.phone,
        bikeSummary,
        deliveryType: waitlist.entry.deliveryType,
        customerNotes: waitlist.entry.customerNotes ?? null,
        servicesList,
      })
        .then((result) => {
          if (!result.ok) console.error("[Widget book] Waitlist staff email failed:", result.error);
        })
        .catch((e) => console.error("[Widget book] Waitlist staff email threw:", e));

      sendPushToAllStaff(shop.id, {
        title: "New Waitlist Request",
        body: `${customerName} — ${bikeSummary}`,
        data: { type: "waitlist_request", waitlistId: waitlist.entry.id },
      }).catch((e) => console.error("[Widget book] Waitlist staff push failed:", e));

      sendWaitlistReceivedEmail({
        customerName,
        recipient: waitlist.entry.email,
      })
        .then((result) => {
          if (!result.ok) console.error("[Widget book] Waitlist customer email failed:", result.error);
        })
        .catch((e) => console.error("[Widget book] Waitlist customer email threw:", e));

      const message =
        maxActiveBikes > 0
          ? `We’re currently at capacity (${activeBikesCount}/${maxActiveBikes} bikes). You’ve been added to the waitlist and we’ll reach out as soon as a spot opens up.`
          : "We’re currently not accepting new bookings. You’ve been added to the waitlist and we’ll reach out as soon as a spot opens up.";

      const res = NextResponse.json({
        status: "WAITLISTED",
        waitlistId: waitlist.entry.id,
        message,
      });
      return addWidgetCorsHeaders(res, origin, {
        methods: "POST, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }

    const job = await prisma.$transaction(async (tx) => {
      let customer = null;

      if (data.customerId) {
        customer = await tx.customer.findFirst({
          where: { id: data.customerId, shopId: shop.id },
        });
      }

      if (!customer) {
        customer = await tx.customer.findFirst({
          where: {
            shopId: shop.id,
            email: { equals: emailNormalized, mode: "insensitive" },
          },
        });
      }

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            shopId: shop.id,
            firstName: data.firstName,
            lastName: data.lastName ?? null,
            email: data.email.trim(),
            phone: phoneStored,
            ...buildSmsConsentUpdate(Boolean(data.smsConsent), "BOOKING_FORM"),
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
            ...(data.smsConsent
              ? buildSmsConsentUpdate(true, "BOOKING_FORM")
              : {}),
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
          shopId: shop.id,
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
            shopId: shop.id,
            customerId: customer.id,
            make: { equals: makeNormalized, mode: "insensitive" },
            model: modelNormalized ? { equals: modelNormalized, mode: "insensitive" } : null,
          },
        });
        if (!bike) {
          bike = await tx.bike.create({
            data: {
              shopId: shop.id,
              customerId: customer.id,
              make: makeNormalized,
              model: modelNormalized,
              bikeType: b.bikeType ?? null,
            },
          });
        }

        await tx.jobBike.create({
          data: {
            shopId: shop.id,
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
          where: { shopId: shop.id, id: { in: data.serviceIds }, isSystem: false },
        });
        await tx.jobService.createMany({
          data: services.map((s) => ({
            shopId: shop.id,
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
      return addWidgetCorsHeaders(res, origin, {
        methods: "POST, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }

    // Notify shop owner of new booking request (email + push)
    sendBookingRequestNotification(job).then((result) => {
      if (!result.ok) console.error("[Widget book] Staff email failed:", result.error);
    }).catch((e) => console.error("[Widget book] Staff email threw:", e));

    sendPushToAllStaff(job.shopId, {
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
    return addWidgetCorsHeaders(res, origin, {
      methods: "POST, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
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
      return addWidgetCorsHeaders(res, origin, {
        methods: "POST, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }
    console.error("POST /api/widget/book error:", error);
    const res = NextResponse.json(
      { error: "Failed to create booking" },
      { status: 500 }
    );
    return addWidgetCorsHeaders(res, origin, {
      methods: "POST, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  }
}
