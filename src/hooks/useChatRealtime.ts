"use client";

import { useEffect, useRef } from "react";
import { getRealtimeClient } from "@/lib/realtime/client";
import { getRealtimeAuth } from "@/lib/realtime/access-token";
import {
  CHAT_REALTIME_EVENTS,
  type ChatRealtimePayload,
} from "@/lib/realtime/chat-events";
import {
  setWorkerTimeout,
  clearWorkerTimer,
  acquire,
  release,
} from "@/lib/worker-timers";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Coalescing window for bursts of events. One inbound text can produce a
 * message event and a conversation event milliseconds apart, and the AI
 * assistant's reply lands right behind it — one refetch covers them all.
 * Short enough that a message still lands in well under a second.
 */
const REFETCH_DEBOUNCE_MS = 120;

/**
 * Subscribes to this shop's private chat channel and tells the caller which
 * conversations changed. Events are notifications only — the payload
 * identifies the conversation, and the chat APIs remain the source of truth.
 *
 * This sits *on top of* the chat SSE streams rather than replacing them. SSE
 * still re-checks the database every few seconds, so a Realtime outage, an
 * unconfigured environment, or a dropped broadcast costs freshness and nothing
 * else. What Realtime adds is the common case: a message appears the moment it
 * arrives instead of on the next poll tick.
 *
 * The channel is not named from client state: `/api/realtime/token` resolves
 * the shop from the NextAuth session and returns the topic alongside a
 * short-lived JWT carrying that shop, and Supabase enforces the match in RLS.
 */
export function useChatRealtime({
  enabled = true,
  onChange,
}: {
  enabled?: boolean;
  /**
   * Called with the conversations that changed, or `null` when events may
   * have been missed (a reconnect) and everything on screen should refetch.
   */
  onChange: (conversationIds: ReadonlySet<string> | null) => void;
}): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;

    const supabase = getRealtimeClient();
    if (!supabase) return;

    acquire();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let debounceId: string | null = null;
    let pending = new Set<string>();
    // The first SUBSCRIBED is the initial connect, which the page's own load
    // already covers. Later ones mean we reconnected and may have missed
    // events while offline, so those do need a catch-up refetch.
    let hasSubscribed = false;

    const flush = () => {
      debounceId = null;
      if (cancelled || pending.size === 0) return;
      const batch = pending;
      pending = new Set();
      onChangeRef.current(batch);
    };

    const scheduleFlush = (conversationId: string) => {
      if (cancelled) return;
      pending.add(conversationId);
      if (debounceId) clearWorkerTimer(debounceId);
      debounceId = setWorkerTimeout(flush, REFETCH_DEBOUNCE_MS);
    };

    const subscribe = async () => {
      // Also tells us which topic we are allowed to join — the server names it.
      const auth = await getRealtimeAuth();
      if (cancelled) return;
      if (!auth) {
        console.warn(
          "[realtime] no chat channel authorization — chat will refresh on its SSE stream only"
        );
        return;
      }

      const next = supabase.channel(auth.chatChannel, {
        config: { private: true },
      });

      for (const event of CHAT_REALTIME_EVENTS) {
        next.on("broadcast", { event }, (message) => {
          const payload = message.payload as ChatRealtimePayload | undefined;
          // Belt and braces: RLS already scopes the topic to this shop.
          if (payload?.shopId && payload.shopId !== auth.shopId) return;
          if (!payload?.conversationId) return;
          scheduleFlush(payload.conversationId);
        });
      }

      next.subscribe((status, error) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          if (hasSubscribed) onChangeRef.current(null);
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
    };

    void subscribe();

    return () => {
      cancelled = true;
      if (debounceId) {
        clearWorkerTimer(debounceId);
        debounceId = null;
      }
      if (channel) void supabase.removeChannel(channel);
      // Deliberately does not call `clearRealtimeAuth()`: the jobs channel
      // shares that cached token and may still be mounted.
      release();
    };
  }, [enabled]);
}
