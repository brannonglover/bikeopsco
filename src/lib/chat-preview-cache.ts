import type { ChatMessage } from "@/lib/types";

const PREFIX = "bikeops:chat-preview:";

export function cacheChatPreviewMessage(conversationId: string, message: ChatMessage): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(`${PREFIX}${conversationId}`, JSON.stringify(message));
  } catch {
    // Ignore quota / private mode errors.
  }
}

export function readChatPreviewMessage(conversationId: string): ChatMessage | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${PREFIX}${conversationId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as ChatMessage).id !== "string" ||
      typeof (parsed as ChatMessage).conversationId !== "string"
    ) {
      return null;
    }
    return parsed as ChatMessage;
  } catch {
    return null;
  }
}

export function clearChatPreviewMessage(conversationId: string): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(`${PREFIX}${conversationId}`);
  } catch {
    // Ignore.
  }
}

/** Newest-known preview for a thread: session cache, then inbox list snippet. */
export function getChatPreviewSeed(
  conversationId: string,
  conversationMessages?: ChatMessage[]
): ChatMessage[] {
  const cached = readChatPreviewMessage(conversationId);
  const fromList = conversationMessages?.[0] ?? null;
  const preview = cached ?? fromList;
  if (!preview) return [];
  return [preview];
}
