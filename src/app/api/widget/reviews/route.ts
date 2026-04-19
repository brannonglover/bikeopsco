import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  fetchGooglePlaceData,
  fetchYelpBusinessData,
  extractYelpAlias,
  type ReviewEntry,
} from "@/lib/reviews";
import { getGooglePlacesApiKey, getYelpApiKey } from "@/lib/env";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

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
  response.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
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
    const features = await getAppFeatures();
    if (!features.reviewsEnabled) {
      const res = NextResponse.json({ error: "Reviews are disabled" }, { status: 404 });
      return addCorsHeaders(res, origin);
    }
    const [settings, totalSent] = await Promise.all([
      prisma.reviewSettings.findUnique({ where: { id: "default" } }),
      prisma.reviewRequest.count(),
    ]);

    const googleApiKey = getGooglePlacesApiKey();
    const yelpApiKey = getYelpApiKey();

    const [googleData, yelpData] = await Promise.all([
      settings?.googlePlaceId && googleApiKey
        ? fetchGooglePlaceData(settings.googlePlaceId, googleApiKey)
        : null,
      settings?.yelpReviewUrl && yelpApiKey
        ? fetchYelpBusinessData(extractYelpAlias(settings.yelpReviewUrl) ?? "", yelpApiKey)
        : null,
    ]);

    const featuredReviews = Array.isArray(settings?.featuredReviews)
      ? settings.featuredReviews
      : [];

    const mergedLive: ReviewEntry[] = [
      ...(googleData?.reviews ?? []),
      ...(yelpData?.reviews ?? []),
    ];
    const latestReviews = mergedLive
      .slice()
      .sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
        const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      })
      .slice(0, 15);

    const res = NextResponse.json({
      totalSent,
      googleReviewUrl: settings?.googleReviewUrl ?? null,
      yelpReviewUrl: settings?.yelpReviewUrl ?? null,
      google: googleData
        ? {
            rating: googleData.rating,
            reviewCount: googleData.reviewCount,
            reviews: googleData.reviews,
          }
        : null,
      yelp: yelpData
        ? {
            rating: yelpData.rating,
            reviewCount: yelpData.reviewCount,
            reviews: yelpData.reviews,
          }
        : null,
      latestReviews,
      featuredReviews,
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
