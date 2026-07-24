import { NextResponse } from "next/server";
import { getAppVersionPayload } from "@/lib/app-version";

export const dynamic = "force-dynamic";

/**
 * Public deploy identity for soft-update checks.
 * Clients capture the version on first load, then poll; a mismatch means a
 * newer production deploy is live and the tab should offer a refresh.
 */
export async function GET() {
  const payload = getAppVersionPayload();
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store, max-age=0, must-revalidate",
    },
  });
}
