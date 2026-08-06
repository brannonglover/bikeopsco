import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";
import { rentalsDisabledResponse } from "@/lib/rentals/guard";
import { RENTAL_CATEGORIES } from "@/lib/rentals/types";

const createSchema = z.object({
  name: z.string().min(1, "Name is required"),
  days: z.number().int().min(1, "Days must be at least 1"),
  price: z.number().min(0, "Price must be 0 or greater"),
  category: z.enum(RENTAL_CATEGORIES).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const rates = await prisma.rentalRate.findMany({
      where: { shopId: shop.id },
      orderBy: [{ days: "asc" }, { name: "asc" }],
    });
    return NextResponse.json(rates);
  } catch (error) {
    console.error("GET /api/rentals/rates error:", error);
    return NextResponse.json({ error: "Failed to fetch rental rates" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const body = await request.json();
    const data = createSchema.parse(body);

    const rate = await prisma.rentalRate.create({
      data: {
        shopId: shop.id,
        name: data.name.trim(),
        days: data.days,
        price: data.price,
        category: data.category ?? null,
        isActive: data.isActive ?? true,
      },
    });

    return NextResponse.json(rate);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    console.error("POST /api/rentals/rates error:", error);
    return NextResponse.json({ error: "Failed to create rental rate" }, { status: 500 });
  }
}
