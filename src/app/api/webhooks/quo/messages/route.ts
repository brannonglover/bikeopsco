import { NextRequest, NextResponse } from "next/server";
import { SiteChatMessageSource, SiteChatSender } from "@prisma/client";
import { getQuoFromNumber, isSiteChatQuoRelayText } from "@/lib/quo";
import { normalizePhone } from "@/lib/phone";
import {
  findSiteChatConversationByPhone,
  phonesMatchForSiteChat,
  recordSiteChatMessage,
} from "@/lib/site-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type QuoWebhookEvent = {
  id?: string;
  type?: string;
  data?: {
    object?: {
      id?: string;
      object?: string;
      from?: string;
      to?: string[];
      direction?: string;
      text?: string;
      body?: string;
      status?: string;
    };
  };
};

function getWebhookSecret(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("secret")?.trim() || null;
}

function verifyQuoWebhookSecret(request: NextRequest): boolean {
  const expected = process.env.QUO_WEBHOOK_SECRET?.trim();
  if (!expected) return false;
  const provided = getWebhookSecret(request);
  return Boolean(provided && provided === expected);
}

function messageText(payload: QuoWebhookEvent): string {
  const obj = payload.data?.object;
  return (obj?.text ?? obj?.body ?? "").trim();
}

/**
 * Quo (OpenPhone) message webhooks → site chat widget sync.
 * Register via Quo API: POST /v1/webhooks/messages
 * URL: https://app.bikeops.co/api/webhooks/quo/messages?secret=YOUR_QUO_WEBHOOK_SECRET
 */
export async function POST(request: NextRequest) {
  if (!verifyQuoWebhookSecret(request)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  let payload: QuoWebhookEvent;
  try {
    payload = (await request.json()) as QuoWebhookEvent;
  } catch {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const eventType = payload.type ?? "";
  if (!eventType.startsWith("message.")) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const msg = payload.data?.object;
  if (!msg || msg.object !== "message") {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const quoMessageId = msg.id?.trim();
  const text = messageText(payload);
  if (!quoMessageId || !text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const ourNumber = getQuoFromNumber();
  const fromE164 = msg.from ? normalizePhone(msg.from) : null;
  const toNumbers = (msg.to ?? [])
    .map((n) => normalizePhone(n))
    .filter((n): n is string => Boolean(n));

  const direction = (msg.direction ?? "").toLowerCase();
  const isIncoming = direction === "incoming";
  const isOutgoing = direction === "outgoing";

  if (isOutgoing && isSiteChatQuoRelayText(text)) {
    return NextResponse.json({ ok: true, ignored: "relay_echo" });
  }

  let visitorPhone: string | null = null;
  let sender: SiteChatSender | null = null;

  if (isIncoming && fromE164) {
    if (ourNumber && phonesMatchForSiteChat(fromE164, ourNumber)) {
      return NextResponse.json({ ok: true, ignored: "from_shop_line" });
    }
    visitorPhone = fromE164;
    sender = SiteChatSender.VISITOR;
  } else if (isOutgoing && toNumbers.length > 0) {
    const visitorTo = toNumbers.find(
      (n) => !ourNumber || !phonesMatchForSiteChat(n, ourNumber)
    );
    if (!visitorTo) {
      return NextResponse.json({ ok: true, ignored: "no_visitor_recipient" });
    }
    visitorPhone = visitorTo;
    sender = SiteChatSender.STAFF;
  } else {
    return NextResponse.json({ ok: true, ignored: "unknown_direction" });
  }

  const conversation = await findSiteChatConversationByPhone(visitorPhone);
  if (!conversation) {
    return NextResponse.json({ ok: true, ignored: "no_conversation" });
  }

  await recordSiteChatMessage({
    conversationId: conversation.id,
    sender,
    body: text,
    source: SiteChatMessageSource.QUO,
    quoMessageId,
  });

  return NextResponse.json({ ok: true });
}
