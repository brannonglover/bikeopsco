import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const updateBikeSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; bikeId: string }> }
) {
  try {
    const { id: customerId, bikeId } = await params;
    const body = await request.json();
    const data = updateBikeSchema.parse(body);

    const bike = await prisma.bike.findFirst({
      where: { id: bikeId, customerId },
    });
    if (!bike) {
      return NextResponse.json({ error: "Bike not found" }, { status: 404 });
    }

    const updated = await prisma.bike.update({
      where: { id: bikeId },
      data: {
        ...(data.make !== undefined && { make: data.make.trim() }),
        ...(data.model !== undefined && { model: data.model.trim() }),
        ...(data.nickname !== undefined && {
          nickname: data.nickname?.trim() || null,
        }),
        ...(data.imageUrl !== undefined && {
          imageUrl: data.imageUrl?.trim() || null,
        }),
      },
    });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("PATCH /api/customers/[id]/bikes/[bikeId] error:", error);
    return NextResponse.json(
      { error: "Failed to update bike" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; bikeId: string }> }
) {
  try {
    const { id: customerId, bikeId } = await params;

    const bike = await prisma.bike.findFirst({
      where: { id: bikeId, customerId },
    });
    if (!bike) {
      return NextResponse.json({ error: "Bike not found" }, { status: 404 });
    }

    await prisma.bike.delete({ where: { id: bikeId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/customers/[id]/bikes/[bikeId] error:", error);
    return NextResponse.json(
      { error: "Failed to delete bike" },
      { status: 500 }
    );
  }
}
