import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateVoiceWebhook, mapTwilioCallStatus } from "@/lib/voice";

export const runtime = "nodejs";

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "BUSY",
  "FAILED",
  "NO_ANSWER",
  "CANCELED",
  "VOICEMAIL",
]);

/**
 * Shared status callback for both call legs. Twilio sends this both for the
 * parent leg (set as the number's/TwiML App's console-level Status Callback)
 * and for the child leg created by <Dial> (set via the statusCallback
 * attribute in voice.ts's TwiML builders) — disambiguated below by whether
 * ParentCallSid is present, per the call-leg correlation design.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  const parentCallSid = params.ParentCallSid || null;
  const status = mapTwilioCallStatus(params.CallStatus);
  if (!callSid || !status) {
    return new NextResponse("ok", { status: 200 });
  }

  const call = await prisma.call.findFirst({
    where: parentCallSid
      ? { shopId: shop.id, twilioParentCallSid: parentCallSid }
      : { shopId: shop.id, twilioParentCallSid: callSid },
  });
  if (!call) {
    console.warn("Twilio Voice /status: no matching Call", { callSid, parentCallSid });
    return new NextResponse("ok", { status: 200 });
  }

  if (TERMINAL_STATUSES.has(call.status) && call.endedAt) {
    // Already reached a terminal state — don't let a stray late callback
    // (e.g. the parent leg's own "completed" arriving after the child leg's)
    // regress duration/timestamps.
    return new NextResponse("ok", { status: 200 });
  }

  const now = new Date();
  const durationSeconds = params.CallDuration ? parseInt(params.CallDuration, 10) : undefined;

  await prisma.call.update({
    where: { id: call.id },
    data: {
      status,
      twilioChildCallSid:
        parentCallSid && !call.twilioChildCallSid ? callSid : call.twilioChildCallSid,
      startedAt: call.startedAt ?? now,
      answeredAt: status === "IN_PROGRESS" ? (call.answeredAt ?? now) : call.answeredAt,
      endedAt: TERMINAL_STATUSES.has(status) ? now : call.endedAt,
      durationSeconds:
        TERMINAL_STATUSES.has(status) && durationSeconds !== undefined
          ? durationSeconds
          : call.durationSeconds,
    },
  });

  return new NextResponse("ok", { status: 200 });
}
