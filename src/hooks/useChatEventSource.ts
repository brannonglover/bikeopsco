"use client";

import { useEffect, useRef, useState } from "react";
import { useVisibilityAwarePolling } from "@/hooks/useVisibilityAwarePolling";

const MAX_SSE_FAILURES = 3;

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
  const failureCountRef = useRef(0);

  useEffect(() => {
    setUseFallback(false);
    failureCountRef.current = 0;
  }, [url]);

  useEffect(() => {
    if (!enabled || !url || useFallback) return;
    if (typeof EventSource === "undefined") {
      setUseFallback(true);
      return;
    }

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      es = new EventSource(url);

      es.addEventListener("update", (event) => {
        failureCountRef.current = 0;
        try {
          onUpdateRef.current(JSON.parse((event as MessageEvent).data) as T);
        } catch {
          // Ignore malformed payloads.
        }
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
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      closed = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [url, enabled, useFallback]);

  useVisibilityAwarePolling(
    () => fallbackPoll?.(),
    fallbackIntervalMs,
    {
      enabled: useFallback && enabled && !!fallbackPoll,
      runImmediately: true,
    }
  );
}
