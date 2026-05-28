import { randomBytes } from "crypto";
import type { SiteChatConversation, SiteChatMessage } from "@prisma/client";
import { SiteChatMessageSource, SiteChatSender } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import {
  formatSiteChatQuoRelay,
  isQuoConfigured,
  sendQuoTextMessage,
} from "@/lib/quo";

export function createSiteChatSessionToken(): string {
  return randomBytes(32).toString("hex");
}

export async function findSiteChatBySessionToken(
  sessionToken: string
): Promise<SiteChatConversation | null> {
  const trimmed = sessionToken.trim();
  if (!trimmed) return null;
  return prisma.siteChatConversation.findUnique({
    where: { sessionToken: trimmed },
  });
}

export type SiteChatMessageDto = {
  id: string;
  sender: "visitor" | "staff";
  body: string;
  createdAt: string;
};

export function toSiteChatMessageDto(message: SiteChatMessage): SiteChatMessageDto {
  return {
    id: message.id,
    sender: message.sender === SiteChatSender.VISITOR ? "visitor" : "staff",
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

/** Relay a visitor widget message into the Quo thread for this phone number. */
export async function relayVisitorMessageToQuo(params: {
  visitorName: string;
  visitorPhoneE164: string;
  body: string;
}): Promise<{ quoMessageId: string | null; error: string | null }> {
  if (!isQuoConfigured()) {
    return { quoMessageId: null, error: "Quo is not configured" };
  }

  const content = formatSiteChatQuoRelay(params.visitorName, params.body);
  const result = await sendQuoTextMessage({
    toE164: params.visitorPhoneE164,
    content,
  });

  if (!result.ok) {
    console.error("Site chat Quo relay failed:", result.error);
    return { quoMessageId: null, error: result.error };
  }

  return { quoMessageId: result.messageId, error: null };
}

export async function recordSiteChatMessage(params: {
  conversationId: string;
  sender: SiteChatSender;
  body: string;
  source: SiteChatMessageSource;
  quoMessageId?: string | null;
}): Promise<SiteChatMessage> {
  const body = params.body.trim();
  if (!body) {
    throw new Error("Message body is required");
  }

  if (params.quoMessageId) {
    const existing = await prisma.siteChatMessage.findUnique({
      where: { quoMessageId: params.quoMessageId },
    });
    if (existing) return existing;
  }

  const message = await prisma.siteChatMessage.create({
    data: {
      conversationId: params.conversationId,
      sender: params.sender,
      body,
      source: params.source,
      quoMessageId: params.quoMessageId ?? undefined,
    },
  });

  await prisma.siteChatConversation.update({
    where: { id: params.conversationId },
    data: { updatedAt: new Date() },
  });

  return message;
}

export function phonesMatchForSiteChat(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (na && nb) return na === nb;
  const digits = (value: string) => value.replace(/\D/g, "");
  const da = digits(a);
  const db = digits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  if (da.length >= 10 && db.length >= 10) {
    return da.slice(-10) === db.slice(-10);
  }
  return false;
}

export async function findSiteChatConversationByPhone(
  phoneE164: string
): Promise<SiteChatConversation | null> {
  const normalized = normalizePhone(phoneE164);
  if (!normalized) return null;

  const recent = await prisma.siteChatConversation.findMany({
    where: { visitorPhone: normalized },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  if (recent.length > 0) return recent[0]!;

  const open = await prisma.siteChatConversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return open.find((c) => phonesMatchForSiteChat(c.visitorPhone, normalized)) ?? null;
}
