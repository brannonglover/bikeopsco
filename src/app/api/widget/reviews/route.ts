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
import { addWidgetCorsHeaders } from "@/lib/widget-cors";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = NextResponse.json({}, { status: 204 });
  res.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
  return addWidgetCorsHeaders(res, origin, {
    methods: "GET, OPTIONS",
    allowHeaders: "Content-Type, Authorization",
  });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const shop = await getShopForHost(request.headers.get("host"));
    if (!shop) {
      const res = NextResponse.json({ error: "Shop not found" }, { status: 404 });
      res.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return addWidgetCorsHeaders(res, origin, {
        methods: "GET, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }

    const features = await getAppFeatures(shop.id);
    if (!features.reviewsEnabled) {
      const res = NextResponse.json({ error: "Reviews are disabled" }, { status: 404 });
      res.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
      return addWidgetCorsHeaders(res, origin, {
        methods: "GET, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }
    const [settings, totalSent] = await Promise.all([
      prisma.reviewSettings.findUnique({ where: { shopId: shop.id } }),
      prisma.reviewRequest.count({ where: { shopId: shop.id } }),
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

    const featuredList = featuredReviews as unknown as ReviewEntry[];
    const displayReviews = (() => {
      if (latestReviews.length === 0) return featuredList.slice(0, 15);
      if (latestReviews.length >= 15) return latestReviews.slice(0, 15);
      const seen = new Set(latestReviews.map((r) => `${r.platform}|${r.author}|${r.rating}|${r.text}`.trim()));
      const filler = featuredList.filter((r) => {
        const k = `${r.platform}|${r.author}|${r.rating}|${r.text}`.trim();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      return [...latestReviews, ...filler].slice(0, 15);
    })();

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
      displayReviews,
      featuredReviews,
    });
    res.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  } catch (error) {
    console.error("GET /api/widget/reviews error:", error);
    const res = NextResponse.json(
      { error: "Failed to fetch review widget data" },
      { status: 500 }
    );
    res.headers.set("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=7200");
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  }
}
