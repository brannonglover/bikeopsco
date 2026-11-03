import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  authenticateVoiceWebhook,
  buildIncomingCallTwiml,
  buildQueueName,
  getVoiceWebhookBaseUrl,
} from "@/lib/voice";
import { ringStaffForHeldCaller } from "@/lib/voice-legs";

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Where a caller lands when the AI assistant hands them to staff. Reached by a
 * REST redirect from /api/webhooks/elevenlabs/transfer, which ends the stream
 * to the assistant and runs this document instead.
 *
 * From here the call is an ordinary held caller: parked in the shop queue
 * while staff are rung, exactly as /incoming does it. If nobody picks up,
 * /dequeued sends them back to the assistant to take a message rather than to
 * voicemail.
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
        select: {
          id: true,
          fromNumber: true,
          customer: { select: { firstName: true, lastName: true } },
        },
      })
    : null;

  if (!call || !callSid) {
    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${base}/api/webhooks/twilio/voice/voicemail</Redirect></Response>`
    );
  }

  // The ring window is measured from startedAt everywhere — the push that
  // tells the app how long is left, /outgoing choosing who to bridge, and
  // /staff-answer refusing a late leg. For this call that clock starts now,
  // not when the assistant picked up minutes ago, or staff would be told the
  // caller had already rung out. The real start stays on aiAnsweredAt.
  await prisma.call.update({
    where: { id: call.id },
    data: { status: "RINGING", startedAt: new Date(), aiHandoffAt: new Date() },
  });

  await ringStaffForHeldCaller({
    shopId: shop.id,
    callId: call.id,
    callSid,
    baseUrl: base,
    fromNumber: call.fromNumber,
    customerName: call.customer
      ? [call.customer.firstName, call.customer.lastName].filter(Boolean).join(" ")
      : null,
  });

  return xmlResponse(
    buildIncomingCallTwiml({
      queueName: buildQueueName(shop.id),
      waitUrl: `${base}/api/webhooks/twilio/voice/wait`,
      actionUrl: `${base}/api/webhooks/twilio/voice/dequeued`,
    })
  );
}
