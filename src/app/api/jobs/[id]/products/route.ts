import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const addProductSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).optional().default(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id: jobId } = params;
    const body = await request.json();
    const data = addProductSchema.parse(body);

    const product = await prisma.product.findUnique({
      where: { id: data.productId },
    });

    if (!product) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      );
    }

    const jobProduct = await prisma.jobProduct.create({
      data: {
        jobId,
        productId: data.productId,
        quantity: data.quantity,
        unitPrice: product.price,
      },
      include: {
        product: true,
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
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
