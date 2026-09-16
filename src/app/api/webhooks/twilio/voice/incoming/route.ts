import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerIdBySmsFrom } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { normalizePhone } from "@/lib/phone";
import {
  authenticateVoiceWebhook,
  buildIncomingCallTwiml,
  getStaffIdentitiesForShop,
  getVoiceWebhookBaseUrl,
} from "@/lib/voice";

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * Twilio inbound Voice webhook — configure on the shop's Twilio number:
 * Voice → "A call comes in" → POST https://YOUR_SHOP.bikeops.co/api/webhooks/twilio/voice/incoming
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

  const identities = await getStaffIdentitiesForShop(shop.id);
  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildIncomingCallTwiml({
    identities,
    statusCallbackUrl: `${base}/api/webhooks/twilio/voice/status`,
    voicemailActionUrl: `${base}/api/webhooks/twilio/voice/voicemail`,
  });

  return xmlResponse(twiml);
}
