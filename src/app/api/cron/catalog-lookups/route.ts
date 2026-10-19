import { NextRequest, NextResponse } from "next/server";
import { sweepCatalogLookups } from "@/lib/bike-catalog-lookup";

export const runtime = "nodejs";
// A web lookup can take a minute or two; a sweep runs a handful back to back.
export const maxDuration = 300;

/**
 * Finishes catalog lookups the job routes didn't: bikes from customer
 * bookings (which never schedule one), lookups cut short when a function
 * instance was recycled, and bikes that waited on another job's search for the
 * same model. Each bike is attempted once; a bike the web search can't find
 * is not searched again here.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sweepCatalogLookups();
    return NextResponse.json(result);
  } catch (error) {
    console.error("Cron catalog-lookups error:", error);
    return NextResponse.json({ error: "Failed to sweep catalog lookups" }, { status: 500 });
  }
}
