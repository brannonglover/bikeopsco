import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";
import { rentalsDisabledResponse } from "@/lib/rentals/guard";
import { RENTAL_CATEGORIES } from "@/lib/rentals/types";

const createSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  category: z.enum(RENTAL_CATEGORIES).default("MOUNTAIN"),
  size: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  quantity: z.number().int().min(1).default(1),
  isActive: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";
    const category = searchParams.get("category");

    const bikes = await prisma.rentalBike.findMany({
      where: {
        shopId: shop.id,
        ...(category && RENTAL_CATEGORIES.includes(category as (typeof RENTAL_CATEGORIES)[number])
          ? { category: category as (typeof RENTAL_CATEGORIES)[number] }
          : {}),
        ...(q
          ? {
              OR: [
                { make: { contains: q, mode: "insensitive" } },
                { model: { contains: q, mode: "insensitive" } },
                { description: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: [{ category: "asc" }, { make: "asc" }, { model: "asc" }],
    });

    return NextResponse.json(bikes);
  } catch (error) {
    console.error("GET /api/rentals/fleet error:", error);
    return NextResponse.json({ error: "Failed to fetch rental fleet" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const disabled = await rentalsDisabledResponse(shop.id);
    if (disabled) return disabled;
    const body = await request.json();
    const data = createSchema.parse(body);

    const bike = await prisma.rentalBike.create({
      data: {
        shopId: shop.id,
        make: data.make.trim(),
        model: data.model.trim(),
        category: data.category,
        size: data.size?.trim() || null,
        description: data.description?.trim() || null,
        imageUrl: data.imageUrl?.trim() || null,
        quantity: data.quantity,
        isActive: data.isActive ?? true,
      },
    });

    return NextResponse.json(bike);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
    }
    console.error("POST /api/rentals/fleet error:", error);
    return NextResponse.json({ error: "Failed to create rental bike" }, { status: 500 });
  }
}
