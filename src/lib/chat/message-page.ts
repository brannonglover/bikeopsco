export type MessagePageOptions = {
  /** When set, return only the newest N messages (or N before `beforeId`). */
  limit?: number;
  /** Load messages older than this message id (exclusive). */
  beforeId?: string;
};

export function parseMessagePageOptions(searchParams: URLSearchParams): MessagePageOptions {
  const limitRaw = searchParams.get("limit");
  const beforeId = searchParams.get("before")?.trim() || undefined;
  if (!limitRaw) return { beforeId };

  const parsed = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return { beforeId };

  // Cap to keep payloads bounded for mobile / slow networks.
  return { limit: Math.min(parsed, 200), beforeId };
}
