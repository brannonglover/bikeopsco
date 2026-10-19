import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;

    const jobs = await prisma.job.findMany({
      where: { customerId: id, shopId: auth.shopId },
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
