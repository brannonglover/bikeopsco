import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";
import { rentalsDisabledResponse } from "@/lib/rentals/guard";
import { RENTAL_CATEGORIES } from "@/lib/rentals/types";

const updateSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  category: z.enum(RENTAL_CATEGORIES).optional(),
  size: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  quantity: z.number().int().min(1).optional(),
  isActive: z.boolean().optional(),
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

    const existing = await prisma.rentalBike.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const bike = await prisma.rentalBike.update({
      where: { id },
      data: {
        ...(data.make !== undefined && { make: data.make.trim() }),
        ...(data.model !== undefined && { model: data.model.trim() }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.size !== undefined && { size: data.size?.trim() || null }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
        ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl?.trim() || null }),
        ...(data.quantity !== undefined && { quantity: data.quantity }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    return NextResponse.json(bike);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    console.error("PATCH /api/rentals/fleet/[id] error:", error);
    return NextResponse.json({ error: "Failed to update rental bike" }, { status: 500 });
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

    const existing = await prisma.rentalBike.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const activeReservations = await prisma.rentalReservation.count({
      where: {
        rentalBikeId: id,
        status: { in: ["REQUESTED", "SCHEDULED", "CONFIRMED", "ACTIVE"] },
      },
    });
    if (activeReservations > 0) {
      return NextResponse.json(
        { error: "Cannot delete a bike with active or upcoming reservations. Deactivate it instead." },
        { status: 400 }
      );
    }

    await prisma.rentalBike.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/rentals/fleet/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete rental bike" }, { status: 500 });
  }
}
