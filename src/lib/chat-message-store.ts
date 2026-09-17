import type { ChatMessage } from "@/lib/types";

/**
 * Durable last-known-messages cache.
 *
 * The in-memory cache on the chat page dies with the page, and the preview
 * cache only ever held a single message — so every app open repainted a thread
 * from zero and waited a full round trip before showing anything. This keeps
 * the tail of recently-viewed threads in localStorage so the UI can paint
 * immediately and reconcile against the server in the background.
 *
 * Storage is best-effort: any failure (quota, private mode, disabled storage)
 * degrades to the previous behaviour rather than throwing.
 */

const PREFIX = "bikeops:chat-thread:";
const INDEX_KEY = "bikeops:chat-thread-index";

/** Messages retained per thread — roughly one screenful plus scrollback. */
const MAX_MESSAGES_PER_THREAD = 50;
/** Threads retained before the least-recently-used one is evicted. */
const MAX_THREADS = 20;

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function threadKey(conversationId: string): string {
  return `${PREFIX}${conversationId}`;
}

function readIndex(store: Storage): string[] {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/** Moves `conversationId` to the front and evicts anything past MAX_THREADS. */
function touchIndex(store: Storage, conversationId: string): void {
  const next = [conversationId, ...readIndex(store).filter((id) => id !== conversationId)];
  const evicted = next.slice(MAX_THREADS);
  for (const id of evicted) {
    try {
      store.removeItem(threadKey(id));
    } catch {
      // Ignore.
    }
  }
  try {
    store.setItem(INDEX_KEY, JSON.stringify(next.slice(0, MAX_THREADS)));
  } catch {
    // Ignore.
  }
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ChatMessage).id === "string" &&
    typeof (value as ChatMessage).conversationId === "string" &&
    typeof (value as ChatMessage).createdAt === "string"
  );
}

/** Newest-last tail of a thread as of the last time it was viewed. */
export function readCachedMessages(conversationId: string): ChatMessage[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(threadKey(conversationId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isChatMessage);
  } catch {
    return [];
  }
}

export function writeCachedMessages(
  conversationId: string,
  messages: ChatMessage[]
): void {
  const store = storage();
  if (!store) return;

  // Never persist optimistic sends — they carry client-side ids that would
  // resurrect as permanent ghosts if the send ultimately failed.
  const durable = messages.filter((m) => !m.id.startsWith("temp-"));
  const tail = durable.slice(-MAX_MESSAGES_PER_THREAD);

  try {
    store.setItem(threadKey(conversationId), JSON.stringify(tail));
    touchIndex(store, conversationId);
  } catch {
    // Quota exceeded — drop the oldest threads and try once more.
    try {
      const index = readIndex(store);
      for (const id of index.slice(Math.floor(MAX_THREADS / 2))) {
        store.removeItem(threadKey(id));
      }
      store.setItem(threadKey(conversationId), JSON.stringify(tail));
      touchIndex(store, conversationId);
    } catch {
      // Give up; the page still works, just without a warm cache.
    }
  }
}

export function clearCachedMessages(conversationId: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(threadKey(conversationId));
  } catch {
    // Ignore.
  }
}

/** Drops every cached thread — used when staff sign out of the shop. */
export function clearAllCachedMessages(): void {
  const store = storage();
  if (!store) return;
  try {
    for (const id of readIndex(store)) {
      store.removeItem(threadKey(id));
    }
    store.removeItem(INDEX_KEY);
    store.removeItem(LIST_KEY);
  } catch {
    // Ignore.
  }
}

/* -------------------------------------------------------------------------- */
/* Inbox list                                                                  */
/* -------------------------------------------------------------------------- */

const LIST_KEY = "bikeops:chat-inbox";
/** Rows kept for the instant first paint; the server list replaces them. */
const MAX_CACHED_ROWS = 40;

/**
 * Last-known inbox rows. Painted immediately on open so the list isn't an
 * empty skeleton while `/api/conversations` is in flight; replaced wholesale
 * as soon as the server responds.
 */
export function readCachedConversations<T>(): T[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function writeCachedConversations<T>(conversations: T[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(LIST_KEY, JSON.stringify(conversations.slice(0, MAX_CACHED_ROWS)));
  } catch {
    // Ignore quota / private mode errors.
  }
}
