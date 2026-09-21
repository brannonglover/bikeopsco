/**
 * Shared vocabulary for the staff chat Realtime channel.
 *
 * Isomorphic: imported by both the server publisher (`publish-chat-event.ts`)
 * and the browser subscriber (`useChatRealtime`), so it must not pull in
 * anything server-only.
 *
 * Events are deliberately *notifications*, not state transfer. The payload
 * carries only enough to identify what changed; the client always refetches
 * the conversation list or the open thread, which remain the source of truth.
 * That keeps the read-state, consent, and attachment logic in one place on the
 * server instead of being re-derived from a broadcast payload.
 */

export const CHAT_REALTIME_EVENTS = [
  /** A message was created, edited, or reacted to in a conversation. */
  "chat:message",
  /** Conversation-level change: a new thread, a contact edit, read state. */
  "chat:conversation",
] as const;

export type ChatRealtimeEvent = (typeof CHAT_REALTIME_EVENTS)[number];

export type ChatRealtimePayload = {
  shopId: string;
  conversationId: string;
  /** Present on `chat:message` when a single message is the cause. */
  messageId?: string;
};

/** Realtime topic carrying chat events for a single shop. */
export function chatChannelName(shopId: string): string {
  return `shop:${shopId}:chat`;
}
