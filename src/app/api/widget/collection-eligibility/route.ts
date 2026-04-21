import { NextRequest, NextResponse } from "next/server";
import { checkCollectionEligibility } from "@/lib/collection-radius";
import { getAppFeatures } from "@/lib/app-settings";
import { addWidgetCorsHeaders } from "@/lib/widget-cors";

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
    const features = await getAppFeatures();
    if (!features.collectionServiceEnabled) {
      const res = NextResponse.json({ ok: true, enabled: false });
      return addWidgetCorsHeaders(res, origin, {
        methods: "GET, OPTIONS",
        allowHeaders: "Content-Type, Authorization",
      });
    }
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address") || "";
    const result = await checkCollectionEligibility(address, features.collectionRadiusMiles);

    const res = NextResponse.json(result);
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  } catch (error) {
    console.error("GET /api/widget/collection-eligibility error:", error);
    const res = NextResponse.json(
      { ok: false, enabled: true, error: "Failed to check address" },
      { status: 500 }
    );
    return addWidgetCorsHeaders(res, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type, Authorization",
    });
  }
}
