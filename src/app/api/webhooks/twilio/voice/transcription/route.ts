import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { startAssistantCallOutreach } from "@/lib/ai/call-outreach";
import { authenticateVoiceWebhook } from "@/lib/voice";

export const runtime = "nodejs";

/**
 * transcribeCallback from the /voicemail <Record> verb. Arrives after
 * /recording — Twilio transcribes only once the audio is processed — so this
 * route never assumes it runs first and only touches transcription columns.
 *
 * A failed transcription is recorded rather than ignored: the app shows
 * "Transcript unavailable" and still offers playback, which beats a row that
 * sits on "Transcribing…" forever.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  if (!callSid) {
    return new NextResponse("ok", { status: 200 });
  }

  const status = params.TranscriptionStatus ?? "failed";
  const text = status === "completed" ? (params.TranscriptionText?.trim() || null) : null;

  await prisma.call.updateMany({
    where: { shopId: shop.id, twilioParentCallSid: callSid },
    data: {
      transcriptionStatus: status,
      transcriptionText: text,
    },
  });

  // Where the AI assistant picks up a voicemail. It waits for this callback
  // rather than the recording one so its first text can name what the caller
  // actually asked for — and this fires on a failed transcription too, so a
  // caller is still texted back when the audio couldn't be read.
  const call = await prisma.call.findFirst({
    where: { shopId: shop.id, twilioParentCallSid: callSid },
    select: { id: true },
  });
  if (call) {
    await startAssistantCallOutreach({
      shopId: shop.id,
      callId: call.id,
      trigger: "voicemail",
    });
  }

  return new NextResponse("ok", { status: 200 });
}
