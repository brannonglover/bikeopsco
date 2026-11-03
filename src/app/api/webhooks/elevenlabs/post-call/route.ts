import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { verifyElevenLabsSignature } from "@/lib/ai/voice-agent";
import { fileVoiceAgentConversation, type PostCallEvent } from "@/lib/ai/voice-call-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ElevenLabs post-call webhook: one request per finished conversation with
 * the phone assistant, carrying its transcript.
 *
 * Answered straight away and filed afterwards — reading the transcript takes a
 * model call, and ElevenLabs treats a slow webhook as a failed one.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!verifyElevenLabsSignature(rawBody, request.headers.get("elevenlabs-signature"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: PostCallEvent;
  try {
    event = JSON.parse(rawBody) as PostCallEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Audio and call-failure events are subscribed to separately; only the
  // transcript is filed.
  if (event.type === "post_call_transcription") {
    waitUntil(fileVoiceAgentConversation(event));
  }

  return NextResponse.json({ ok: true });
}
