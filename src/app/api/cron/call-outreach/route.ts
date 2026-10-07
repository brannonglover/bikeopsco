import { NextRequest, NextResponse } from "next/server";
import { sweepMissedCallOutreach } from "@/lib/ai/call-outreach";
import { resolveStalledTranscriptions } from "@/lib/voice";

export const runtime = "nodejs";

/**
 * Settles what a finished call's Twilio callbacks left open.
 *
 * Both sweeps here are waiting on the same thing: a callback that describes
 * what the caller did. Every one that arrives is handled the moment it lands,
 * so in the ordinary case this finds nothing to do. It exists for the endings
 * that produce no callback at all — chiefly hanging up during the voicemail
 * greeting, which leaves Twilio with no recording to report on or transcribe
 * — and runs often enough that a caller it does pick up is still answered
 * while they're plausibly waiting.
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
    // Outreach first: it reads transcriptionText to decide how to open, and
    // the resolver below only ever writes to rows that have none.
    const { attempted } = await sweepMissedCallOutreach();
    const transcriptions = await resolveStalledTranscriptions();
    return NextResponse.json({ attempted, transcriptions });
  } catch (error) {
    console.error("Cron call-outreach error:", error);
    return NextResponse.json(
      { error: "Failed to sweep missed calls" },
      { status: 500 }
    );
  }
}
