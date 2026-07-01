"use client";

import { useEffect, useRef } from "react";

const DEFAULT_HIDDEN_INTERVAL_MS = 30_000;

type UseVisibilityAwarePollingOptions = {
  enabled?: boolean;
  /** Interval while the tab is hidden. `null` pauses until visible again. */
  hiddenIntervalMs?: number | null;
  runImmediately?: boolean;
};

/**
 * Polls on an interval that backs off while the document is hidden.
 * Refetches immediately when the tab becomes visible again.
 */
export function useVisibilityAwarePolling(
  callback: () => void,
  activeIntervalMs: number,
  options: UseVisibilityAwarePollingOptions = {}
): void {
  const {
    enabled = true,
    hiddenIntervalMs = DEFAULT_HIDDEN_INTERVAL_MS,
    runImmediately = true,
  } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || activeIntervalMs <= 0) return;

    let intervalId: ReturnType<typeof setInterval> | null = null;

    const resolveIntervalMs = (): number | null => {
      if (typeof document === "undefined") return activeIntervalMs;
      if (!document.hidden) return activeIntervalMs;
      return hiddenIntervalMs;
    };

    const clearScheduled = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const schedule = () => {
      clearScheduled();
      const ms = resolveIntervalMs();
      if (ms === null || ms <= 0) return;
      intervalId = setInterval(() => {
        callbackRef.current();
      }, ms);
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        callbackRef.current();
      }
      schedule();
    };

    if (runImmediately) {
      callbackRef.current();
    }
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearScheduled();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [enabled, activeIntervalMs, hiddenIntervalMs, runImmediately]);
}
