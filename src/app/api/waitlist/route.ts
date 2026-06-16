import { NextRequest, NextResponse } from "next/server";
import { requireStaffShop } from "@/lib/api-auth";
import { prisma } from "@/lib/db";
import { withPrismaRetry } from "@/lib/prisma-retry";

export const dynamic = "force-dynamic";

function safeServiceIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireStaffShop(request);
    if (!auth.ok) return auth.response;
    const shopId = auth.shopId;

    const entries = await withPrismaRetry(() =>
      prisma.waitlistEntry.findMany({
        where: { shopId, status: "WAITING", archivedAt: null },
        orderBy: { createdAt: "asc" },
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
              where: { id: { in: serviceIdList } },
              select: { id: true, name: true },
            })
          )
        : [];
    const serviceNameById = new Map(services.map((s) => [s.id, s.name]));

    return NextResponse.json(
      entries.map((e) => ({
        id: e.id,
        status: e.status,
        firstName: e.firstName,
        lastName: e.lastName,
        email: e.email,
        phone: e.phone,
        address: e.address,
        deliveryType: e.deliveryType,
        customerNotes: e.customerNotes,
        createdAt: e.createdAt.toISOString(),
        bikes: e.bikes.map((b) => ({
          id: b.id,
          make: b.make,
          model: b.model,
          bikeType: b.bikeType,
        })),
        serviceIds: safeServiceIds(e.serviceIds),
        serviceNames: safeServiceIds(e.serviceIds)
          .map((id) => serviceNameById.get(id))
          .filter((name): name is string => Boolean(name)),
      }))
    );
  } catch (error) {
    console.error("GET /api/waitlist error:", error);
    return NextResponse.json({ error: "Failed to fetch waitlist" }, { status: 500 });
  }
}
