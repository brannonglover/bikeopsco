"use client";

import { getRealtimeClient } from "@/lib/realtime/client";
import { getRealtimeAuth } from "@/lib/realtime/access-token";
import {
  CHAT_REALTIME_EVENTS,
  type ChatRealtimePayload,
} from "@/lib/realtime/chat-events";
import { realtimeLog } from "@/lib/realtime/debug";
import {
  setWorkerTimeout,
  clearWorkerTimer,
  acquire,
  release,
} from "@/lib/worker-timers";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * The browser's single subscription to `shop:<shopId>:chat`.
 *
 * Several places want chat events at once — the nav badge in
 * `StaffChatAttentionContext` and the chat page itself — and each used to open
 * its own channel. Two channels on the same topic over one socket is a
 * duplicate join, which at best doubles the work and at worst errors the
 * channel and cycles the shared socket. Since the socket is shared with the
 * job board, that took the board's live updates down as collateral.
 *
 * So the channel lives here instead of in the hook: the first consumer opens
 * it, later consumers attach to the same one, and it closes when the last
 * consumer goes away. Consumers register through `subscribeToChatEvents`.
 *
 * Nothing here touches the jobs channel. Teardown removes this channel by
 * reference (never `removeAllChannels`), and the cached Realtime token is left
 * alone because the jobs channel shares it and may still be mounted.
 */

/**
 * Called with the conversations that changed, or `null` when events may have
 * been missed (a reconnect) and everything on screen should refetch.
 */
export type ChatChangeListener = (
  conversationIds: ReadonlySet<string> | null
) => void;

/**
 * Coalescing window for bursts of events. One inbound text can produce a
 * message event and a conversation event milliseconds apart, and the AI
 * assistant's reply lands right behind it — one flush covers them all.
 * Short enough that a message still lands in well under a second.
 */
const FLUSH_DEBOUNCE_MS = 120;

const listeners = new Set<ChatChangeListener>();

let channel: RealtimeChannel | null = null;
let debounceId: string | null = null;
let pending = new Set<string>();
/**
 * Bumped by every start and stop. An in-flight `subscribe()` compares against
 * it after awaiting the token and bails if the world moved on, so a fast
 * mount/unmount/mount cannot leave an orphaned channel behind.
 */
let generation = 0;
/** True between a successful `acquire()` and its matching `release()`. */
let holdingWorker = false;
// The first SUBSCRIBED is the initial connect, which each consumer's own
// initial fetch already covers. Later ones mean we reconnected and may have
// missed events while offline, so those do need a catch-up.
let hasSubscribed = false;

function notify(conversationIds: ReadonlySet<string> | null): void {
  // Copy first: a listener may unsubscribe itself while being called.
  for (const listener of [...listeners]) {
    listener(conversationIds);
  }
}

function flush(): void {
  debounceId = null;
  if (pending.size === 0) return;
  const batch = pending;
  pending = new Set();
  realtimeLog("chat", `flushing ${batch.size} conversation(s) to ${listeners.size} consumer(s)`);
  notify(batch);
}

function scheduleFlush(conversationId: string): void {
  pending.add(conversationId);
  if (debounceId) clearWorkerTimer(debounceId);
  debounceId = setWorkerTimeout(flush, FLUSH_DEBOUNCE_MS);
}

function start(): void {
  const supabase = getRealtimeClient();
  if (!supabase) {
    realtimeLog("chat", "no Supabase client (env vars missing)");
    return;
  }

  const gen = ++generation;
  acquire();
  holdingWorker = true;

  void (async () => {
    // Also tells us which topic we are allowed to join — the server names it.
    const auth = await getRealtimeAuth();
    if (gen !== generation) return;
    if (!auth) {
      console.warn(
        "[realtime] no chat channel authorization — chat will refresh on its SSE stream only"
      );
      return;
    }

    realtimeLog("chat", `joining ${auth.chatChannel}`);

    const next = supabase.channel(auth.chatChannel, {
      config: { private: true },
    });

    for (const event of CHAT_REALTIME_EVENTS) {
      next.on("broadcast", { event }, (message) => {
        const payload = message.payload as ChatRealtimePayload | undefined;
        // Belt and braces: RLS already scopes the topic to this shop.
        if (payload?.shopId && payload.shopId !== auth.shopId) return;
        if (!payload?.conversationId) return;
        realtimeLog("chat", `received ${event}`, {
          conversationId: payload.conversationId,
        });
        scheduleFlush(payload.conversationId);
      });
    }

    next.subscribe((status, error) => {
      if (gen !== generation) return;
      realtimeLog("chat", `channel status ${status}`, error?.message);
      if (status === "SUBSCRIBED") {
        if (hasSubscribed) notify(null);
        hasSubscribed = true;
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // A persistent CHANNEL_ERROR here usually means the realtime.messages
        // policy has not been updated for the chat topic, or the JWT secret
        // does not match the project.
        console.warn(
          `[realtime] chat channel ${status.toLowerCase()}:`,
          error?.message ?? "no detail"
        );
      }
    });

    channel = next;
  })();
}

function stop(): void {
  // Invalidates any subscribe still waiting on its token.
  generation += 1;

  if (debounceId) {
    clearWorkerTimer(debounceId);
    debounceId = null;
  }
  pending = new Set();
  hasSubscribed = false;

  if (channel) {
    realtimeLog("chat", "closing channel — last consumer unmounted");
    // By reference on purpose. `removeAllChannels()` would close the jobs
    // channel too, since both share one Supabase client.
    const supabase = getRealtimeClient();
    if (supabase) void supabase.removeChannel(channel);
    channel = null;
  }

  if (holdingWorker) {
    release();
    holdingWorker = false;
  }
}

/**
 * Registers `listener` for chat events, opening the shared channel if this is
 * the first consumer. Returns the unregister function; the channel closes once
 * the last consumer unregisters.
 */
export function subscribeToChatEvents(listener: ChatChangeListener): () => void {
  listeners.add(listener);
  realtimeLog("chat", `consumer attached (${listeners.size} total)`);
  if (listeners.size === 1) start();

  let released = false;
  return () => {
    // Guard against a double call — React may invoke a cleanup once, but a
    // caller holding the function should not be able to unbalance the count.
    if (released) return;
    released = true;
    listeners.delete(listener);
    realtimeLog("chat", `consumer detached (${listeners.size} remaining)`);
    if (listeners.size === 0) stop();
  };
}
