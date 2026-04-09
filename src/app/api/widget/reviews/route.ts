import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

function addCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  const allowed =
    origin &&
    (origin.endsWith("basementbikemechanic.com") ||
      origin.endsWith(".basementbikemechanic.com") ||
      origin.includes("localhost"));
  if (allowed && origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  return response;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = NextResponse.json({}, { status: 204 });
  return addCorsHeaders(res, origin);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const [settings, totalSent, googleClicks, yelpClicks] = await Promise.all([
      prisma.reviewSettings.findUnique({ where: { id: "default" } }),
      prisma.reviewRequest.count(),
      prisma.reviewRequest.count({ where: { googleClickedAt: { not: null } } }),
      prisma.reviewRequest.count({ where: { yelpClickedAt: { not: null } } }),
    ]);

    const res = NextResponse.json({
      totalSent,
      googleClicks,
      yelpClicks,
      googleReviewUrl: settings?.googleReviewUrl ?? null,
      yelpReviewUrl: settings?.yelpReviewUrl ?? null,
    });
    return addCorsHeaders(res, origin);
  } catch (error) {
    console.error("GET /api/widget/reviews error:", error);
    const res = NextResponse.json(
      { error: "Failed to fetch review widget data" },
      { status: 500 }
    );
    return addCorsHeaders(res, origin);
  }
}
