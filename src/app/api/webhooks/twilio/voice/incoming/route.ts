import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerIdBySmsFrom } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import {
  INCOMING_CALL_CHANNEL_ID,
  INCOMING_CALL_SOUND,
  sendPushToAllStaff,
} from "@/lib/push";
import {
  authenticateVoiceWebhook,
  buildIncomingCallTwiml,
  buildQueueName,
  getVoiceWebhookBaseUrl,
} from "@/lib/voice";

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
  });

  const customer = customerId
    ? await prisma.customer.findUnique({
        where: { id: customerId },
        select: { firstName: true, lastName: true },
      })
    : null;
  const callerLabel = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
    : formatPhoneDisplay(fromE164);

  // This push *is* the ring — it has to go out before the TwiML response, or
  // the caller starts holding before any device has been told to wake up.
  await sendPushToAllStaff(shop.id, {
    title: "Incoming call",
    body: callerLabel,
    // Everything that makes this sound like a phone ringing rather than
    // another notification: its own tone, its own Android channel, and
    // priorities that keep a dozing phone or a Focus mode from sitting on it
    // until the caller has already been sent to voicemail.
    sound: INCOMING_CALL_SOUND,
    channelId: INCOMING_CALL_CHANNEL_ID,
    priority: "high",
    interruptionLevel: "time-sensitive",
    data: {
      type: "incoming_call",
      callId: call.id,
      callSid,
      from: fromE164,
      customerId,
      customerName: customer ? callerLabel : null,
    },
  }).catch((error) => {
    // A push failure must not take the call down — the caller should still
    // reach voicemail rather than hear an error.
    console.error("[voice] staff push for incoming call failed:", error);
  });

  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildIncomingCallTwiml({
    queueName: buildQueueName(shop.id),
    waitUrl: `${base}/api/webhooks/twilio/voice/wait`,
    actionUrl: `${base}/api/webhooks/twilio/voice/dequeued`,
  });

  return xmlResponse(twiml);
}
