import { prisma } from "@/lib/db";
import type { ChatMessage } from "@/lib/types";
import { serializeChatMessages } from "@/lib/chat/serialize-messages";
import type { MessagePageOptions } from "@/lib/chat/message-page";

export type StaffConversationMessagesPayload = {
  messages: ChatMessage[];
  customerTypingAt: string | null;
  staffLastReadAt: string | null;
  customerLastReadAt: string | null;
  hasMore?: boolean;
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

async function loadMessagesForConversation(
  shopId: string,
  conversationId: string,
  options: MessagePageOptions
) {
  const where: {
    shopId: string;
    conversationId: string;
    createdAt?: { lt: Date };
  } = { shopId, conversationId };

  if (options.beforeId) {
    const cursor = await prisma.message.findFirst({
      where: { id: options.beforeId, shopId, conversationId },
      select: { createdAt: true },
    });
    if (cursor) {
      where.createdAt = { lt: cursor.createdAt };
    }
  }

  const include = { attachments: true, reactions: true } as const;
  const limit = options.limit;

  try {
    if (limit) {
      const batch = await prisma.message.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        include,
      });
      const hasMore = batch.length > limit;
      return {
        messages: (hasMore ? batch.slice(0, limit) : batch).reverse(),
        hasMore,
      };
    }

    const messages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include,
    });
    return { messages, hasMore: false };
  } catch (e) {
    console.warn(
      "[chat] Failed to load message includes (attachments/reactions); falling back:",
      { conversationId, error: e }
    );
    if (limit) {
      const batch = await prisma.message.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
      });
      const hasMore = batch.length > limit;
      const base = (hasMore ? batch.slice(0, limit) : batch).reverse();
      return {
        messages: base.map((message) => ({
          ...message,
          attachments: [],
          reactions: [],
        })),
        hasMore,
      };
    }

    const baseMessages = await prisma.message.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    return {
      messages: baseMessages.map((message) => ({
        ...message,
        attachments: [],
        reactions: [],
      })),
      hasMore: false,
    };
  }
}

export async function loadStaffConversationMessages(
  shopId: string,
  conversationId: string,
  options: MessagePageOptions = {}
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

  const { messages, hasMore } = await loadMessagesForConversation(
    shopId,
    conversationId,
    options
  );

  const customerTypingAtIso = conversation.customerTypingAt?.toISOString() ?? null;
  const customerLastReadAtIso = conversation.customerLastReadAt?.toISOString() ?? null;
  const currentStaffLastReadAt = conversation.staffLastReadAt ?? null;

  let staffLastReadAtIso: string | null = currentStaffLastReadAt?.toISOString() ?? null;

  // Mark read after payload is ready — don't block the response on the write.
  // Only on the newest page (no beforeId).
  if (!options.beforeId) {
    // Optimistic: if the page includes a customer message newer than last read,
    // return the bumped timestamp immediately while the write runs in background.
    const latestInPage = messages.reduce<Date | null>((latest, message) => {
      if (message.sender !== "CUSTOMER") return latest;
      if (!latest || message.createdAt > latest) return message.createdAt;
      return latest;
    }, null);
    if (
      latestInPage &&
      (!currentStaffLastReadAt ||
        latestInPage.getTime() > currentStaffLastReadAt.getTime())
    ) {
      staffLastReadAtIso = new Date().toISOString();
    }

    void (async () => {
      const latestCustomerMessage = await prisma.message.findFirst({
        where: { shopId, conversationId, sender: "CUSTOMER" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (!latestCustomerMessage) return;
      if (
        currentStaffLastReadAt &&
        latestCustomerMessage.createdAt.getTime() <=
          currentStaffLastReadAt.getTime()
      ) {
        return;
      }
      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          staffLastReadAt: new Date(),
          updatedAt: conversation.updatedAt,
        },
      });
    })().catch((e) => {
      console.warn("[chat] Failed to mark staffLastReadAt; continuing:", {
        conversationId,
        error: e,
      });
    });
  }

  return {
    messages: serializeChatMessages(messages),
    customerTypingAt: customerTypingAtIso,
    staffLastReadAt: staffLastReadAtIso,
    customerLastReadAt: customerLastReadAtIso,
    ...(options.limit ? { hasMore } : {}),
  };
}
