import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { resolvePublicMediaUrl } from "@/lib/blob";
import {
  authenticateVoiceWebhook,
  buildVoicemailTwiml,
  getVoiceWebhookBaseUrl,
  isVoicemailTranscriptionEnabled,
} from "@/lib/voice";

export const runtime = "nodejs";

/**
 * Where an unanswered inbound call ends up. Reached from /dequeued when the
 * caller leaves the queue without being bridged, and by a REST redirect when
 * staff decline. CallSid here is the parent (inbound) call, not a new leg.
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

  // Twilio fetches the greeting from its own servers, so a private-blob proxy
  // path has to be absolute. The webhook host is the one Twilio just called,
  // which makes it a safer base than anything derived from shop config.
  const settings = await prisma.appSettings.findUnique({
    where: { shopId: shop.id },
    select: { voicemailGreetingUrl: true },
  });
  const storedGreeting = settings?.voicemailGreetingUrl ?? null;
  const greetingAudioUrl = storedGreeting
    ? storedGreeting.startsWith("/")
      ? `${base}${storedGreeting}`
      : resolvePublicMediaUrl(storedGreeting)
    : null;

  const twiml = buildVoicemailTwiml({
    recordingStatusCallbackUrl: `${base}/api/webhooks/twilio/voice/recording`,
    transcribeCallbackUrl: transcribe
      ? `${base}/api/webhooks/twilio/voice/transcription`
      : null,
    greetingAudioUrl,
  });

  return new NextResponse(twiml, { status: 200, headers: { "Content-Type": "text/xml" } });
}
