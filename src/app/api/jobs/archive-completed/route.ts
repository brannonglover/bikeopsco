import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/** Archives all completed jobs that aren't already archived (e.g. at end of day). */
export async function POST(_request: NextRequest) {
  try {
    const result = await prisma.job.updateMany({
      where: {
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
