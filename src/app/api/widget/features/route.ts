import { NextRequest, NextResponse } from "next/server";
import { getAppFeatures } from "@/lib/app-settings";

export const dynamic = "force-dynamic";

function addCorsHeaders(response: NextResponse, origin: string | null): NextResponse {
  const allowed =
    origin &&
    (origin.endsWith("basementbikemechanic.com") ||
      origin.endsWith(".basementbikemechanic.com") ||
      origin.includes("localhost"));
  response.headers.set("Vary", "Origin");
  if (allowed && origin) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Max-Age", "86400");
  return response;
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const res = new NextResponse(null, { status: 204 });
  return addCorsHeaders(res, origin);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  try {
    const features = await getAppFeatures();
    const res = NextResponse.json({
      collectionServiceEnabled: features.collectionServiceEnabled,
      collectionRadiusMiles: features.collectionRadiusMiles,
      collectionFeeRegular: features.collectionFeeRegular,
      collectionFeeEbike: features.collectionFeeEbike,
      chatEnabled: features.chatEnabled,
      reviewsEnabled: features.reviewsEnabled,
    });
    return addCorsHeaders(res, origin);
  } catch (error) {
    console.error("GET /api/widget/features error:", error);
    const res = NextResponse.json(
      { error: "Failed to fetch widget features" },
      { status: 500 }
    );
    return addCorsHeaders(res, origin);
  }
}
