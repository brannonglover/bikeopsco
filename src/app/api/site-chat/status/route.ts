import { NextRequest, NextResponse } from "next/server";
import { isQuoConfigured, getQuoFromNumber } from "@/lib/quo";
import { getResendApiKey } from "@/lib/env";
import { siteChatOptionsResponse, withSiteChatCors } from "@/lib/site-chat-cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight health check for marketing chat → Quo wiring (no secrets exposed).
 */
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");

  return withSiteChatCors(
    NextResponse.json({
      quoConfigured: isQuoConfigured(),
      quoFromSet: Boolean(getQuoFromNumber()),
      emailConfigured: Boolean(getResendApiKey()),
    }),
    origin
  );
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return siteChatOptionsResponse(origin);
}
