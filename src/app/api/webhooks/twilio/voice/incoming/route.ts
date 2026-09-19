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

  await prisma.call.upsert({
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

  // The first ring. It has to go out before the TwiML response, or the caller
  // starts holding before any device has been told to wake up; /wait keeps it
  // ringing from there.
  await ringStaffForCall(shop.id, callSid).catch((error) => {
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
