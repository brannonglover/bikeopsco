import { NextRequest, NextResponse } from "next/server";
import { authenticateVoiceWebhook, buildDequeuedTwiml, getVoiceWebhookBaseUrl } from "@/lib/voice";

export const runtime = "nodejs";

/**
 * <Enqueue action> — hit whenever the caller leaves the shop queue, with
 * QueueResult saying why. Answered calls end here too (after the bridge
 * finishes), which is exactly why this branches instead of unconditionally
 * sending everyone to voicemail.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { params } = ctx;

  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildDequeuedTwiml({
    queueResult: params.QueueResult,
    voicemailUrl: `${base}/api/webhooks/twilio/voice/voicemail`,
  });

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
