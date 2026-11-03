import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateVoiceWebhook, getVoiceWebhookBaseUrl } from "@/lib/voice";
import { connectCallToVoiceAgent } from "@/lib/ai/voice-agent";

export const runtime = "nodejs";

/**
 * A caller the AI assistant handed to staff, whom nobody picked up. Reached
 * from /dequeued when the hold runs out, and from a decline. They go back to
 * the assistant, which apologizes and takes a message — they have already
 * been talking to it, and a voicemail beep would make them start over.
 *
 * If the assistant can't be reached this time, voicemail is still there.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;
  const base = getVoiceWebhookBaseUrl(request);

  const callSid = params.CallSid;
  const call = callSid
    ? await prisma.call.findUnique({
        where: { shopId_twilioParentCallSid: { shopId: shop.id, twilioParentCallSid: callSid } },
        select: { id: true, customerId: true, fromNumber: true, toNumber: true },
      })
    : null;

  const twiml = call
    ? await connectCallToVoiceAgent({
        shopId: shop.id,
        callId: call.id,
        customerId: call.customerId,
        base,
        fromNumber: call.fromNumber,
        toNumber: call.toNumber,
        mode: "message",
      })
    : null;

  if (!call || !twiml) {
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${base}/api/webhooks/twilio/voice/voicemail</Redirect></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  // Back in conversation, so no longer a held caller: clearing aiHandoffAt is
  // what keeps a stale Answer or Decline tap from pulling them out of it.
  await prisma.call
    .update({
      where: { id: call.id },
      data: { status: "IN_PROGRESS", aiHandoffAt: null },
    })
    .catch((error) => {
      console.error("[voice] /ai-message could not update the call:", error);
    });

  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
