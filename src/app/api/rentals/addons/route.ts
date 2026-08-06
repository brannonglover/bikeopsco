import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";
import { rentalsDisabledResponse } from "@/lib/rentals/guard";

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  price: z.number().min(0, "Price must be 0 or greater"),
  stockQuantity: z.number().int().min(0).default(0),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const addons = await prisma.rentalAddon.findMany({
      where: { shopId: shop.id },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(addons);
  } catch (error) {
    console.error("GET /api/rentals/addons error:", error);
    return NextResponse.json({ error: "Failed to fetch add-ons" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const body = await request.json();
    const data = createSchema.parse(body);

    const addon = await prisma.rentalAddon.create({
      data: {
        shopId: shop.id,
        name: data.name.trim(),
        description: data.description?.trim() || null,
        price: data.price,
        stockQuantity: data.stockQuantity,
        isActive: data.isActive ?? true,
      },
    });

    return NextResponse.json(addon);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    console.error("POST /api/rentals/addons error:", error);
    return NextResponse.json({ error: "Failed to create add-on" }, { status: 500 });
  }
}
