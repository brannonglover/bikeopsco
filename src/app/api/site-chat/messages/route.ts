import { NextRequest, NextResponse } from "next/server";
import { SiteChatMessageSource, SiteChatSender } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import {
  findSiteChatBySessionToken,
  recordSiteChatMessage,
  relayVisitorMessageToQuo,
  toSiteChatMessageDto,
} from "@/lib/site-chat";
import { siteChatOptionsResponse, withSiteChatCors } from "@/lib/site-chat-cors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const postSchema = z.object({
  sessionToken: z.string().trim().min(16).max(128),
  body: z.string().trim().min(1).max(2000),
  website: z.string().max(200).optional(),
});

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  return siteChatOptionsResponse(origin);
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const sessionToken = request.nextUrl.searchParams.get("sessionToken")?.trim() ?? "";
  const since = request.nextUrl.searchParams.get("since")?.trim() ?? "";

  if (!sessionToken) {
    return withSiteChatCors(
      NextResponse.json({ error: "sessionToken is required." }, { status: 400 }),
      origin
    );
  }

  const conversation = await findSiteChatBySessionToken(sessionToken);
  if (!conversation) {
    return withSiteChatCors(
      NextResponse.json({ error: "Conversation not found." }, { status: 404 }),
      origin
    );
  }

  const sinceDate = since ? new Date(since) : null;
  const messages = await prisma.siteChatMessage.findMany({
    where: {
      conversationId: conversation.id,
      ...(sinceDate && !Number.isNaN(sinceDate.getTime())
        ? { createdAt: { gt: sinceDate } }
        : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  return withSiteChatCors(
    NextResponse.json({
      messages: messages.map(toSiteChatMessageDto),
    }),
    origin
  );
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");

  try {
    const json = await request.json();
    const data = postSchema.parse(json);

    if (data.website?.trim()) {
      return withSiteChatCors(NextResponse.json({ ok: true }, { status: 200 }), origin);
    }

    const conversation = await findSiteChatBySessionToken(data.sessionToken);
    if (!conversation) {
      return withSiteChatCors(
        NextResponse.json({ error: "Conversation not found." }, { status: 404 }),
        origin
      );
    }

    if (!conversation.smsConsent) {
      return withSiteChatCors(
        NextResponse.json({ error: "SMS consent is required." }, { status: 400 }),
        origin
      );
    }

    const visitorMessage = await recordSiteChatMessage({
      conversationId: conversation.id,
      sender: SiteChatSender.VISITOR,
      body: data.body,
      source: SiteChatMessageSource.WIDGET,
    });

    const relay = await relayVisitorMessageToQuo({
      visitorName: conversation.visitorName,
      visitorPhoneE164: conversation.visitorPhone,
      body: data.body,
    });

    if (relay.quoMessageId) {
      await prisma.siteChatMessage.update({
        where: { id: visitorMessage.id },
        data: { quoMessageId: relay.quoMessageId },
      });
    }

    return withSiteChatCors(
      NextResponse.json({
        message: toSiteChatMessageDto(visitorMessage),
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
    console.error("site-chat messages POST:", err);
    return withSiteChatCors(
      NextResponse.json({ error: "Could not send message." }, { status: 500 }),
      origin
    );
  }
}
