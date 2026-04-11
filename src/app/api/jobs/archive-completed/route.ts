import { NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { prisma } from "@/lib/db";

/** Archives all completed jobs that aren't already archived (e.g. at end of day). */
export async function POST(request: NextRequest) {
  const token = await getToken({ req: request });
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
