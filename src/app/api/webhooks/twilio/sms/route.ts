import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  findCustomerIdBySmsFrom,
  findOrCreateCustomerIdForInboundSms,
  findOrCreateConversationForInboundSms,
  getTwilioInboundWebhookUrl,
  importTwilioInboundMedia,
  parseTwilioInboundMedia,
  validateTwilioWebhook,
} from "@/lib/chat-sms";
import { formatPhoneDisplay, normalizePhone } from "@/lib/phone";
import {
  buildSmsConsentUpdate,
  parseSmsConsentKeyword,
  SMS_CONSENT_NEVER_SET,
  SMS_CONSENT_SOURCES,
} from "@/lib/sms-consent";
import { sendPushToAllStaff } from "@/lib/push";
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
 * Twilio inbound SMS/MMS → customer chat message.
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

  const bodyText = bodyRaw.trim();
  const mediaItems = parseTwilioInboundMedia(params);
  const hasMedia = numMedia > 0 || mediaItems.length > 0;

  if (!bodyText && !hasMedia) {
    return twimlMessage();
  }

  const knownCustomerId = await findCustomerIdBySmsFrom(shop.id, fromE164);

  // Keyword-only texts are answered without touching the customer table. A
  // STOP or HELP from a number we don't know — a wrong number, or a stale
  // forward — must not leave a profile behind just to record it.
  const consentKeyword = bodyText ? parseSmsConsentKeyword(bodyText) : null;
  if (consentKeyword === "stop") {
    if (knownCustomerId) {
      await prisma.customer.updateMany({
        where: { id: knownCustomerId, shopId: shop.id },
        data: buildSmsConsentUpdate(false, SMS_CONSENT_SOURCES.SMS_STOP),
      });
    }
    return twimlMessage(
      "You’re unsubscribed from repair update texts. You can still follow your repair by email or on your status page."
    );
  }
  if (consentKeyword === "start") {
    if (knownCustomerId) {
      await prisma.customer.updateMany({
        where: { id: knownCustomerId, shopId: shop.id },
        data: buildSmsConsentUpdate(true, SMS_CONSENT_SOURCES.SMS_START),
      });
    }
    return twimlMessage(
      "Text updates are back on for your repair. Reply STOP to opt out."
    );
  }
  if (consentKeyword === "help") {
    return twimlMessage(
      "Need help with your repair? Reply STOP to opt out. You can also contact the shop by email or check your status page."
    );
  }

  // Media is imported before the sender is resolved: an MMS whose only media is
  // unusable is dropped below, and an unknown sender must not leave an empty
  // profile behind for a message that never gets saved.
  const importedAttachments = await importTwilioInboundMedia(
    shop.id,
    mediaItems
  );
  if (!bodyText && importedAttachments.length === 0) {
    console.warn("Twilio MMS: no usable media in inbound message", messageSid);
    return twimlMessage();
  }

  // A first text from a number that isn't on file is how new customers reach the
  // shop, so create the profile rather than dropping the message.
  let customerId = knownCustomerId;
  let isNewCustomer = false;
  if (!customerId) {
    const resolved = await findOrCreateCustomerIdForInboundSms(
      shop.id,
      fromE164
    );
    customerId = resolved.customerId;
    isNewCustomer = resolved.created;
  }

  // A customer who texts us first has given prior express consent to be answered
  // about their repair, so record it — otherwise a phone-booked customer who texts
  // in still can't be sent an update. Scoped to SMS_CONSENT_NEVER_SET so a prior
  // STOP is not reversed by this message; that path stays START-only.
  // Newly created profiles already carry INBOUND_SMS consent.
  if (!isNewCustomer) {
    await prisma.customer.updateMany({
      where: { id: customerId, shopId: shop.id, ...SMS_CONSENT_NEVER_SET },
      data: buildSmsConsentUpdate(true, SMS_CONSENT_SOURCES.INBOUND_SMS),
    });
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
        body: bodyText || null,
        smsSid: messageSid,
        attachments: importedAttachments.length
          ? {
              connect: importedAttachments.map((attachment) => ({
                id: attachment.id,
              })),
            }
          : undefined,
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

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { firstName: true, lastName: true },
    });
    const customerName =
      [customer?.firstName, customer?.lastName].filter(Boolean).join(" ") ||
      formatPhoneDisplay(fromE164);
    const pushBody = bodyText?.trim() || "Sent a photo";
    await sendPushToAllStaff(shop.id, {
      title: isNewCustomer
        ? `New message from ${customerName} (new contact)`
        : `New message from ${customerName}`,
      body: pushBody,
      data: { type: "new_message", conversationId: conversation.id },
    }).catch((err) => console.error("Push notify staff:", err));
  } catch (e) {
    console.error("Twilio SMS webhook: failed to save message", e);
    return new NextResponse("Error", { status: 500 });
  }

  return twimlMessage();
}
