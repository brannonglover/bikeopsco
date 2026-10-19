import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireStaffShop } from "@/lib/api-auth";

/** Archives this shop's completed jobs that aren't already archived (e.g. at end of day). */
export async function POST(request: NextRequest) {
  const auth = await requireStaffShop(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await prisma.job.updateMany({
      where: {
        shopId: auth.shopId,
        stage: "COMPLETED",
        archivedAt: null,
      },
      data: {
        archivedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      archived: result.count,
    });
  } catch (error) {
    console.error("POST /api/jobs/archive-completed error:", error);
    return NextResponse.json(
      { error: "Failed to archive completed jobs" },
      { status: 500 }
    );
  }
}
