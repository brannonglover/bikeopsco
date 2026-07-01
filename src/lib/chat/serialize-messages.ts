import type { ChatMessage, MessageAttachment, MessageReaction } from "@/lib/types";

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function serializeAttachment(attachment: {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  createdAt: Date | string;
}): MessageAttachment {
  return {
    id: attachment.id,
    url: attachment.url,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    createdAt: toIso(attachment.createdAt),
  };
}

function serializeReaction(reaction: {
  id: string;
  messageId: string;
  emoji: string;
  reactorType: ChatMessage["sender"];
  createdAt: Date | string;
}): MessageReaction {
  return {
    id: reaction.id,
    messageId: reaction.messageId,
    emoji: reaction.emoji,
    reactorType: reaction.reactorType,
    createdAt: toIso(reaction.createdAt),
  };
}

type SerializableMessage = {
  id: string;
  conversationId: string;
  sender: ChatMessage["sender"];
  body: string | null;
  createdAt: Date;
  editedAt: Date | null;
  smsProvider?: string | null;
  smsSid?: string | null;
  smsDeliveryStatus?: string | null;
  smsDeliveryStatusName?: string | null;
  smsDeliveryStatusDescription?: string | null;
  smsDeliveryError?: string | null;
  smsDeliveredAt?: Date | null;
  attachments: Array<{
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    createdAt: Date | string;
  }>;
  reactions: Array<{
    id: string;
    messageId: string;
    emoji: string;
    reactorType: ChatMessage["sender"];
    createdAt: Date | string;
  }>;
};

export function serializeChatMessages(messages: SerializableMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    id: message.id,
    conversationId: message.conversationId,
    sender: message.sender,
    body: message.body,
    attachments: message.attachments.map(serializeAttachment),
    reactions: message.reactions.map(serializeReaction),
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    smsProvider: message.smsProvider ?? null,
    smsSid: message.smsSid ?? null,
    smsDeliveryStatus: message.smsDeliveryStatus ?? null,
    smsDeliveryStatusName: message.smsDeliveryStatusName ?? null,
    smsDeliveryStatusDescription: message.smsDeliveryStatusDescription ?? null,
    smsDeliveryError: message.smsDeliveryError ?? null,
    smsDeliveredAt: message.smsDeliveredAt?.toISOString() ?? null,
  }));
}
