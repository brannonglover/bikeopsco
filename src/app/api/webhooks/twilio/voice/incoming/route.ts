import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerIdBySmsFrom } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { normalizePhone } from "@/lib/phone";
import {
  authenticateVoiceWebhook,
  buildIncomingCallTwiml,
  buildQueueName,
  getVoiceWebhookBaseUrl,
  ringStaffForCall,
} from "@/lib/voice";
import { fanOutStaffLegs, isNativeRingEnabled } from "@/lib/voice-legs";

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Twilio inbound Voice webhook — configure on the shop's Twilio number:
 * Voice → "A call comes in" → POST https://YOUR_SHOP.bikeops.co/api/webhooks/twilio/voice/incoming
 *
 * The caller is parked in the shop queue and staff are alerted with an
 * ordinary push notification; tapping it dials them into the queue. See
 * buildIncomingCallTwiml for why this no longer dials <Client> directly.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  const fromRaw = params.From;
  const toRaw = params.To;
  if (!callSid || !fromRaw || !toRaw) {
    return xmlResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this call could not be completed.</Say><Hangup/></Response>'
    );
  }

  const fromE164 = normalizePhone(fromRaw) ?? fromRaw;
  const toE164 = normalizePhone(toRaw) ?? toRaw;

  const customerId = await findCustomerIdBySmsFrom(shop.id, fromE164);
  const conversation = customerId
    ? await findOrCreateGeneralConversation(shop.id, customerId)
    : null;

  const call = await prisma.call.upsert({
    where: { shopId_twilioParentCallSid: { shopId: shop.id, twilioParentCallSid: callSid } },
    create: {
      shopId: shop.id,
      customerId,
      conversationId: conversation?.id ?? null,
      direction: "INBOUND",
      status: "RINGING",
      fromNumber: fromE164,
      toNumber: toE164,
      twilioParentCallSid: callSid,
      startedAt: new Date(),
    },
    update: {},
    select: {
      id: true,
      customer: { select: { firstName: true, lastName: true } },
    },
  });

  const base = getVoiceWebhookBaseUrl(request);

  // Ringing has to start before the TwiML response, or the caller begins
  // holding before any device has been told to wake up.
  if (await isNativeRingEnabled(shop.id)) {
    // One real Twilio invite per device: the OS rings it, continuously, until
    // somebody acts. Nothing repeats it, and nothing here has to stop it —
    // /staff-answer and /dequeued own cancellation between them.
    const customerName = call.customer
      ? [call.customer.firstName, call.customer.lastName].filter(Boolean).join(" ")
      : null;
    await fanOutStaffLegs({
      shopId: shop.id,
      callId: call.id,
      baseUrl: base,
      fromNumber: fromE164,
      customerName,
    }).catch((error) => {
      // A fan-out failure must not take the call down — the caller should still
      // reach voicemail rather than hear an error.
      console.error("[voice] could not ring staff for incoming call:", error);
    });
  } else {
    // The previous path: one notification now, repeated by /wait for as long as
    // the caller holds. Kept as the rollback while the invite path is proven.
    await ringStaffForCall(shop.id, callSid).catch((error) => {
      console.error("[voice] staff push for incoming call failed:", error);
    });
  }

  const twiml = buildIncomingCallTwiml({
    queueName: buildQueueName(shop.id),
    waitUrl: `${base}/api/webhooks/twilio/voice/wait`,
    actionUrl: `${base}/api/webhooks/twilio/voice/dequeued`,
  });

  return xmlResponse(twiml);
}
