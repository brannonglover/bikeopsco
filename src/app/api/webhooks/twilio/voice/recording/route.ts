import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateVoiceWebhook } from "@/lib/voice";

export const runtime = "nodejs";

/**
 * Recording status callback from the /voicemail <Record> verb. Fires once
 * Twilio has actually finished processing the recording — separate from the
 * voicemail TwiML response itself, since the audio isn't available yet at
 * that point. Conversation timeline integration (SYSTEM message for the
 * missed call) is added in a later phase, not here.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  if (!callSid) {
    return new NextResponse("ok", { status: 200 });
  }

  await prisma.call.updateMany({
    where: { shopId: shop.id, twilioParentCallSid: callSid },
    data: {
      recordingSid: params.RecordingSid ?? null,
      recordingUrl: params.RecordingUrl ?? null,
      recordingStatus: params.RecordingStatus ?? null,
      durationSeconds: params.RecordingDuration
        ? parseInt(params.RecordingDuration, 10)
        : undefined,
    },
  });

  return new NextResponse("ok", { status: 200 });
}
