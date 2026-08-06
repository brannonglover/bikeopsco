import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";
import { logRentalActivity } from "@/lib/rentals/activity";
import { rentalsDisabledResponse } from "@/lib/rentals/guard";
import { resolveRentalPrice } from "@/lib/rentals/pricing";
import {
  parseDateOnly,
  rentalDaysBetween,
  RENTAL_STATUSES,
  toNumber,
} from "@/lib/rentals/types";

const createSchema = z.object({
  customerId: z.string().optional().nullable(),
  customerName: z.string().min(1, "Customer name is required"),
  customerEmail: z.string().email().optional().nullable().or(z.literal("")),
  customerPhone: z.string().optional().nullable(),
  rentalBikeId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  status: z.enum(RENTAL_STATUSES).optional(),
  pickupTime: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  totalPrice: z.number().min(0).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const upcoming = searchParams.get("upcoming") === "1";

    const reservations = await prisma.rentalReservation.findMany({
      where: {
        shopId: shop.id,
        ...(status && RENTAL_STATUSES.includes(status as (typeof RENTAL_STATUSES)[number])
          ? { status: status as (typeof RENTAL_STATUSES)[number] }
          : {}),
        ...(upcoming
          ? {
              status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED", "ACTIVE"] },
              endDate: { gte: new Date(new Date().toISOString().slice(0, 10)) },
            }
          : {}),
      },
      include: {
        rentalBike: {
          select: { id: true, make: true, model: true, category: true },
        },
        customer: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: [{ startDate: "asc" }, { createdAt: "desc" }],
    });

    return NextResponse.json(reservations);
  } catch (error) {
    console.error("GET /api/rentals/reservations error:", error);
    return NextResponse.json({ error: "Failed to fetch reservations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const body = await request.json();
    const data = createSchema.parse(body);

    const startDate = parseDateOnly(data.startDate);
    const endDate = parseDateOnly(data.endDate);
    if (endDate < startDate) {
      return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 });
    }

    const bike = await prisma.rentalBike.findFirst({
      where: { id: data.rentalBikeId, shopId: shop.id, isActive: true },
    });
    if (!bike) {
      return NextResponse.json({ error: "Rental bike not found" }, { status: 404 });
    }

    const days = rentalDaysBetween(startDate, endDate);

    const rates = await prisma.rentalRate.findMany({
      where: { shopId: shop.id, isActive: true },
    });
    const priced = resolveRentalPrice(
      rates.map((r) => ({
        days: r.days,
        price: toNumber(r.price),
        category: r.category,
        isActive: r.isActive,
      })),
      days,
      bike.category
    );

    if (!priced && data.totalPrice == null) {
      return NextResponse.json(
        { error: "No rental rates configured. Add rates before creating a reservation." },
        { status: 400 }
      );
    }

    const unitPrice = priced?.unitPrice ?? (data.totalPrice ?? 0) / days;
    const totalPrice = data.totalPrice ?? priced!.totalPrice;
    const status = data.status ?? "CONFIRMED";

    const reservation = await prisma.rentalReservation.create({
      data: {
        shopId: shop.id,
        customerId: data.customerId || null,
        customerName: data.customerName.trim(),
        customerEmail: data.customerEmail?.trim() || null,
        customerPhone: data.customerPhone?.trim() || null,
        rentalBikeId: bike.id,
        startDate,
        endDate,
        days,
        unitPrice,
        totalPrice,
        status,
        pickupTime: data.pickupTime?.trim() || null,
        notes: data.notes?.trim() || null,
      },
      include: {
        rentalBike: {
          select: { id: true, make: true, model: true, category: true },
        },
      },
    });

    await logRentalActivity(
      shop.id,
      `${reservation.customerName} reservation ${status.toLowerCase()} — ${bike.make} ${bike.model}`
    );

    return NextResponse.json(reservation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    console.error("POST /api/rentals/reservations error:", error);
    return NextResponse.json({ error: "Failed to create reservation" }, { status: 500 });
  }
}
