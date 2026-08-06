import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";
import { rentalsDisabledResponse } from "@/lib/rentals/guard";
import { RENTAL_CATEGORIES } from "@/lib/rentals/types";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  days: z.number().int().min(1).optional(),
  price: z.number().min(0).optional(),
  category: z.enum(RENTAL_CATEGORIES).optional().nullable(),
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

    const existing = await prisma.rentalRate.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rate = await prisma.rentalRate.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.days !== undefined && { days: data.days }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    return NextResponse.json(rate);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    console.error("PATCH /api/rentals/rates/[id] error:", error);
    return NextResponse.json({ error: "Failed to update rental rate" }, { status: 500 });
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

    const existing = await prisma.rentalRate.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.rentalRate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/rentals/rates/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete rental rate" }, { status: 500 });
  }
}
