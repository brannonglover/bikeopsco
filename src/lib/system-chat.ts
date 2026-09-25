import { prisma } from "@/lib/db";
import { publishChatEvent } from "@/lib/realtime/publish-chat-event";
import { findOrCreateGeneralConversation } from "@/lib/conversation";
import {
  buildJobSmsMessage,
  type BikeScopedSend,
  type JobForSms,
} from "@/lib/sms";

type ShopSmsContext = { name: string; subdomain: string | null };

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

    await publishChatEvent("chat:message", {
      shopId,
      conversationId: conversation.id,
      messageId: message.id,
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
 *
 * `bikeScope` names one bike of a multi-bike job. Its message body differs per bike, so
 * the duplicate check below lets each bike post once without a separate dedup key.
 */
export async function mirrorJobStageToCustomerChat({
  shopId,
  customerId,
  job,
  smsTemplateSlug,
  force = false,
  shopHint,
  bikeScope,
}: {
  shopId: string;
  customerId: string;
  job: JobForSms;
  smsTemplateSlug: string;
  force?: boolean;
  shopHint?: ShopSmsContext;
  bikeScope?: BikeScopedSend;
}): Promise<void> {
  const built = await buildJobSmsMessage(smsTemplateSlug, job, shopHint, bikeScope);
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

  const conversation = await findOrCreateGeneralConversation(shopId, customerId);

  if (!force) {
    const existing = await prisma.message.findFirst({
      where: {
        conversationId: conversation.id,
        sender: "SYSTEM",
        body: { contains: `/status/${job.id}` },
      },
      select: { id: true, body: true },
    });
    if (existing?.body === built.message) {
      console.info("[system-chat] mirrorJobStageToCustomerChat: skipped duplicate", {
        jobId: job.id,
        customerId,
        templateSlug: smsTemplateSlug,
        messageId: existing.id,
      });
      return;
    }
  }

  const message = await prisma.message.create({
    data: {
      shopId,
      conversationId: conversation.id,
      sender: "SYSTEM",
      body: built.message,
    },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  await publishChatEvent("chat:message", {
    shopId,
    conversationId: conversation.id,
    messageId: message.id,
  });

  console.info("[system-chat] mirrorJobStageToCustomerChat: posted", {
    jobId: job.id,
    customerId,
    templateSlug: smsTemplateSlug,
    messageId: message.id,
    conversationId: message.conversationId,
  });
}
