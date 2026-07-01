import { prisma } from "@/lib/db";
import type { ChatMessage } from "@/lib/types";
import { serializeChatMessages } from "@/lib/chat/serialize-messages";

export type StaffConversationMessagesPayload = {
  messages: ChatMessage[];
  customerTypingAt: string | null;
  staffLastReadAt: string | null;
  customerLastReadAt: string | null;
};

export async function getStaffConversationMessagesFingerprint(
  shopId: string,
  conversationId: string
): Promise<string> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, shopId },
    select: {
      updatedAt: true,
      customerTypingAt: true,
      customerLastReadAt: true,
      staffLastReadAt: true,
    },
  });
  if (!conversation) return "missing";

  const messageStats = await prisma.message.aggregate({
    where: { shopId, conversationId },
    _count: { _all: true },
    _max: { createdAt: true, editedAt: true },
  });

  const reactionStats = await prisma.messageReaction.aggregate({
    where: { shopId, message: { conversationId } },
    _count: { _all: true },
    _max: { createdAt: true },
  });

  return JSON.stringify({
    conversation,
    messageCount: messageStats._count._all,
    lastMessageAt: messageStats._max.createdAt,
    lastEditedAt: messageStats._max.editedAt,
    reactionCount: reactionStats._count._all,
    lastReactionAt: reactionStats._max.createdAt,
  });
}

export async function loadStaffConversationMessages(
  shopId: string,
  conversationId: string
): Promise<StaffConversationMessagesPayload | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, shopId },
    select: {
      updatedAt: true,
      customerTypingAt: true,
      customerLastReadAt: true,
      staffLastReadAt: true,
    },
  });

  if (!conversation) return null;

  let messages;
  try {
    messages = await prisma.message.findMany({
      where: { shopId, conversationId },
      orderBy: { createdAt: "asc" },
      include: { attachments: true, reactions: true },
    });
  } catch (e) {
    console.warn(
      "[chat] Failed to load message includes (attachments/reactions); falling back:",
      { conversationId, error: e }
    );
    const baseMessages = await prisma.message.findMany({
      where: { shopId, conversationId },
      orderBy: { createdAt: "asc" },
    });
    messages = baseMessages.map((message) => ({
      ...message,
      attachments: [],
      reactions: [],
    }));
  }

  const customerTypingAtIso = conversation.customerTypingAt?.toISOString() ?? null;
  const customerLastReadAtIso = conversation.customerLastReadAt?.toISOString() ?? null;
  const currentStaffLastReadAt = conversation.staffLastReadAt ?? null;

  const latestCustomerMessageAt = messages.reduce<Date | null>((latest, message) => {
    if (message.sender !== "CUSTOMER") return latest;
    if (!latest || message.createdAt > latest) return message.createdAt;
    return latest;
  }, null);

  let staffLastReadAtIso: string | null = currentStaffLastReadAt?.toISOString() ?? null;
  const shouldMarkRead =
    latestCustomerMessageAt !== null &&
    (!currentStaffLastReadAt ||
      latestCustomerMessageAt.getTime() > currentStaffLastReadAt.getTime());

  if (shouldMarkRead) {
    try {
      const readUpdate = await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          staffLastReadAt: new Date(),
          updatedAt: conversation.updatedAt,
        },
        select: { staffLastReadAt: true },
      });
      staffLastReadAtIso = (readUpdate.staffLastReadAt ?? new Date()).toISOString();
    } catch (e) {
      console.warn("[chat] Failed to mark staffLastReadAt; continuing:", {
        conversationId,
        error: e,
      });
    }
  }

  return {
    messages: serializeChatMessages(messages),
    customerTypingAt: customerTypingAtIso,
    staffLastReadAt: staffLastReadAtIso,
    customerLastReadAt: customerLastReadAtIso,
  };
}
