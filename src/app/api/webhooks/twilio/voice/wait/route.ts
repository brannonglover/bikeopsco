import { NextRequest, NextResponse } from "next/server";
import {
  RING_SECONDS,
  authenticateVoiceWebhook,
  buildQueueWaitTwiml,
  getHoldMusicUrl,
  getVoiceWebhookBaseUrl,
  ringStaffForCall,
} from "@/lib/voice";

export const runtime = "nodejs";

/**
 * <Enqueue waitUrl> — what a held caller hears, re-requested by Twilio every
 * time the previous document finishes. QueueTime is the elapsed wait in
 * seconds, which makes this the ring timer as well as the hold audio: past
 * the ring window it returns <Leave/> and the caller falls through to
 * /dequeued, then voicemail.
 *
 * It is also what makes staff devices keep ringing. One notification is a
 * single four-second alert, which is not a ring; being asked for this
 * document every few seconds gives a heartbeat to ring on, for exactly as
 * long as someone is actually waiting. Nothing has to be scheduled or
 * cancelled — a caller who has been answered, declined or timed out is no
 * longer in the queue, so this stops being requested and the ringing stops.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { params } = ctx;
  const base = getVoiceWebhookBaseUrl(request);

  const queueTimeSeconds = Number.parseInt(params.QueueTime ?? "0", 10);

  // Ring again on every pass but the first: /incoming already sent one, and
  // Twilio requests this document immediately on enqueue, so ringing at
  // QueueTime 0 would double the very first alert. Nothing is sent once the
  // window is up either — that pass returns <Leave/>, and a caller on their
  // way to voicemail should not set a phone ringing behind them.
  //
  // Awaited rather than left dangling: the response is the caller's next
  // moment of hold audio, but an un-awaited push on a serverless function is
  // a push that may simply never be sent.
  const ringing =
    Number.isFinite(queueTimeSeconds) &&
    queueTimeSeconds > 0 &&
    queueTimeSeconds < RING_SECONDS;
  if (ringing && params.CallSid) {
    await ringStaffForCall(ctx.shop.id, params.CallSid).catch((error) => {
      // Hold audio matters more than one repeat of the ring.
      console.error("[voice] repeat ring for held caller failed:", error);
    });
  }

  const twiml = buildQueueWaitTwiml({
    // A malformed QueueTime must not park the caller forever — treating it as
    // "past the window" errs toward voicemail rather than endless hold.
    queueTimeSeconds: Number.isFinite(queueTimeSeconds) ? queueTimeSeconds : Number.MAX_SAFE_INTEGER,
    holdMusicUrl: getHoldMusicUrl(),
    // Served straight from /public, so Twilio fetches it with no auth.
    ringbackUrl: `${base}/audio/ringback.wav`,
  });

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
