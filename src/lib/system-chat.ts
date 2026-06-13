import { prisma } from "@/lib/db";
import { findOrCreateGeneralConversation } from "@/lib/conversation";

export async function addCustomerSystemChatMessage({
  shopId,
  customerId,
  body,
}: {
  shopId: string;
  customerId: string;
  body: string;
}) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  const conversation = await findOrCreateGeneralConversation(shopId, customerId);

  const message = await prisma.message.create({
    data: {
      shopId,
      conversationId: conversation.id,
      sender: "SYSTEM",
      body: trimmed,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  return message;
}
