import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { formatPhoneDisplay } from "@/lib/phone";
import { sendPushToAllStaff } from "@/lib/push";
import {
  authenticateVoiceWebhook,
  buildDialedTwiml,
  getVoiceWebhookBaseUrl,
} from "@/lib/voice";

export const runtime = "nodejs";

function xmlResponse(xml: string): NextResponse {
  return new NextResponse(xml, { status: 200, headers: { "Content-Type": "text/xml" } });
}

/**
 * The <Dial> action URL from /incoming, reached once the ring ends however it
 * ended — answered, declined by every device, timed out, or nobody reachable.
 *
 * It exists to do two things an unanswered call needs: send the caller to
 * voicemail, and tell staff they missed someone. The missed-call notification
 * lives here rather than at ring time because CallKit does the ringing now;
 * raising a second alert while the phone is already ringing would only be
 * noise, whereas after the fact it is the only record staff get.
 */
export async function POST(request: NextRequest) {
  const ctx = await authenticateVoiceWebhook(request);
  if (ctx instanceof NextResponse) return ctx;
  const { shop, params } = ctx;

  const callSid = params.CallSid;
  const dialCallStatus = params.DialCallStatus;
  const base = getVoiceWebhookBaseUrl(request);
  const twiml = buildDialedTwiml({
    dialCallStatus,
    voicemailUrl: `${base}/api/webhooks/twilio/voice/voicemail`,
  });

  const answered = dialCallStatus === "completed" || dialCallStatus === "answered";
  if (answered || !callSid) return xmlResponse(twiml);

  // Name the caller if we know them. The Call row was written by /incoming, so
  // this costs one query rather than a second phone-number lookup.
  const call = await prisma.call
    .findUnique({
      where: { shopId_twilioParentCallSid: { shopId: shop.id, twilioParentCallSid: callSid } },
      select: {
        id: true,
        fromNumber: true,
        customerId: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    })
    .catch(() => null);

  if (!call) return xmlResponse(twiml);

  const name = call.customer
    ? [call.customer.firstName, call.customer.lastName].filter(Boolean).join(" ")
    : "";
  const callerLabel = name || formatPhoneDisplay(call.fromNumber);

  // Ordinary notification settings on purpose: the ring already happened and
  // was missed, so this is a record, not another attempt to get attention.
  await sendPushToAllStaff(shop.id, {
    title: "Missed call",
    body: callerLabel,
    data: {
      type: "missed_call",
      callId: call.id,
      callSid,
      from: call.fromNumber,
      customerId: call.customerId,
      customerName: name || null,
    },
  }).catch((error) => {
    // Never let a failed notification cost the caller their voicemail.
    console.error("[voice] missed-call push failed:", error);
  });

  return xmlResponse(twiml);
}
