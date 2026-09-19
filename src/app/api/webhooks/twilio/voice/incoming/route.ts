import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { findCustomerIdBySmsFrom } from "@/lib/chat-sms";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
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
 *
 * Rings every registered staff device as a real call: <Dial><Client> makes
 * Twilio send a VoIP push, which the app hands to CallKit. See
 * buildIncomingCallTwiml for why that is now the point rather than the thing
 * being avoided, and /dialed for where an unanswered call ends up.
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

  // Named while the phone is still ringing: <Parameter> is the only channel to
  // the device before it answers, so this is what puts a customer's name on
  // the CallKit screen instead of a bare number.
  const customer = customerId
    ? await prisma.customer.findUnique({
        where: { id: customerId },
        select: { firstName: true, lastName: true },
      })
    : null;
  const customerName = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
    : "";

  // Twilio rings the devices itself from here on, so nothing is sent over the
  // ordinary notification channel: a second alert alongside the CallKit screen
  // is noise. The "missed call" push is raised in /dialed instead, once the
  // ring is over and there is actually something to report.
  const base = getVoiceWebhookBaseUrl(request);
  const identities = await getStaffIdentitiesForShop(shop.id);
  if (identities.length === 0) {
    console.warn(
      `[voice] No staff identities for shop ${shop.id} — the caller goes straight to voicemail.`
    );
  }

  const twiml = buildIncomingCallTwiml({
    clientIdentities: identities,
    actionUrl: `${base}/api/webhooks/twilio/voice/dialed`,
    voicemailUrl: `${base}/api/webhooks/twilio/voice/voicemail`,
    clientParameters: {
      callId: call.id,
      customerName: customerName || formatPhoneDisplay(fromE164),
    },
  });

  return xmlResponse(twiml);
}
