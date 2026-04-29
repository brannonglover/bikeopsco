import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";
import { requireCurrentShop } from "@/lib/shop";

const createProductSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable().transform((v) => (v?.trim() ? v : null)),
  price: z.number().min(0, "Price must be 0 or greater"),
  stockQuantity: z.number().int().min(0).optional().default(0),
  supplier: z.string().optional().nullable().transform((v) => (v?.trim() ? v : null)),
});

export async function GET(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? "";

    const products = await prisma.product.findMany({
      where: q
        ? {
            shopId: shop.id,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { supplier: { contains: q, mode: "insensitive" } },
            ],
          }
        : { shopId: shop.id },
      orderBy: { name: "asc" },
    });
    const res = NextResponse.json(products);
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (error) {
    console.error("GET /api/products error:", error);
    return NextResponse.json(
      { error: "Failed to fetch products" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const shop = await requireCurrentShop();
    const body = await request.json();
    const data = createProductSchema.parse(body);

    const product = await prisma.product.create({
      data: {
        shopId: shop.id,
        name: data.name,
        description: data.description ?? null,
        imageUrl: data.imageUrl ?? null,
        price: data.price,
        stockQuantity: data.stockQuantity,
        supplier: data.supplier ?? null,
      },
    });

    return NextResponse.json(product);
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
    console.error("POST /api/products error:", error);
    return NextResponse.json(
      { error: "Failed to create product" },
      { status: 500 }
    );
  }
}
