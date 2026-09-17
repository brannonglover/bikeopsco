import type { ChatMessage } from "@/lib/types";

function attachmentIdKey(attachments: ChatMessage["attachments"]): string {
  return [...attachments.map((a) => a.id)].sort().join("\0");
}

function optimisticMatchesServer(optimistic: ChatMessage, server: ChatMessage): boolean {
  if (!optimistic.id.startsWith("temp-")) return false;
  if (optimistic.sender !== server.sender) return false;
  if ((optimistic.body ?? "").trim() !== (server.body ?? "").trim()) return false;
  if (attachmentIdKey(optimistic.attachments) !== attachmentIdKey(server.attachments)) {
    return false;
  }
  const dt = Math.abs(
    new Date(optimistic.createdAt).getTime() - new Date(server.createdAt).getTime()
  );
  return dt < 120_000;
}

/**
 * Merge a polled/fetched server list into local state without duplicating
 * in-flight optimistic sends.
 *
 * The server list is a bounded page of the newest messages, so it is only
 * authoritative for the window it covers. Messages already held locally that
 * are older than the page's oldest entry were loaded by "load older" and must
 * survive the merge — otherwise every SSE update would throw away scrollback.
 * Inside the window the server still wins, so edits and deletes propagate.
 */
export function mergeChatMessagesWithServer(
  prev: ChatMessage[],
  serverMessages: ChatMessage[]
): ChatMessage[] {
  const optimistic = prev.filter((m) => m.id.startsWith("temp-"));
  const unmatchedOptimistic = optimistic.filter(
    (opt) => !serverMessages.some((srv) => optimisticMatchesServer(opt, srv))
  );

  const prevById = new Map(prev.map((m) => [m.id, m] as const));
  const optimisticByServerId = new Map<string, ChatMessage>();
  for (const srv of serverMessages) {
    const match = optimistic.find((opt) => optimisticMatchesServer(opt, srv));
    if (match) optimisticByServerId.set(srv.id, match);
  }

  const byId = new Map<string, ChatMessage>();
  for (const msg of serverMessages) {
    const prevMsg = prevById.get(msg.id);
    const matchedOptimistic = optimisticByServerId.get(msg.id);
    const clientDeliveryState =
      prevMsg?.clientDeliveryState ?? matchedOptimistic?.clientDeliveryState;
    if (clientDeliveryState) {
      byId.set(msg.id, { ...msg, clientDeliveryState });
    } else {
      byId.set(msg.id, msg);
    }
  }

  // Retain locally-loaded history that sits outside the server page window.
  if (serverMessages.length > 0) {
    const windowStart = serverMessages.reduce(
      (min, m) => Math.min(min, new Date(m.createdAt).getTime()),
      Number.POSITIVE_INFINITY
    );
    for (const msg of prev) {
      if (msg.id.startsWith("temp-")) continue;
      if (byId.has(msg.id)) continue;
      if (new Date(msg.createdAt).getTime() < windowStart) {
        byId.set(msg.id, msg);
      }
    }
  }

  for (const msg of unmatchedOptimistic) {
    byId.set(msg.id, msg);
  }

  return [...byId.values()].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}
