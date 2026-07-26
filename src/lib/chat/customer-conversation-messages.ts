import { prisma } from "@/lib/db";
import { resolveGeneralConversation } from "@/lib/conversation";
import { serializeChatMessages } from "@/lib/chat/serialize-messages";
import type { MessagePageOptions } from "@/lib/chat/message-page";
import type { ChatMessage } from "@/lib/types";

export type CustomerConversationMessagesPayload = {
  messages: ChatMessage[];
  staffLastReadAt: string | null;
  hasMore?: boolean;
};

export async function getCustomerConversationMessagesFingerprint(
  shopId: string,
  customerId: string
): Promise<string> {
  const conversation = await resolveGeneralConversation(shopId, customerId);
  if (!conversation) return "empty";

  const messageStats = await prisma.message.aggregate({
    where: { shopId, conversationId: conversation.id },
    _count: { _all: true },
    _max: { createdAt: true, editedAt: true },
  });

  const reactionStats = await prisma.messageReaction.aggregate({
    where: { shopId, message: { conversationId: conversation.id } },
    _count: { _all: true },
    _max: { createdAt: true },
  });

  return JSON.stringify({
    conversationId: conversation.id,
    staffLastReadAt: conversation.staffLastReadAt,
    customerLastReadAt: conversation.customerLastReadAt,
    updatedAt: conversation.updatedAt,
    messageCount: messageStats._count._all,
    lastMessageAt: messageStats._max.createdAt,
    lastEditedAt: messageStats._max.editedAt,
    reactionCount: reactionStats._count._all,
    lastReactionAt: reactionStats._max.createdAt,
  });
}

export async function loadCustomerConversationMessages(
  shopId: string,
  customerId: string,
  options: MessagePageOptions = {}
): Promise<CustomerConversationMessagesPayload> {
  const conversation = await resolveGeneralConversation(shopId, customerId);

  if (!conversation) {
    return { messages: [], staffLastReadAt: null, hasMore: false };
  }

  const where: {
    shopId: string;
    conversationId: string;
    createdAt?: { lt: Date };
  } = {
    shopId,
    conversationId: conversation.id,
  };

  if (options.beforeId) {
    const cursor = await prisma.message.findFirst({
      where: {
        id: options.beforeId,
        shopId,
        conversationId: conversation.id,
      },
      select: { createdAt: true },
    });
    if (cursor) {
      where.createdAt = { lt: cursor.createdAt };
    }
  }

  const limit = options.limit;
  let hasMore = false;
  let messages;

  if (limit) {
    const batch = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      include: { attachments: true, reactions: true },
    });
    hasMore = batch.length > limit;
    messages = (hasMore ? batch.slice(0, limit) : batch).reverse();
  } else {
    messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: { attachments: true, reactions: true },
    });
  }

  const staffLastReadAt = conversation.staffLastReadAt?.toISOString() ?? null;

  // Mark read after we have the payload ready — don't block the response.
  // Only on the newest page (no beforeId); older-page fetches shouldn't bump read state.
  if (!options.beforeId) {
    void (async () => {
      const latestShopMessage = await prisma.message.findFirst({
        where: {
          shopId,
          conversationId: conversation.id,
          sender: { in: ["STAFF", "SYSTEM"] },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!latestShopMessage) return;
      if (
        conversation.customerLastReadAt &&
        latestShopMessage.createdAt.getTime() <=
          conversation.customerLastReadAt.getTime()
      ) {
        return;
      }
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          customerLastReadAt: new Date(),
          updatedAt: conversation.updatedAt,
        },
      });
    })().catch((error) => {
      console.warn("[chat] Failed to mark customerLastReadAt:", {
        conversationId: conversation.id,
        error,
      });
    });
  }

  return {
    messages: serializeChatMessages(messages),
    staffLastReadAt,
    ...(limit ? { hasMore } : {}),
  };
}
