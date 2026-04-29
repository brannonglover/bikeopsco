import { NextRequest, NextResponse } from "next/server";
import { getAppFeatures } from "@/lib/app-settings";
import { addWidgetCorsHeaders } from "@/lib/widget-cors";
import { getShopForHost } from "@/lib/shop";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = new NextResponse(null, { status: 204 });
  return addWidgetCorsHeaders(res, origin, {
    methods: "GET, OPTIONS",
    allowHeaders: "Content-Type, Authorization",
  });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const hostHeader =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const shop = await getShopForHost(hostHeader);
    if (!shop) {
      const res = NextResponse.json({ error: "Shop not found" }, { status: 404 });
      return addWidgetCorsHeaders(res, origin, {
        methods: "GET, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }

    const features = await getAppFeatures(shop.id);
    const res = NextResponse.json({
      collectionServiceEnabled: features.collectionServiceEnabled,
      collectionRadiusMiles: features.collectionRadiusMiles,
      collectionFeeRegular: features.collectionFeeRegular,
      collectionFeeEbike: features.collectionFeeEbike,
      chatEnabled: features.chatEnabled,
      reviewsEnabled: features.reviewsEnabled,
    });
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  } catch (error) {
    console.error("GET /api/widget/features error:", error);
    const res = NextResponse.json(
      { error: "Failed to fetch widget features" },
      { status: 500 }
    );
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  }
}
