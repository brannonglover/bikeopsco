import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";
import { z } from "zod";

const addProductSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).optional().default(1),
  jobBikeId: z.string().optional().nullable(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req: request });
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const shopId = token.shopId;

  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = addProductSchema.parse(body);

    const product = await prisma.product.findFirst({
      where: { id: data.productId, shopId },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    const jobProduct = await prisma.jobProduct.create({
      data: {
        shopId,
        jobId,
        productId: data.productId,
        quantity: data.quantity,
        unitPrice: product.price,
        jobBikeId: data.jobBikeId ?? null,
      },
      include: {
        product: true,
        jobBike: { select: { id: true, make: true, model: true, nickname: true } },
      },
    });

    return NextResponse.json(jobProduct);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("POST /api/jobs/[id]/products error:", error);
    return NextResponse.json(
      { error: "Failed to add product to job" },
      { status: 500 }
    );
  }
}

const patchProductSchema = z.object({
  jobProductId: z.string().min(1),
  jobBikeId: z.string().nullable().optional(),
  quantity: z.number().int().min(1).optional(),
  unitPrice: z.number().min(0).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req: request });
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const shopId = token.shopId;

  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = patchProductSchema.parse(body);

    const existing = await prisma.jobProduct.findFirst({
      where: { shopId, id: data.jobProductId, jobId },
    });

    if (!existing) {
      return NextResponse.json({ error: "Job product not found" }, { status: 404 });
    }

    const updateData: { jobBikeId?: string | null; quantity?: number; unitPrice?: number } = {};
    if ("jobBikeId" in data) updateData.jobBikeId = data.jobBikeId ?? null;
    if (data.quantity !== undefined) updateData.quantity = data.quantity;
    if (data.unitPrice !== undefined) updateData.unitPrice = Math.round(data.unitPrice * 100) / 100;

    const updated = await prisma.jobProduct.update({
      where: { id: data.jobProductId },
      data: updateData,
      include: {
        product: true,
        jobBike: { select: { id: true, make: true, model: true, nickname: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.flatten() }, { status: 400 });
    }
    console.error("PATCH /api/jobs/[id]/products error:", error);
    return NextResponse.json({ error: "Failed to update product line" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await getToken({ req: request });
  if (!token?.shopId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const shopId = token.shopId;

  try {
    const { id: jobId } = params;
    const { searchParams } = new URL(request.url);
    const jobProductId = searchParams.get("jobProductId");

    if (!jobProductId) {
      return NextResponse.json(
        { error: "jobProductId query param required" },
        { status: 400 }
      );
    }

    const result = await prisma.jobProduct.deleteMany({
      where: {
        shopId,
        id: jobProductId,
        jobId,
      },
    });

    if (result.count === 0) {
      return NextResponse.json(
        { error: "Job product not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/jobs/[id]/products error:", error);
    return NextResponse.json(
      { error: "Failed to remove product from job" },
      { status: 500 }
    );
  }
}
