import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireCurrentShop } from "@/lib/shop";
import { rentalsDisabledResponse } from "@/lib/rentals/guard";
import { RENTAL_CATEGORIES, toNumber } from "@/lib/rentals/types";

function startOfUtcDay(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 86_400_000);
}

export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const today = startOfUtcDay();
    const in7 = addUtcDays(today, 7);
    const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));

    const [
      fleet,
      todayReservations,
      upcomingReservations,
      monthReservations,
      prevMonthReservations,
      activities,
      upcomingList,
    ] = await Promise.all([
      prisma.rentalBike.findMany({
        where: { shopId: shop.id, isActive: true },
        select: { id: true, category: true, quantity: true },
      }),
      prisma.rentalReservation.findMany({
        where: {
          shopId: shop.id,
          status: { in: ["ACTIVE", "CONFIRMED", "SCHEDULED"] },
          startDate: { lte: today },
          endDate: { gte: today },
        },
        select: { id: true, status: true },
      }),
      prisma.rentalReservation.count({
        where: {
          shopId: shop.id,
          status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED"] },
          startDate: { gte: today, lte: in7 },
        },
      }),
      prisma.rentalReservation.findMany({
        where: {
          shopId: shop.id,
          status: { not: "CANCELLED" },
          createdAt: { gte: monthStart },
        },
        select: { totalPrice: true },
      }),
      prisma.rentalReservation.findMany({
        where: {
          shopId: shop.id,
          status: { not: "CANCELLED" },
          createdAt: { gte: prevMonthStart, lt: monthStart },
        },
        select: { totalPrice: true },
      }),
      prisma.rentalActivity.findMany({
        where: { shopId: shop.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.rentalReservation.findMany({
        where: {
          shopId: shop.id,
          status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED", "ACTIVE"] },
          endDate: { gte: today },
        },
        include: {
          rentalBike: {
            select: { make: true, model: true },
          },
        },
        orderBy: [{ startDate: "asc" }, { createdAt: "desc" }],
        take: 5,
      }),
    ]);

    const totalBikes = fleet.reduce((sum, b) => sum + b.quantity, 0);

    // Count bikes currently out (ACTIVE overlapping today) — one reservation = one bike unit
    const outToday = await prisma.rentalReservation.count({
      where: {
        shopId: shop.id,
        status: "ACTIVE",
        startDate: { lte: today },
        endDate: { gte: today },
      },
    });
    const availableBikes = Math.max(0, totalBikes - outToday);

    const activeToday = todayReservations.filter((r) => r.status === "ACTIVE").length;
    const pickupToday = todayReservations.filter(
      (r) => r.status === "CONFIRMED" || r.status === "SCHEDULED"
    ).length;

    const monthRevenue = monthReservations.reduce((sum, r) => sum + toNumber(r.totalPrice), 0);
    const prevRevenue = prevMonthReservations.reduce((sum, r) => sum + toNumber(r.totalPrice), 0);
    const revenueChangePct =
      prevRevenue > 0
        ? Math.round(((monthRevenue - prevRevenue) / prevRevenue) * 100)
        : monthRevenue > 0
          ? 100
          : 0;

    // Availability by category — subtract ACTIVE rentals overlapping today per category
    const activeByBike = await prisma.rentalReservation.findMany({
      where: {
        shopId: shop.id,
        status: "ACTIVE",
        startDate: { lte: today },
        endDate: { gte: today },
      },
      select: { rentalBikeId: true },
    });
    const outByBikeId = new Map<string, number>();
    for (const r of activeByBike) {
      outByBikeId.set(r.rentalBikeId, (outByBikeId.get(r.rentalBikeId) ?? 0) + 1);
    }

    const fleetAvailability = RENTAL_CATEGORIES.filter((c) => c !== "OTHER" || fleet.some((b) => b.category === "OTHER")).map(
      (category) => {
        const bikes = fleet.filter((b) => b.category === category);
        const total = bikes.reduce((sum, b) => sum + b.quantity, 0);
        const out = bikes.reduce((sum, b) => sum + Math.min(b.quantity, outByBikeId.get(b.id) ?? 0), 0);
        return {
          category,
          available: Math.max(0, total - out),
          total,
        };
      }
    ).filter((c) => c.total > 0);

    return NextResponse.json({
      stats: {
        todayRentals: todayReservations.length,
        todayActive: activeToday,
        todayPickups: pickupToday,
        bikesAvailable: availableBikes,
        bikesTotal: totalBikes,
        upcomingCount: upcomingReservations,
        monthRevenue,
        revenueChangePct,
      },
      fleetAvailability,
      upcomingReservations: upcomingList,
      activities,
    });
  } catch (error) {
    console.error("GET /api/rentals/overview error:", error);
    return NextResponse.json({ error: "Failed to load rentals overview" }, { status: 500 });
  }
}
