"use client";

import { useEffect, useRef } from "react";
import {
  subscribeToChatEvents,
  type ChatChangeListener,
} from "@/lib/realtime/chat-subscription";

/**
 * Tells the caller which conversations changed on this shop's private chat
 * channel. Events are notifications only — the payload identifies the
 * conversation, and the chat APIs remain the source of truth.
 *
 * This sits *on top of* the chat SSE streams rather than replacing them. SSE
 * still re-checks the database every few seconds, so a Realtime outage, an
 * unconfigured environment, or a dropped broadcast costs freshness and nothing
 * else. What Realtime adds is the common case: a message appears the moment it
 * arrives instead of on the next poll tick.
 *
 * The channel itself lives in `@/lib/realtime/chat-subscription` and is shared
 * by every consumer, so mounting this hook twice — the nav badge and the chat
 * page, say — joins the topic once rather than opening a duplicate channel.
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
  onChange: ChatChangeListener;
}): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    // Indirect through the ref so a new `onChange` identity each render does
    // not detach and reattach this consumer (which, when it is the only one,
    // would close and reopen the shared channel).
    return subscribeToChatEvents((conversationIds) => {
      onChangeRef.current(conversationIds);
    });
  }, [enabled]);
}
