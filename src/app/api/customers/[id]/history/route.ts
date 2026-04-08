import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const jobs = await prisma.job.findMany({
      where: { customerId: id },
      orderBy: { createdAt: "desc" },
      include: {
        jobBikes: true,
        jobServices: {
          include: { service: true },
        },
        jobProducts: {
          include: { product: true },
        },
        payments: true,
      },
    });

    return NextResponse.json(jobs);
  } catch (error) {
    console.error("GET /api/customers/[id]/history error:", error);
    return NextResponse.json(
      { error: "Failed to fetch customer history" },
      { status: 500 }
    );
  }
}
