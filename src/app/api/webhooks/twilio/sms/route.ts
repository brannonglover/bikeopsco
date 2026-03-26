import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  findCustomerIdBySmsFrom,
  findOrCreateConversationForInboundSms,
  getTwilioInboundWebhookUrl,
  validateTwilioWebhook,
} from "@/lib/chat-sms";
import { normalizePhone } from "@/lib/phone";

export const runtime = "nodejs";

/**
 * Twilio inbound SMS → customer chat message.
 * Configure on your Twilio number: Messaging → "A message comes in" →
 * POST https://YOUR_DOMAIN/api/webhooks/twilio/sms
 */
export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN not set");
    return new NextResponse("Configuration error", { status: 500 });
  }

  const rawBody = await request.text();
  const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<
    string,
    string
  >;

  const signature = request.headers.get("X-Twilio-Signature");
  const url = getTwilioInboundWebhookUrl(request);
  if (!validateTwilioWebhook(authToken, signature, url, params)) {
    console.warn("Twilio SMS webhook: invalid signature");
    return new NextResponse("Forbidden", { status: 403 });
  }

  const messageSid = params.MessageSid;
  const fromRaw = params.From;
  const toRaw = params.To;
  const bodyRaw = params.Body ?? "";
  const numMedia = parseInt(params.NumMedia ?? "0", 10) || 0;

  const fromE164 = fromRaw ? normalizePhone(fromRaw) : null;
  const toE164 = toRaw ? normalizePhone(toRaw) : null;
  const ourNumber = process.env.TWILIO_PHONE_NUMBER?.trim();
  const ourE164 = ourNumber ? normalizePhone(ourNumber) : null;

  if (ourE164 && toE164 && toE164 !== ourE164) {
    console.warn("Twilio SMS webhook: To does not match TWILIO_PHONE_NUMBER");
  }

  if (!messageSid || !fromE164) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  const existing = await prisma.message.findUnique({
    where: { smsSid: messageSid },
  });
  if (existing) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  let bodyText = bodyRaw.trim();
  if (!bodyText && numMedia > 0) {
    bodyText = "[Photo sent via SMS]";
  }
  if (!bodyText) {
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  const customerId = await findCustomerIdBySmsFrom(fromE164);
  if (!customerId) {
    console.warn("Twilio SMS: unknown sender", fromE164);
    return new NextResponse(
      '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  const conversation = await findOrCreateConversationForInboundSms(
    customerId
  );

  try {
    await prisma.message.create({
      data: {
        conversationId: conversation.id,
        sender: "CUSTOMER",
        body: bodyText,
        smsSid: messageSid,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { updatedAt: new Date(), customerTypingAt: null },
    });
  } catch (e) {
    console.error("Twilio SMS webhook: failed to save message", e);
    return new NextResponse("Error", { status: 500 });
  }

  return new NextResponse(
    '<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { "Content-Type": "text/xml" } }
  );
}
