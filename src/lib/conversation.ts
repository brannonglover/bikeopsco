import type { Conversation, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient;

function pickPrimaryConversation(conversations: Conversation[]): Conversation {
  return [...conversations].sort((a, b) => {
    const aGeneral = a.jobId === null ? 0 : 1;
    const bGeneral = b.jobId === null ? 0 : 1;
    if (aGeneral !== bGeneral) return aGeneral - bGeneral;

    const aActive = a.archived ? 1 : 0;
    const bActive = b.archived ? 1 : 0;
    if (aActive !== bActive) return aActive - bActive;

    return b.updatedAt.getTime() - a.updatedAt.getTime();
  })[0];
}

async function moveConversationData(
  tx: Db,
  fromId: string,
  toId: string
): Promise<void> {
  await tx.message.updateMany({
    where: { conversationId: fromId },
    data: { conversationId: toId },
  });

  const reminders = await tx.chatReminderEmail.findMany({
    where: { conversationId: fromId },
  });
  for (const reminder of reminders) {
    const conflict = await tx.chatReminderEmail.findUnique({
      where: {
        conversationId_messageId_kind: {
          conversationId: toId,
          messageId: reminder.messageId,
          kind: reminder.kind,
        },
      },
    });
    if (conflict) {
      await tx.chatReminderEmail.delete({ where: { id: reminder.id } });
    } else {
      await tx.chatReminderEmail.update({
        where: { id: reminder.id },
        data: { conversationId: toId },
      });
    }
  }
}

/**
 * Merges duplicate threads for a customer into a single general (jobId null) conversation.
 * Returns the primary thread, or null if the customer has no conversations yet.
 */
export async function consolidateCustomerConversations(
  shopId: string,
  customerId: string,
  tx: Db
): Promise<Conversation | null> {
  const all = await tx.conversation.findMany({
    where: { shopId, customerId },
    orderBy: { updatedAt: "desc" },
  });

  if (all.length === 0) return null;

  const primary = pickPrimaryConversation(all);
  const duplicates = all.filter((c) => c.id !== primary.id);

  for (const dup of duplicates) {
    await moveConversationData(tx, dup.id, primary.id);
    await tx.conversation.update({
      where: { id: dup.id },
      data: { archived: true },
    });
  }

  if (primary.jobId !== null || primary.archived) {
    return tx.conversation.update({
      where: { id: primary.id },
      data: { jobId: null, archived: false },
    });
  }

  return primary;
}

async function withGeneralConversationLock<T>(
  shopId: string,
  customerId: string,
  tx: Db | undefined,
  fn: (client: Db) => Promise<T>
): Promise<T> {
  const run = async (client: Db) => {
    const lockKey = `${shopId}:${customerId}:general`;
    // pg_advisory_xact_lock returns void — must use $executeRaw ($queryRaw cannot deserialize it).
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    return fn(client);
  };

  if (tx) return run(tx);
  return prisma.$transaction(run);
}

/**
 * Finds the customer's general chat thread, unarchiving and consolidating duplicates if needed.
 * Does not create a new thread when none exists.
 */
export async function resolveGeneralConversation(
  shopId: string,
  customerId: string,
  tx?: Db
): Promise<Conversation | null> {
  return withGeneralConversationLock(shopId, customerId, tx, (client) =>
    consolidateCustomerConversations(shopId, customerId, client)
  );
}

/**
 * Finds or creates the customer's single general chat thread (jobId null).
 * Reuses archived threads instead of creating duplicates.
 */
export async function findOrCreateGeneralConversation(
  shopId: string,
  customerId: string,
  options?: { tx?: Db; include?: Prisma.ConversationInclude }
): Promise<Conversation> {
  const conversation = await withGeneralConversationLock(
    shopId,
    customerId,
    options?.tx,
    async (client) => {
      const existing = await consolidateCustomerConversations(
        shopId,
        customerId,
        client
      );
      if (existing) return existing;

      return client.conversation.create({
        data: { shopId, customerId, jobId: null },
      });
    }
  );

  if (!options?.include) return conversation;

  const client = options.tx ?? prisma;
  return client.conversation.findUniqueOrThrow({
    where: { id: conversation.id },
    include: options.include,
  });
}
