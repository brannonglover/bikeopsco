import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateVoiceWebhook } from "@/lib/voice";

export const runtime = "nodejs";

/**
 * <Queue url> — runs on the caller's leg the moment staff bridge in, and is
 * the only precise "answered" signal in the queue model.
 *
 * The caller's leg goes in-progress as soon as Twilio picks up to enqueue
 * them, long before anyone answers, so /status deliberately does not stamp
 * answeredAt from that. Without this hook every voicemail would be logged as
 * a taken call.
 *
 * Returns an empty document: the caller is about to be connected and should
 * hear the shop, not an announcement.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  if (callSid) {
    await prisma.call
      .updateMany({
        where: { shopId: shop.id, twilioParentCallSid: callSid, answeredAt: null },
        data: { answeredAt: new Date(), status: "IN_PROGRESS" },
      })
      .catch((error) => {
        // Never block the bridge on a bookkeeping failure.
        console.error("[voice] /answered could not stamp the call:", error);
      });
  }

  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response/>', {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
