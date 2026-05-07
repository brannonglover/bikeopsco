import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  findCustomerIdBySmsFrom,
  findOrCreateConversationForInboundSms,
  getTwilioInboundWebhookUrl,
  validateTwilioWebhook,
} from "@/lib/chat-sms";
import { normalizePhone } from "@/lib/phone";
import { buildSmsConsentUpdate, parseSmsConsentKeyword } from "@/lib/sms-consent";
import { getShopForHost } from "@/lib/shop";

export const runtime = "nodejs";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twimlMessage(body?: string): NextResponse {
  const xml = body?.trim()
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(body)}</Message></Response>`
    : '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

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

  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const shop = await getShopForHost(hostHeader);
  if (!shop) {
    console.warn("Twilio SMS webhook: shop not found for host", hostHeader);
    return twimlMessage();
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
    return twimlMessage();
  }

  const existing = await prisma.message.findFirst({
    where: { shopId: shop.id, smsSid: messageSid },
  });
  if (existing) {
    return twimlMessage();
  }

  let bodyText = bodyRaw.trim();
  if (!bodyText && numMedia > 0) {
    bodyText = "[Photo sent via SMS]";
  }
  if (!bodyText) {
    return twimlMessage();
  }

  const customerId = await findCustomerIdBySmsFrom(shop.id, fromE164);
  if (!customerId) {
    console.warn("Twilio SMS: unknown sender", fromE164);
    return twimlMessage();
  }

  const consentKeyword = parseSmsConsentKeyword(bodyText);
  if (consentKeyword === "stop") {
    await prisma.customer.updateMany({
      where: { id: customerId, shopId: shop.id },
      data: buildSmsConsentUpdate(false, "SMS_STOP"),
    });
    return twimlMessage(
      "You’re unsubscribed from repair update texts. You can still follow your repair by email or on your status page."
    );
  }
  if (consentKeyword === "start") {
    await prisma.customer.updateMany({
      where: { id: customerId, shopId: shop.id },
      data: buildSmsConsentUpdate(true, "SMS_START"),
    });
    return twimlMessage(
      "Text updates are back on for your repair. Reply STOP to opt out."
    );
  }
  if (consentKeyword === "help") {
    return twimlMessage(
      "Need help with your repair? Reply STOP to opt out. You can also contact the shop by email or check your status page."
    );
  }

  const conversation = await findOrCreateConversationForInboundSms(
    shop.id,
    customerId
  );

  try {
    const message = await prisma.message.create({
      data: {
        shopId: shop.id,
        conversationId: conversation.id,
        sender: "CUSTOMER",
        body: bodyText,
        smsSid: messageSid,
      },
    });

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        updatedAt: new Date(),
        customerTypingAt: null,
        customerLastReadAt: message.createdAt,
      },
    });
  } catch (e) {
    console.error("Twilio SMS webhook: failed to save message", e);
    return new NextResponse("Error", { status: 500 });
  }

  return twimlMessage();
}
