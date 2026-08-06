import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";
import { rentalsDisabledResponse } from "@/lib/rentals/guard";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  price: z.number().min(0).optional(),
  stockQuantity: z.number().int().min(0).optional(),
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

    const existing = await prisma.rentalAddon.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const addon = await prisma.rentalAddon.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name.trim() }),
        ...(data.description !== undefined && { description: data.description?.trim() || null }),
        ...(data.price !== undefined && { price: data.price }),
        ...(data.stockQuantity !== undefined && { stockQuantity: data.stockQuantity }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    return NextResponse.json(addon);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    console.error("PATCH /api/rentals/addons/[id] error:", error);
    return NextResponse.json({ error: "Failed to update add-on" }, { status: 500 });
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

    const existing = await prisma.rentalAddon.findFirst({
      where: { id, shopId: shop.id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await prisma.rentalAddon.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/rentals/addons/[id] error:", error);
    return NextResponse.json({ error: "Failed to delete add-on" }, { status: 500 });
  }
}
