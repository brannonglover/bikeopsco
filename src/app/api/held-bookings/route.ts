import { NextRequest, NextResponse } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { withPrismaRetry } from "@/lib/prisma-retry";
import type { SpamSignal } from "@/lib/booking-spam";

export const dynamic = "force-dynamic";

function safeServiceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

/** Stored as JSON, so it is re-checked rather than trusted on the way out. */
function safeSignals(value: unknown): SpamSignal[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is SpamSignal =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as SpamSignal).code === "string" &&
      typeof (item as SpamSignal).label === "string"
  );
}

/** Booking requests the spam scorer held back, newest first. */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;
    const shopId = auth.shopId;

    const entries = await withPrismaRetry(() =>
      prisma.waitlistEntry.findMany({
        where: { shopId, status: "HELD_FOR_REVIEW", archivedAt: null },
        orderBy: { createdAt: "desc" },
        include: { bikes: { orderBy: { sortOrder: "asc" } } },
      })
    );

    const uniqueIds = new Set<string>();
    for (const e of entries) {
      for (const id of safeServiceIds(e.serviceIds)) uniqueIds.add(id);
    }
    const serviceIdList = [...uniqueIds];
    const services =
      serviceIdList.length > 0
        ? await withPrismaRetry(() =>
            prisma.service.findMany({
              where: { shopId, id: { in: serviceIdList } },
              select: { id: true, name: true },
            })
          )
        : [];
    const serviceNameById = new Map(services.map((s) => [s.id, s.name]));

    return NextResponse.json(
      entries.map((e) => ({
        id: e.id,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        phone: e.phone,
        address: e.address,
        deliveryType: e.deliveryType,
        customerNotes: e.customerNotes,
        createdAt: e.createdAt.toISOString(),
        spamScore: e.spamScore,
        spamSignals: safeSignals(e.spamSignals),
        submittedIp: e.submittedIp,
        bikes: e.bikes.map((b) => ({
          id: b.id,
          make: b.make,
          model: b.model,
          bikeType: b.bikeType,
        })),
        serviceNames: safeServiceIds(e.serviceIds)
          .map((id) => serviceNameById.get(id))
          .filter((name): name is string => Boolean(name)),
      }))
    );
  } catch (error) {
    console.error("GET /api/held-bookings error:", error);
    return NextResponse.json(
      { error: "Failed to load held bookings" },
      { status: 500 }
    );
  }
}
