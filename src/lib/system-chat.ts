import { prisma } from "@/lib/db";

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

  let conversation = await prisma.conversation.findFirst({
    where: { shopId, customerId, jobId: null, archived: false },
    select: { id: true },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { shopId, customerId, jobId: null },
      select: { id: true },
    });
  }

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
