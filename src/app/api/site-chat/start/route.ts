import { NextRequest, NextResponse } from "next/server";
import { SiteChatMessageSource, SiteChatSender } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import {
  createSiteChatSessionToken,
  findSiteChatBySessionToken,
  recordSiteChatMessage,
  relayVisitorMessageToQuo,
  toSiteChatMessageDto,
} from "@/lib/site-chat";
import { sendSiteChatLeadNotification } from "@/lib/email";
import { siteChatOptionsResponse, withSiteChatCors } from "@/lib/site-chat-cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const startSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(30),
  message: z.string().trim().min(1).max(2000),
  smsConsent: z.boolean(),
  sessionToken: z.string().trim().min(16).max(128).optional(),
  website: z.string().max(200).optional(),
});

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return siteChatOptionsResponse(origin);
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const body = await request.json();
    const data = startSchema.parse(body);

    if (!data.smsConsent) {
      return withSiteChatCors(
        NextResponse.json(
          { error: "SMS consent is required to use chat." },
          { status: 400 }
        ),
        origin
      );
    }

    const phoneE164 = normalizePhone(data.phone);
    if (!phoneE164) {
      return withSiteChatCors(
        NextResponse.json({ error: "Enter a valid mobile phone number." }, { status: 400 }),
        origin
      );
    }

    if (data.website?.trim()) {
      return withSiteChatCors(NextResponse.json({ ok: true }, { status: 200 }), origin);
    }

    let sessionToken = data.sessionToken?.trim() || "";
    let conversation = sessionToken
      ? await findSiteChatBySessionToken(sessionToken)
      : null;

    if (conversation && conversation.visitorPhone !== phoneE164) {
      sessionToken = "";
      conversation = null;
    }

    if (!conversation) {
      sessionToken = createSiteChatSessionToken();
      conversation = await prisma.siteChatConversation.create({
        data: {
          sessionToken,
          visitorName: data.name,
          visitorPhone: phoneE164,
          smsConsent: true,
          smsConsentAt: new Date(),
        },
      });
    } else {
      await prisma.siteChatConversation.update({
        where: { id: conversation.id },
        data: {
          visitorName: data.name,
          smsConsent: true,
          smsConsentAt: conversation.smsConsentAt ?? new Date(),
        },
      });
    }

    const visitorMessage = await recordSiteChatMessage({
      conversationId: conversation.id,
      sender: SiteChatSender.VISITOR,
      body: data.message,
      source: SiteChatMessageSource.WIDGET,
    });

    const relay = await relayVisitorMessageToQuo({
      visitorName: data.name,
      visitorPhoneE164: phoneE164,
      body: data.message,
    });

    if (relay.quoMessageId) {
      await prisma.siteChatMessage.update({
        where: { id: visitorMessage.id },
        data: { quoMessageId: relay.quoMessageId },
      });
    }

    void sendSiteChatLeadNotification({
      visitorName: data.name,
      visitorPhone: phoneE164,
      message: data.message,
      quoRelayed: Boolean(relay.quoMessageId),
      quoError: relay.error,
    });

    return withSiteChatCors(
      NextResponse.json({
        sessionToken,
        conversationId: conversation.id,
        messages: [toSiteChatMessageDto(visitorMessage)],
        quoRelayed: Boolean(relay.quoMessageId),
        quoError: relay.error,
      }),
      origin
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return withSiteChatCors(
        NextResponse.json({ error: "Invalid request." }, { status: 400 }),
        origin
      );
    }
    console.error("site-chat start:", err);
    return withSiteChatCors(
      NextResponse.json({ error: "Could not start chat." }, { status: 500 }),
      origin
    );
  }
}
