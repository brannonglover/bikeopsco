import { NextRequest, NextResponse } from "next/server";
import { checkCollectionEligibility } from "@/lib/collection-radius";

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
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address") || "";
    const result = await checkCollectionEligibility(address);

    const res = NextResponse.json(result);
    return addCorsHeaders(res, origin);
  } catch (error) {
    console.error("GET /api/widget/collection-eligibility error:", error);
    const res = NextResponse.json(
      { ok: false, enabled: true, error: "Failed to check address" },
      { status: 500 }
    );
    return addCorsHeaders(res, origin);
  }
}

