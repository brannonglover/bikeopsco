import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";

const createServiceSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  price: z.number().min(0, "Price must be 0 or greater"),
});

export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";

    const services = await prisma.service.findMany({
      where: q
        ? {
            shopId: shop.id,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
            ],
          }
        : { shopId: shop.id },
      orderBy: { name: "asc" },
    });
    return NextResponse.json(services);
  } catch (error) {
    console.error("GET /api/services error:", error);
    return NextResponse.json(
      { error: "Failed to fetch services" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const body = await request.json();
    const data = createServiceSchema.parse(body);

    const service = await prisma.service.create({
      data: {
        shopId: shop.id,
        name: data.name,
        description: data.description ?? null,
        price: data.price,
      },
    });

    return NextResponse.json(service);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const flattened = error.flatten();
      const fieldErrors = Object.entries(flattened.fieldErrors ?? {})
        .flatMap(([field, msgs]) =>
          (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean).map((m) => `${field}: ${m}`)
        );
      return NextResponse.json(
        { error: fieldErrors.join("; ") },
        { status: 400 }
      );
    }
    console.error("POST /api/services error:", error);
    return NextResponse.json(
      { error: "Failed to create service" },
      { status: 500 }
    );
  }
}
