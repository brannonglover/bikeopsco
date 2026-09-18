"use client";

import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { BOARD_JOBS_QUERY_KEY } from "@/lib/board-jobs";
import { getRealtimeClient } from "@/lib/realtime/client";
import { clearRealtimeAuth, getRealtimeAuth } from "@/lib/realtime/access-token";
import {
  JOB_REALTIME_EVENTS,
  type JobRealtimePayload,
} from "@/lib/realtime/job-events";
import { setWorkerTimeout, clearWorkerTimer, acquire, release } from "@/lib/worker-timers";
import type { RealtimeChannel } from "@supabase/supabase-js";

/**
 * Coalescing window for bursts of events. A single staff action can touch a
 * job several times (stage + services + payment), and those land as separate
 * broadcasts within milliseconds of each other — one refetch covers them all.
 */
const INVALIDATE_DEBOUNCE_MS = 250;

/**
 * Subscribes to this shop's private job channel and invalidates the board query
 * when something changes. Events are notifications only — the payload
 * identifies the job, and `/api/jobs?view=board` remains the source of truth.
 *
 * The channel is not named from client state: `/api/realtime/token` resolves
 * the shop from the NextAuth session and returns both the topic and a
 * short-lived JWT carrying that shop. Supabase then enforces the match in RLS,
 * so editing anything in the browser cannot reach another tenant's channel.
 *
 * Catch-up after a dropped connection is handled two ways: re-subscribing
 * invalidates once, and `useForegroundSync` still fires on visible / focus / wake.
 */
export function useJobRealtime(
  queryClient: QueryClient,
  { enabled = true }: { enabled?: boolean } = {}
): void {
  useEffect(() => {
    if (!enabled) return;

    const supabase = getRealtimeClient();
    if (!supabase) return;

    acquire();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    let debounceId: string | null = null;
    // The first SUBSCRIBED is the initial connect, which the provider's
    // prefetch already covers. Later ones mean we reconnected and may have
    // missed events while offline, so those do need a catch-up refetch.
    let hasSubscribed = false;

    const invalidateBoard = () => {
      void queryClient.invalidateQueries({ queryKey: BOARD_JOBS_QUERY_KEY });
    };

    const scheduleInvalidate = () => {
      if (cancelled) return;
      if (debounceId) clearWorkerTimer(debounceId);
      debounceId = setWorkerTimeout(() => {
        debounceId = null;
        if (!cancelled) invalidateBoard();
      }, INVALIDATE_DEBOUNCE_MS);
    };

    const subscribe = async () => {
      // Also tells us which topic we are allowed to join — the server names it.
      const auth = await getRealtimeAuth();
      if (cancelled) return;
      if (!auth) {
        console.warn(
          "[realtime] no job channel authorization — falling back to foreground sync"
        );
        return;
      }

      const next = supabase.channel(auth.channel, { config: { private: true } });

      for (const event of JOB_REALTIME_EVENTS) {
        next.on("broadcast", { event }, (message) => {
          const payload = message.payload as JobRealtimePayload | undefined;
          // Belt and braces: RLS already scopes the topic to this shop.
          if (payload?.shopId && payload.shopId !== auth.shopId) return;
          scheduleInvalidate();
        });
      }

      next.subscribe((status, error) => {
        if (status === "SUBSCRIBED") {
          if (hasSubscribed) invalidateBoard();
          hasSubscribed = true;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // A persistent CHANNEL_ERROR here usually means the realtime.messages
          // policy is missing or the JWT secret does not match the project.
          console.warn(
            `[realtime] job channel ${status.toLowerCase()}:`,
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
      clearRealtimeAuth();
      release();
    };
  }, [queryClient, enabled]);
}
