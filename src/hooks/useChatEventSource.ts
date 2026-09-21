"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForegroundSync } from "@/hooks/useForegroundSync";
import { useVisibilityAwarePolling } from "@/hooks/useVisibilityAwarePolling";
import {
  acquire,
  release,
  setWorkerTimeout,
  setWorkerInterval,
  clearWorkerTimer,
} from "@/lib/worker-timers";

const MAX_SSE_FAILURES = 3;

/**
 * Treat the stream as dead after this long without any server event. The
 * server sends a `heartbeat` every 3s, so silence this long means the socket
 * is half-open — which is what a frozen background tab or a slept machine
 * leaves behind, and what `onerror` can take tens of seconds to notice.
 */
const STALE_AFTER_MS = 12_000;
const STALE_CHECK_INTERVAL_MS = 4_000;

/**
 * On foreground, reconnect only if the stream has been quiet longer than this.
 * A tab that was merely unfocused kept receiving heartbeats and has nothing to
 * catch up on; a tab the browser suspended received nothing, and its last
 * activity is older than one heartbeat interval. This is what separates them.
 */
const FOREGROUND_STALE_AFTER_MS = 5_000;

type UseChatEventSourceOptions<T> = {
  url: string | null;
  enabled?: boolean;
  onUpdate: (data: T) => void;
  fallbackPoll?: () => void;
  fallbackIntervalMs?: number;
};

/**
 * Subscribes to a chat SSE endpoint with automatic reconnect.
 * Falls back to HTTP polling after repeated connection failures.
 *
 * Reconnection timers use a Web Worker so they are not throttled when the
 * browser tab is in the background.
 *
 * Two things guarantee catch-up when the browser has been suspended, since a
 * suspended tab's EventSource neither delivers events nor reports an error:
 *
 *   - a staleness watchdog that reconnects when the server's heartbeat stops
 *   - `useForegroundSync`, which reconnects on visible / focus / wake
 *
 * Both work by reconnecting, and a fresh connection's first event is the full
 * current payload — so either one also serves as the catch-up fetch.
 */
export function useChatEventSource<T>({
  url,
  enabled = true,
  onUpdate,
  fallbackPoll,
  fallbackIntervalMs = 3000,
}: UseChatEventSourceOptions<T>): void {
  const [useFallback, setUseFallback] = useState(false);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const fallbackPollRef = useRef(fallbackPoll);
  fallbackPollRef.current = fallbackPoll;
  const failureCountRef = useRef(0);
  /** Set by the connection effect so foreground sync can force a reconnect. */
  const reconnectIfStaleRef = useRef<((maxAgeMs: number) => void) | null>(null);

  useEffect(() => {
    setUseFallback(false);
    failureCountRef.current = 0;
  }, [url]);

  useEffect(() => {
    if (!enabled || !url || useFallback) {
      reconnectIfStaleRef.current = null;
      return;
    }
    if (typeof EventSource === "undefined") {
      setUseFallback(true);
      return;
    }

    // The shared worker is refcounted and terminated at zero, which would
    // silently kill the timers below if another consumer released last.
    acquire();

    let es: EventSource | null = null;
    let reconnectTimerId: string | null = null;
    let staleTimerId: string | null = null;
    let closed = false;
    let lastActivityAt = Date.now();

    const clearReconnectTimer = () => {
      if (reconnectTimerId) {
        clearWorkerTimer(reconnectTimerId);
        reconnectTimerId = null;
      }
    };

    const connect = () => {
      if (closed) return;
      clearReconnectTimer();
      lastActivityAt = Date.now();
      es = new EventSource(url);

      es.addEventListener("update", (event) => {
        lastActivityAt = Date.now();
        failureCountRef.current = 0;
        try {
          onUpdateRef.current(JSON.parse((event as MessageEvent).data) as T);
        } catch {
          // Ignore malformed payloads.
        }
      });

      // Liveness only — carries no data.
      es.addEventListener("heartbeat", () => {
        lastActivityAt = Date.now();
        failureCountRef.current = 0;
      });

      es.onerror = () => {
        es?.close();
        es = null;
        failureCountRef.current += 1;
        if (failureCountRef.current >= MAX_SSE_FAILURES) {
          setUseFallback(true);
          return;
        }
        if (!closed) {
          reconnectTimerId = setWorkerTimeout(connect, 2000);
        }
      };
    };

    /**
     * Drops the current connection and opens a new one immediately. Not a
     * failure: the count is left alone so a wake-up never pushes the stream
     * into polling fallback.
     */
    const reconnectNow = () => {
      if (closed) return;
      es?.close();
      es = null;
      connect();
    };

    const reconnectIfStale = (maxAgeMs: number) => {
      if (closed || !es) return;
      if (Date.now() - lastActivityAt > maxAgeMs) reconnectNow();
    };

    reconnectIfStaleRef.current = reconnectIfStale;
    connect();

    staleTimerId = setWorkerInterval(
      () => reconnectIfStale(STALE_AFTER_MS),
      STALE_CHECK_INTERVAL_MS
    );

    return () => {
      closed = true;
      reconnectIfStaleRef.current = null;
      es?.close();
      clearReconnectTimer();
      if (staleTimerId) clearWorkerTimer(staleTimerId);
      release();
    };
  }, [url, enabled, useFallback]);

  // Returning to the tab is the one moment the user is certainly looking, and
  // a suspended tab is exactly when the stream is most likely stale.
  const syncOnForeground = useCallback(() => {
    if (useFallback) {
      fallbackPollRef.current?.();
      return;
    }
    reconnectIfStaleRef.current?.(FOREGROUND_STALE_AFTER_MS);
  }, [useFallback]);

  useForegroundSync(syncOnForeground, { enabled: enabled && !!url });

  useVisibilityAwarePolling(
    () => fallbackPollRef.current?.(),
    fallbackIntervalMs,
    {
      enabled: useFallback && enabled && !!fallbackPoll,
      runImmediately: true,
    }
  );
}
