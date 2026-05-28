import { SiteChatMessageSource, SiteChatSender } from "@prisma/client";
import { getQuoFromNumber, isSiteChatQuoRelayText } from "@/lib/quo";
import { normalizePhone } from "@/lib/phone";
import {
  findSiteChatConversationByPhone,
  phonesMatchForSiteChat,
  recordSiteChatMessage,
} from "@/lib/site-chat";

export type QuoMessageWebhookPayload = {
  id?: string;
  type?: string;
  data?: {
    object?: QuoMessageObject;
  };
};

export type QuoMessageObject = {
  id?: string;
  object?: string;
  from?: string;
  to?: string | string[];
  direction?: string;
  text?: string;
  body?: string;
  status?: string;
  phoneNumberId?: string;
};

function messageText(msg: QuoMessageObject): string {
  return (msg.text ?? msg.body ?? "").trim();
}

function normalizeToList(to: string | string[] | undefined): string[] {
  if (!to) return [];
  const list = Array.isArray(to) ? to : [to];
  return list
    .map((n) => normalizePhone(n))
    .filter((n): n is string => Boolean(n));
}

function isMessageOnBusinessLine(msg: QuoMessageObject): boolean {
  const expectedPhoneNumberId = process.env.QUO_PHONE_NUMBER_ID?.trim();
  if (expectedPhoneNumberId && msg.phoneNumberId) {
    return msg.phoneNumberId === expectedPhoneNumberId;
  }

  const ourNumber = getQuoFromNumber();
  if (!ourNumber || ourNumber.startsWith("PN")) return true;

  const fromE164 = msg.from ? normalizePhone(msg.from) : null;
  const toNumbers = normalizeToList(msg.to);

  if (fromE164 && phonesMatchForSiteChat(fromE164, ourNumber)) return true;
  return toNumbers.some((n) => phonesMatchForSiteChat(n, ourNumber));
}

export type ProcessQuoMessageWebhookResult =
  | { ok: true; action: "stored" | "ignored"; reason?: string }
  | { ok: false; error: string };

export async function processQuoMessageWebhook(
  payload: QuoMessageWebhookPayload
): Promise<ProcessQuoMessageWebhookResult> {
  const eventType = payload.type ?? "";
  if (!eventType.startsWith("message.")) {
    return { ok: true, action: "ignored", reason: "not_message_event" };
  }

  const msg = payload.data?.object;
  if (!msg || msg.object !== "message") {
    return { ok: true, action: "ignored", reason: "not_message_object" };
  }

  if (!isMessageOnBusinessLine(msg)) {
    return { ok: true, action: "ignored", reason: "wrong_phone_number" };
  }

  const quoMessageId = msg.id?.trim();
  const text = messageText(msg);
  if (!quoMessageId || !text) {
    return { ok: true, action: "ignored", reason: "missing_id_or_text" };
  }

  const ourNumber = getQuoFromNumber();
  const fromE164 = msg.from ? normalizePhone(msg.from) : null;
  const toNumbers = normalizeToList(msg.to);

  const direction = (msg.direction ?? "").toLowerCase();
  const isIncoming = direction === "incoming";
  const isOutgoing = direction === "outgoing";

  if (isOutgoing && isSiteChatQuoRelayText(text)) {
    return { ok: true, action: "ignored", reason: "relay_echo" };
  }

  let visitorPhone: string | null = null;
  let sender: SiteChatSender | null = null;

  if (isIncoming && fromE164) {
    if (ourNumber && phonesMatchForSiteChat(fromE164, ourNumber)) {
      return { ok: true, action: "ignored", reason: "from_shop_line" };
    }
    visitorPhone = fromE164;
    sender = SiteChatSender.VISITOR;
  } else if (isOutgoing && toNumbers.length > 0) {
    const visitorTo = toNumbers.find(
      (n) => !ourNumber || !phonesMatchForSiteChat(n, ourNumber)
    );
    if (!visitorTo) {
      return { ok: true, action: "ignored", reason: "no_visitor_recipient" };
    }
    visitorPhone = visitorTo;
    sender = SiteChatSender.STAFF;
  } else {
    return { ok: true, action: "ignored", reason: "unknown_direction" };
  }

  const conversation = await findSiteChatConversationByPhone(visitorPhone);
  if (!conversation) {
    return { ok: true, action: "ignored", reason: "no_conversation" };
  }

  await recordSiteChatMessage({
    conversationId: conversation.id,
    sender,
    body: text,
    source: SiteChatMessageSource.QUO,
    quoMessageId,
  });

  return { ok: true, action: "stored" };
}
