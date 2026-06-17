import { prisma } from "@/lib/db";
import {
  findOrCreateGeneralConversation,
  resolveGeneralConversation,
} from "@/lib/conversation";
import { buildJobSmsMessage, type JobForSms } from "@/lib/sms";

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

  try {
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
  } catch (error) {
    console.error("[system-chat] addCustomerSystemChatMessage failed:", {
      shopId,
      customerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Posts a stage-change notification to the customer's general chat thread.
 * Independent of SMS/email delivery so chat stays in sync when texts send.
 */
export async function mirrorJobStageToCustomerChat({
  shopId,
  customerId,
  job,
  smsTemplateSlug,
  force = false,
}: {
  shopId: string;
  customerId: string;
  job: JobForSms;
  smsTemplateSlug: string;
  force?: boolean;
}): Promise<void> {
  const built = await buildJobSmsMessage(smsTemplateSlug, job);
  if (!built.ok || !built.message) {
    console.error("[system-chat] mirrorJobStageToCustomerChat: template build failed:", {
      shopId,
      customerId,
      jobId: job.id,
      templateSlug: smsTemplateSlug,
      error: built.error,
    });
    return;
  }

  if (!force) {
    const conversation = await resolveGeneralConversation(shopId, customerId);
    if (conversation) {
      const existing = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          sender: "SYSTEM",
          body: built.message,
        },
        select: { id: true },
      });
      if (existing) return;
    }
  }

  await addCustomerSystemChatMessage({
    shopId,
    customerId,
    body: built.message,
  });
}
