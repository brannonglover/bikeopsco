import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerIdBySmsFrom } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { normalizePhone } from "@/lib/phone";
import {
  authenticateVoiceWebhook,
  buildOutgoingCallTwiml,
  getVoiceWebhookBaseUrl,
  parseStaffIdentity,
  TWILIO_VOICE_NUMBER,
} from "@/lib/voice";

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function sorryTwiml(): NextResponse {
  return xmlResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this call could not be completed.</Say><Hangup/></Response>'
  );
}

/**
 * TwiML App Voice Request URL — hit when the mobile Voice SDK places an
 * outbound call via device.connect({ params: { To } }). Configure the same
 * shop-subdomain URL here as the number's /incoming webhook:
 * POST https://YOUR_SHOP.bikeops.co/api/webhooks/twilio/voice/outgoing
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  const identity = parseStaffIdentity((params.From ?? "").replace(/^client:/, ""));
  const toRaw = params.To;

  if (!callSid || !toRaw || !identity || identity.shopId !== shop.id || !TWILIO_VOICE_NUMBER) {
    console.warn("Twilio Voice /outgoing: rejecting call", {
      callSid,
      from: params.From,
      to: toRaw,
      shopId: shop.id,
    });
    return sorryTwiml();
  }

  const toE164 = normalizePhone(toRaw) ?? toRaw;
  const customerId = await findCustomerIdBySmsFrom(shop.id, toE164);
  const conversation = customerId
    ? await findOrCreateGeneralConversation(shop.id, customerId)
    : null;

  await prisma.call.upsert({
    where: { shopId_twilioParentCallSid: { shopId: shop.id, twilioParentCallSid: callSid } },
    create: {
      shopId: shop.id,
      customerId,
      conversationId: conversation?.id ?? null,
      direction: "OUTBOUND",
      status: "QUEUED",
      fromNumber: TWILIO_VOICE_NUMBER,
      toNumber: toE164,
      twilioParentCallSid: callSid,
      startedAt: new Date(),
    },
    update: {},
  });

  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildOutgoingCallTwiml({
    toNumber: toE164,
    callerId: TWILIO_VOICE_NUMBER,
    statusCallbackUrl: `${base}/api/webhooks/twilio/voice/status`,
  });

  return xmlResponse(twiml);
}
