import { NextRequest, NextResponse } from "next/server";
import {
  listPublishedReleases,
  releaseAnchorId,
  serializeRelease,
} from "@/lib/platform-releases";
import { addWidgetCorsHeaders, isAllowedWidgetOrigin } from "@/lib/widget-cors";

export const dynamic = "force-dynamic";

/**
 * Public published release notes for the marketing changelog page.
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  const response = new NextResponse(null, { status: 204 });
  return addWidgetCorsHeaders(response, origin, {
    methods: "GET, OPTIONS",
    allowHeaders: "Content-Type",
  });
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const releases = await listPublishedReleases();

  const response = NextResponse.json(
    {
      releases: releases.map((release) => ({
        ...serializeRelease(release),
        anchorId: releaseAnchorId(release.version),
      })),
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );

  if (origin && isAllowedWidgetOrigin(origin)) {
    return addWidgetCorsHeaders(response, origin, {
      methods: "GET, OPTIONS",
      allowHeaders: "Content-Type",
    });
  }

  return response;
}
