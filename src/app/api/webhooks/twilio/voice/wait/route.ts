import { NextRequest, NextResponse } from "next/server";
import {
  authenticateVoiceWebhook,
  buildQueueWaitTwiml,
  getHoldMusicUrl,
} from "@/lib/voice";

export const runtime = "nodejs";

/**
 * <Enqueue waitUrl> — what a held caller hears, re-requested by Twilio every
 * time the previous document finishes. QueueTime is the elapsed wait in
 * seconds, which makes this the ring timer as well as the hold audio: past
 * the ring window it returns <Leave/> and the caller falls through to
 * /dequeued, then voicemail.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { params } = ctx;

  const queueTimeSeconds = Number.parseInt(params.QueueTime ?? "0", 10);

  const twiml = buildQueueWaitTwiml({
    // A malformed QueueTime must not park the caller forever — treating it as
    // "past the window" errs toward voicemail rather than endless hold.
    queueTimeSeconds: Number.isFinite(queueTimeSeconds) ? queueTimeSeconds : Number.MAX_SAFE_INTEGER,
    holdMusicUrl: getHoldMusicUrl(),
  });

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
