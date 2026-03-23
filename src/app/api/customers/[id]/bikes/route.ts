import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const createBikeSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  nickname: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const bikes = await prisma.bike.findMany({
      where: { customerId: id },
      orderBy: [{ make: "asc" }, { model: "asc" }],
    });
    return NextResponse.json(bikes);
  } catch (error) {
    console.error("GET /api/customers/[id]/bikes error:", error);
    return NextResponse.json(
      { error: "Failed to fetch bikes" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const data = createBikeSchema.parse(body);

    const bike = await prisma.bike.create({
      data: {
        customerId: id,
        make: data.make.trim(),
        model: data.model.trim(),
        nickname: data.nickname?.trim() || null,
        imageUrl: data.imageUrl?.trim() || null,
      },
    });
    return NextResponse.json(bike);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    console.error("POST /api/customers/[id]/bikes error:", error);
    return NextResponse.json(
      { error: "Failed to create bike" },
      { status: 500 }
    );
  }
}
