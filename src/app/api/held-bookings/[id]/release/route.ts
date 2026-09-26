import { NextRequest, NextResponse } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { getAppFeatures } from "@/lib/app-settings";
import { createBookingJob } from "@/lib/create-booking-job";
import { sendBookingReceivedEmail } from "@/lib/email";
import { publishJobEvent } from "@/lib/realtime/publish-job-event";
import { getCustomerStatusUrl } from "@/lib/job-customer-access";
import { coerceCustomerPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

function safeServiceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * Release a held booking: it was a real customer, so give them the job they
 * would have got had the scorer not flagged them.
 *
 * It lands in PENDING_APPROVAL, the same place a clean booking lands, and the
 * customer gets the ordinary "booking received" email — the one that was
 * withheld when it was held. Staff are not emailed or pushed, since whoever
 * clicked release is already looking at it; the board picks it up over
 * realtime.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;
    const { shopId, shop } = auth;

    const { id } = await params;

    const entry = await prisma.waitlistEntry.findUnique({
      where: { id },
      include: { bikes: { orderBy: { sortOrder: "asc" } } },
    });

    if (!entry || entry.shopId !== shopId || entry.archivedAt) {
      return NextResponse.json({ error: "Held booking not found" }, { status: 404 });
    }
    if (entry.status !== "HELD_FOR_REVIEW") {
      return NextResponse.json(
        { error: "This booking has already been reviewed" },
        { status: 400 }
      );
    }

    const features = await getAppFeatures(shopId);

    const job = await prisma.$transaction(
      (tx) =>
        createBookingJob(tx, {
          shopId,
          firstName: entry.firstName,
          lastName: entry.lastName,
          email: entry.email,
          phone: coerceCustomerPhone(entry.phone),
          address: entry.address,
          // Consent is not carried over: the original submission's SMS opt-in
          // is not something to act on for a booking we thought was fake.
          smsConsent: false,
          deliveryType: entry.deliveryType,
          dropOffDate: entry.dropOffDate,
          pickupDate: entry.pickupDate,
          collectionAddress: entry.collectionAddress,
          collectionWindowStart: entry.collectionWindowStart,
          collectionWindowEnd: entry.collectionWindowEnd,
          customerNotes: entry.customerNotes,
          serviceIds: safeServiceIds(entry.serviceIds),
          bikes: entry.bikes.map((b) => ({
            make: b.make,
            model: b.model,
            bikeType: b.bikeType,
          })),
          collectionServiceEnabled: features.collectionServiceEnabled,
        }),
      { timeout: 15000 }
    );

    if (!job) {
      return NextResponse.json(
        { error: "Failed to create the booking" },
        { status: 500 }
      );
    }

    await prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: {
        status: "PROMOTED",
        promotedJobId: job.id,
        promotedAt: new Date(),
        reviewedAt: new Date(),
        customerId: job.customerId,
        archivedAt: new Date(),
      },
    });

    sendBookingReceivedEmail(job)
      .then((result) => {
        if (!result.ok) {
          console.error("[Booking review] Customer email failed:", result.error);
        }
      })
      .catch((e) => console.error("[Booking review] Customer email threw:", e));

    await publishJobEvent("job:created", { jobId: job.id, shopId });

    return NextResponse.json({
      id: job.id,
      statusUrl: getCustomerStatusUrl(job.id, shopId, shop.subdomain),
    });
  } catch (error) {
    console.error("POST /api/held-bookings/[id]/release error:", error);
    return NextResponse.json(
      { error: "Failed to release the booking" },
      { status: 500 }
    );
  }
}
