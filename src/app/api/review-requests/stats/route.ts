import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const [totalSent, googleClicks, yelpClicks, anyClick] = await Promise.all([
      prisma.reviewRequest.count(),
      prisma.reviewRequest.count({ where: { googleClickedAt: { not: null } } }),
      prisma.reviewRequest.count({ where: { yelpClickedAt: { not: null } } }),
      prisma.reviewRequest.count({
        where: {
          OR: [
            { googleClickedAt: { not: null } },
            { yelpClickedAt: { not: null } },
          ],
        },
      }),
    ]);

    return NextResponse.json({ totalSent, googleClicks, yelpClicks, anyClick });
  } catch (error) {
    console.error("GET /api/review-requests/stats error:", error);
    return NextResponse.json(
      { error: "Failed to fetch review stats" },
      { status: 500 }
    );
  }
}
