import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  findCustomerIdBySmsFrom,
  findOrCreateConversationForInboundSms,
} from "@/lib/chat-sms";
import { normalizePhone } from "@/lib/phone";
import { sendPlainSms } from "@/lib/sms";
import { buildSmsConsentUpdate, parseSmsConsentKeyword } from "@/lib/sms-consent";
import { getShopForHost } from "@/lib/shop";

export const runtime = "nodejs";

const infobipInboundSchema = z.object({
  results: z
    .array(
      z.object({
        messageId: z.string(),
        from: z.string(),
        to: z.string().optional().nullable(),
        text: z.string().optional().nullable(),
        cleanText: z.string().optional().nullable(),
      })
    )
    .default([]),
});

function isAuthorized(request: NextRequest): boolean {
  const expected = process.env.INFOBIP_WEBHOOK_SECRET?.trim();
  if (!expected) return true;

  const url = new URL(request.url);
  const provided =
    request.headers.get("x-webhook-secret") ?? url.searchParams.get("secret");

  return provided === expected;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    console.warn("Infobip SMS webhook: invalid secret");
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const hostHeader =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const shop = await getShopForHost(hostHeader);
  if (!shop) {
    console.warn("Infobip SMS webhook: shop not found for host", hostHeader);
    return NextResponse.json({ received: true });
  }

  let payload: z.infer<typeof infobipInboundSchema>;
  try {
    payload = infobipInboundSchema.parse(await request.json());
  } catch (error) {
    console.warn("Infobip SMS webhook: invalid payload", error);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const configuredSender = process.env.INFOBIP_SENDER?.trim();
  const configuredSenderE164 = configuredSender
    ? normalizePhone(configuredSender)
    : null;

  try {
    for (const item of payload.results) {
      const fromE164 = normalizePhone(item.from);
      const toE164 = item.to ? normalizePhone(item.to) : null;

      if (configuredSenderE164 && toE164 && toE164 !== configuredSenderE164) {
        console.warn("Infobip SMS webhook: To does not match INFOBIP_SENDER");
      }

      if (!fromE164) {
        continue;
      }

      const existing = await prisma.message.findFirst({
        where: { shopId: shop.id, smsSid: item.messageId },
      });
      if (existing) {
        continue;
      }

      const bodyText = item.text?.trim() || item.cleanText?.trim() || "";
      if (!bodyText) {
        continue;
      }

      const customerId = await findCustomerIdBySmsFrom(shop.id, fromE164);
      if (!customerId) {
        console.warn("Infobip SMS: unknown sender", fromE164);
        continue;
      }

      const consentKeyword = parseSmsConsentKeyword(bodyText);
      if (consentKeyword === "stop") {
        await prisma.customer.updateMany({
          where: { id: customerId, shopId: shop.id },
          data: buildSmsConsentUpdate(false, "SMS_STOP"),
        });
        await sendPlainSms(
          fromE164,
          "You’re unsubscribed from repair update texts. You can still follow your repair by email or on your status page."
        ).catch((e) => console.error("Infobip STOP reply failed:", e));
        continue;
      }
      if (consentKeyword === "start") {
        await prisma.customer.updateMany({
          where: { id: customerId, shopId: shop.id },
          data: buildSmsConsentUpdate(true, "SMS_START"),
        });
        await sendPlainSms(
          fromE164,
          "Text updates are back on for your repair. Reply STOP to opt out."
        ).catch((e) => console.error("Infobip START reply failed:", e));
        continue;
      }
      if (consentKeyword === "help") {
        await sendPlainSms(
          fromE164,
          "Need help with your repair? Reply STOP to opt out. You can also contact the shop by email or check your status page."
        ).catch((e) => console.error("Infobip HELP reply failed:", e));
        continue;
      }

      const conversation = await findOrCreateConversationForInboundSms(
        shop.id,
        customerId
      );

      const message = await prisma.message.create({
        data: {
          shopId: shop.id,
          conversationId: conversation.id,
          sender: "CUSTOMER",
          body: bodyText,
          smsSid: item.messageId,
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
    }
  } catch (error) {
    console.error("Infobip SMS webhook: failed to save message", error);
    return NextResponse.json({ error: "Failed to save message" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
