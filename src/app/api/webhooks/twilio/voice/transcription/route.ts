import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
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

  return new NextResponse("ok", { status: 200 });
}
