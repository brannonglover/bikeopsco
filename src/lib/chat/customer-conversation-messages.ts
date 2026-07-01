import { prisma } from "@/lib/db";
import { resolveGeneralConversation } from "@/lib/conversation";
import { serializeChatMessages } from "@/lib/chat/serialize-messages";
import type { ChatMessage } from "@/lib/types";

export type CustomerConversationMessagesPayload = {
  messages: ChatMessage[];
  staffLastReadAt: string | null;
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
  customerId: string
): Promise<CustomerConversationMessagesPayload> {
  const conversation = await resolveGeneralConversation(shopId, customerId);

  if (!conversation) {
    return { messages: [], staffLastReadAt: null };
  }

  const messages = await prisma.message.findMany({
    where: { shopId, conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
    include: { attachments: true, reactions: true },
  });

  const latestShopMessageAt = messages.reduce<Date | null>((latest, message) => {
    if (message.sender !== "STAFF" && message.sender !== "SYSTEM") return latest;
    if (!latest || message.createdAt > latest) return message.createdAt;
    return latest;
  }, null);

  let staffLastReadAt = conversation.staffLastReadAt?.toISOString() ?? null;
  const shouldMarkRead =
    latestShopMessageAt !== null &&
    (!conversation.customerLastReadAt ||
      latestShopMessageAt.getTime() > conversation.customerLastReadAt.getTime());

  if (shouldMarkRead) {
    const readUpdate = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        customerLastReadAt: new Date(),
        updatedAt: conversation.updatedAt,
      },
      select: { staffLastReadAt: true },
    });
    staffLastReadAt = readUpdate.staffLastReadAt?.toISOString() ?? null;
  }

  return { messages: serializeChatMessages(messages), staffLastReadAt };
}
