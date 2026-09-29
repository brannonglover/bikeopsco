import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateVoiceWebhook, buildDequeuedTwiml, getVoiceWebhookBaseUrl } from "@/lib/voice";
import { cancelStaffLegs } from "@/lib/voice-legs";

export const runtime = "nodejs";

/**
 * <Enqueue action> — hit whenever the caller leaves the shop queue, with
 * QueueResult saying why. Answered calls end here too (after the bridge
 * finishes), which is exactly why this branches instead of unconditionally
 * sending everyone to voicemail.
 *
 * This is also where an inbound call's record is closed out. <Enqueue> takes
 * no statusCallback attribute — unlike the <Client> noun it replaced — so
 * without this the row never leaves IN_PROGRESS and the call log shows every
 * finished call as still in progress.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const queueResult = params.QueueResult;
  const callSid = params.CallSid;

  // The caller has left the queue, for whatever reason, so no device should
  // still be ringing for them. This covers the three endings the staff legs
  // themselves cannot see: the caller hung up while holding, the hold ran out,
  // or a decline redirected them. `bridged` is already swept — the leg that won
  // cancelled its siblings at the moment it claimed the call — and passing no
  // exception here is harmless, because cancelStaffLegs only touches legs that
  // are still live.
  const call = callSid
    ? await prisma.call.findUnique({
        where: {
          shopId_twilioParentCallSid: { shopId: shop.id, twilioParentCallSid: callSid },
        },
        select: { id: true },
      })
    : null;
  if (call) {
    await cancelStaffLegs(call.id).catch((error) => {
      // Each leg carries its own ring-window timeout, so a sweep that fails
      // still stops on its own rather than ringing indefinitely.
      console.error("[voice] could not cancel staff legs on dequeue:", error);
    });
  }

  // "leave" and "redirected" are on their way to voicemail, which stamps its
  // own terminal state — closing them here would race that.
  if (callSid && (queueResult === "bridged" || queueResult === "hangup")) {
    await prisma.call
      .updateMany({
        where: { shopId: shop.id, twilioParentCallSid: callSid, endedAt: null },
        data: {
          // A caller who hung up while holding was never answered; keeping the
          // distinction is what makes the log's missed/taken split honest.
          status: queueResult === "bridged" ? "COMPLETED" : "NO_ANSWER",
          endedAt: new Date(),
        },
      })
      .catch((error) => {
        console.error("[voice] /dequeued could not close the call:", error);
      });
  }

  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildDequeuedTwiml({
    queueResult,
    voicemailUrl: `${base}/api/webhooks/twilio/voice/voicemail`,
  });

  return new NextResponse(twiml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
