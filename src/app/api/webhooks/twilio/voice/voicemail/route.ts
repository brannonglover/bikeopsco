import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  authenticateVoiceWebhook,
  buildVoicemailTwiml,
  getVoiceWebhookBaseUrl,
  isVoicemailTranscriptionEnabled,
} from "@/lib/voice";

export const runtime = "nodejs";

/**
 * <Dial> action callback from /incoming when no staff device answers.
 * CallSid here is the parent (inbound) call, not a new leg.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const transcribe = isVoicemailTranscriptionEnabled();

  const callSid = params.CallSid;
  if (callSid) {
    await prisma.call.updateMany({
      where: { shopId: shop.id, twilioParentCallSid: callSid },
      data: {
        status: "VOICEMAIL",
        endedAt: new Date(),
        // Marked pending here rather than on the recording callback so the app
        // can show "Transcribing…" instead of an empty gap while Twilio works.
        ...(transcribe ? { transcriptionStatus: "in-progress" } : {}),
      },
    });
  }

  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildVoicemailTwiml({
    recordingStatusCallbackUrl: `${base}/api/webhooks/twilio/voice/recording`,
    transcribeCallbackUrl: transcribe
      ? `${base}/api/webhooks/twilio/voice/transcription`
      : null,
  });

  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
