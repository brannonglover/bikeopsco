import { prisma } from "@/lib/db";
import { getEffectiveSmsConsent } from "@/lib/sms-consent";
import { consolidateCustomerConversations } from "@/lib/conversation";

const conversationInclude = {
  customer: true,
  job: true,
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: { attachments: true, reactions: true },
  },
};

export async function getStaffConversationsFingerprint(shopId: string): Promise<string> {
  const rows = await prisma.conversation.findMany({
    where: { shopId, archived: false, jobId: null },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      updatedAt: true,
      staffLastReadAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          createdAt: true,
          editedAt: true,
          sender: true,
          _count: { select: { reactions: true } },
        },
      },
    },
  });

  return JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      updatedAt: row.updatedAt,
      staffLastReadAt: row.staffLastReadAt,
      lastMessage: row.messages[0] ?? null,
    }))
  );
}

export async function loadStaffConversations(shopId: string) {
  const conversations = await prisma.conversation.findMany({
    where: { shopId, archived: false, jobId: null },
    orderBy: { updatedAt: "desc" },
    include: conversationInclude,
  });

  const customerCounts = new Map<string, number>();
  for (const c of conversations) {
    customerCounts.set(c.customerId, (customerCounts.get(c.customerId) ?? 0) + 1);
  }
  const dupeCustomerIds = [...customerCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([customerId]) => customerId);

  if (dupeCustomerIds.length > 0) {
    void prisma
      .$transaction(async (tx) => {
        for (const customerId of dupeCustomerIds) {
          await consolidateCustomerConversations(shopId, customerId, tx);
        }
      })
      .catch((e) =>
        console.error("[chat] Background conversation consolidation failed:", e)
      );
  }

  return conversations.map((conversation) =>
    conversation.customer
      ? {
          ...conversation,
          customer: {
            ...conversation.customer,
            smsConsent: getEffectiveSmsConsent(conversation.customer),
          },
        }
      : conversation
  );
}
