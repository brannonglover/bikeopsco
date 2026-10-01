import { NextRequest, NextResponse } from "next/server";
import { sweepMissedCallOutreach } from "@/lib/ai/call-outreach";

export const runtime = "nodejs";

/**
 * Backstop for the AI assistant's missed-call replies.
 *
 * Every Twilio callback that can describe a missed call already triggers
 * outreach directly, so by the time this runs there is usually nothing to do.
 * It exists for the endings that produce no callback at all — see
 * sweepMissedCallOutreach — and runs often enough that a caller it does pick
 * up is still answered while they're plausibly waiting.
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
    const { attempted } = await sweepMissedCallOutreach();
    return NextResponse.json({ attempted });
  } catch (error) {
    console.error("Cron call-outreach error:", error);
    return NextResponse.json(
      { error: "Failed to sweep missed calls" },
      { status: 500 }
    );
  }
}
