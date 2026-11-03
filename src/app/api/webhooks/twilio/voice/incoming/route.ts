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
} from "@/lib/voice";
import { ringStaffForHeldCaller } from "@/lib/voice-legs";
import { connectCallToVoiceAgent, isAiVoiceAnswering } from "@/lib/ai/voice-agent";

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Twilio inbound Voice webhook — configure on the shop's Twilio number:
 * Voice → "A call comes in" → POST https://YOUR_SHOP.bikeops.co/api/webhooks/twilio/voice/incoming
 *
 * With the AI phone assistant on, the call is handed to it. Otherwise — or if
 * the assistant can't be reached — the caller is parked in the shop queue and
 * staff are alerted with an ordinary push notification; tapping it dials them
 * into the queue. See buildIncomingCallTwiml for why this no longer dials
 * <Client> directly.
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

  // The AI assistant picks up first when the shop has it on. Staff are only
  // rung if the caller asks for a person (see /ai-handoff), or right here if
  // the assistant can't be reached — a caller must never get dead air because
  // ElevenLabs was slow.
  if (await isAiVoiceAnswering(shop.id)) {
    const agentTwiml = await connectCallToVoiceAgent({
      shopId: shop.id,
      callId: call.id,
      customerId,
      base,
      fromNumber: fromE164,
      toNumber: toE164,
      mode: "answer",
    });
    if (agentTwiml) {
      await prisma.call
        .update({
          where: { id: call.id },
          data: { status: "IN_PROGRESS", aiAnsweredAt: new Date() },
        })
        .catch((error) => {
          // The call is answered either way; a missing stamp only costs the log.
          console.error("[voice] could not mark call as AI-answered:", error);
        });
      return xmlResponse(agentTwiml);
    }
  }

  // Ringing has to start before the TwiML response, or the caller begins
  // holding before any device has been told to wake up.
  await ringStaffForHeldCaller({
    shopId: shop.id,
    callId: call.id,
    callSid,
    baseUrl: base,
    fromNumber: fromE164,
    customerName: call.customer
      ? [call.customer.firstName, call.customer.lastName].filter(Boolean).join(" ")
      : null,
  });

  const twiml = buildIncomingCallTwiml({
    queueName: buildQueueName(shop.id),
    waitUrl: `${base}/api/webhooks/twilio/voice/wait`,
    actionUrl: `${base}/api/webhooks/twilio/voice/dequeued`,
  });

  return xmlResponse(twiml);
}
