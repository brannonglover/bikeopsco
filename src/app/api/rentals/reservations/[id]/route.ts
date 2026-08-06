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

const updateSchema = z.object({
  customerId: z.string().optional().nullable(),
  customerName: z.string().min(1).optional(),
  customerEmail: z.string().email().optional().nullable().or(z.literal("")),
  customerPhone: z.string().optional().nullable(),
  rentalBikeId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(RENTAL_STATUSES).optional(),
  pickupTime: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  totalPrice: z.number().min(0).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const { id } = await params;
    const body = await request.json();
    const data = updateSchema.parse(body);

    const existing = await prisma.rentalReservation.findFirst({
      where: { id, shopId: shop.id },
      include: { rentalBike: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let rentalBikeId = existing.rentalBikeId;
    let bike = existing.rentalBike;
    if (data.rentalBikeId && data.rentalBikeId !== existing.rentalBikeId) {
      const nextBike = await prisma.rentalBike.findFirst({
        where: { id: data.rentalBikeId, shopId: shop.id },
      });
      if (!nextBike) {
        return NextResponse.json({ error: "Rental bike not found" }, { status: 404 });
      }
      rentalBikeId = nextBike.id;
      bike = nextBike;
    }

    const startDate = data.startDate ? parseDateOnly(data.startDate) : existing.startDate;
    const endDate = data.endDate ? parseDateOnly(data.endDate) : existing.endDate;
    if (endDate < startDate) {
      return NextResponse.json({ error: "End date must be on or after start date" }, { status: 400 });
    }

    const days = rentalDaysBetween(startDate, endDate);
    let unitPrice = toNumber(existing.unitPrice);
    let totalPrice = data.totalPrice ?? toNumber(existing.totalPrice);

    if (data.startDate || data.endDate || data.rentalBikeId || data.totalPrice == null) {
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
      if (priced && data.totalPrice == null) {
        unitPrice = priced.unitPrice;
        totalPrice = priced.totalPrice;
      } else if (data.totalPrice != null) {
        totalPrice = data.totalPrice;
        unitPrice = days > 0 ? totalPrice / days : totalPrice;
      }
    }

    const status = data.status ?? existing.status;
    const checkedOutAt =
      status === "ACTIVE" && !existing.checkedOutAt
        ? new Date()
        : status !== "ACTIVE" && existing.status === "ACTIVE" && status === "COMPLETED"
          ? existing.checkedOutAt
          : existing.checkedOutAt;
    const checkedInAt =
      status === "COMPLETED" && !existing.checkedInAt ? new Date() : existing.checkedInAt;

    const reservation = await prisma.rentalReservation.update({
      where: { id },
      data: {
        ...(data.customerId !== undefined && { customerId: data.customerId || null }),
        ...(data.customerName !== undefined && { customerName: data.customerName.trim() }),
        ...(data.customerEmail !== undefined && {
          customerEmail: data.customerEmail?.trim() || null,
        }),
        ...(data.customerPhone !== undefined && {
          customerPhone: data.customerPhone?.trim() || null,
        }),
        rentalBikeId,
        startDate,
        endDate,
        days,
        unitPrice,
        totalPrice,
        status,
        ...(data.pickupTime !== undefined && { pickupTime: data.pickupTime?.trim() || null }),
        ...(data.notes !== undefined && { notes: data.notes?.trim() || null }),
        checkedOutAt,
        checkedInAt,
      },
      include: {
        rentalBike: {
          select: { id: true, make: true, model: true, category: true },
        },
      },
    });

    if (data.status && data.status !== existing.status) {
      const bikeLabel = `${reservation.rentalBike.make} ${reservation.rentalBike.model}`;
      if (data.status === "ACTIVE") {
        await logRentalActivity(
          shop.id,
          `${reservation.customerName} picked up ${bikeLabel}`
        );
      } else if (data.status === "COMPLETED") {
        await logRentalActivity(
          shop.id,
          `${reservation.customerName} returned ${bikeLabel}`
        );
      } else if (data.status === "CONFIRMED") {
        await logRentalActivity(
          shop.id,
          `${reservation.customerName} reservation confirmed`
        );
      } else if (data.status === "CANCELLED") {
        await logRentalActivity(
          shop.id,
          `${reservation.customerName} reservation cancelled — ${bikeLabel}`
        );
      }
    }

    return NextResponse.json(reservation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    console.error("PATCH /api/rentals/reservations/[id] error:", error);
    return NextResponse.json({ error: "Failed to update reservation" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const { id } = await params;

    const existing = await prisma.rentalReservation.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.rentalReservation.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/rentals/reservations/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete reservation" }, { status: 500 });
  }
}
