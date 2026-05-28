import { NextResponse } from "next/server";
import { addWidgetCorsHeaders } from "@/lib/widget-cors";

const SITE_CHAT_METHODS = "GET, POST, OPTIONS";
const SITE_CHAT_HEADERS = "Content-Type";

export function siteChatOptionsResponse(origin: string | null): NextResponse {
  return addWidgetCorsHeaders(
    new NextResponse(null, { status: 204 }),
    origin,
    {
      methods: SITE_CHAT_METHODS,
      allowHeaders: SITE_CHAT_HEADERS,
    }
  );
}

export function withSiteChatCors(
  response: NextResponse,
  origin: string | null
): NextResponse {
  return addWidgetCorsHeaders(response, origin, {
    methods: SITE_CHAT_METHODS,
    allowHeaders: SITE_CHAT_HEADERS,
  });
}
