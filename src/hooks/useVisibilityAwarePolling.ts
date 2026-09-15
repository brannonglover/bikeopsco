"use client";

import { useEffect, useRef } from "react";
import {
  acquire,
  release,
  setWorkerInterval,
  clearWorkerTimer,
} from "@/lib/worker-timers";

type UseVisibilityAwarePollingOptions = {
  enabled?: boolean;
  /**
   * Interval while the tab is hidden.
   * - `undefined` (default): use the same interval as the active tab — no
   *   slowdown. This keeps data fresh in background tabs.
   * - a `number`: use a different (usually longer) interval when hidden.
   * - `null`: pause polling entirely until the tab becomes visible.
   */
  hiddenIntervalMs?: number | null;
  runImmediately?: boolean;
  /** Fire the callback immediately when the tab becomes visible. Default `true`. */
  fireOnVisible?: boolean;
};

/**
 * Polls on an interval using a Web Worker timer so that background-tab
 * throttling imposed by browsers does not delay updates.
 *
 * Optionally slows or pauses polling while the document is hidden and
 * fires the callback immediately when the tab becomes visible again.
 */
export function useVisibilityAwarePolling(
  callback: () => void,
  activeIntervalMs: number,
  options: UseVisibilityAwarePollingOptions = {}
): void {
  const {
    enabled = true,
    hiddenIntervalMs,
    runImmediately = true,
    fireOnVisible = true,
  } = options;

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled || activeIntervalMs <= 0) return;

    acquire();
    let timerId: string | null = null;

    const resolveIntervalMs = (): number | null => {
      if (typeof document === "undefined") return activeIntervalMs;
      if (!document.hidden) return activeIntervalMs;
      return hiddenIntervalMs === undefined ? activeIntervalMs : hiddenIntervalMs;
    };

    const clearScheduled = () => {
      if (timerId !== null) {
        clearWorkerTimer(timerId);
        timerId = null;
      }
    };

    const schedule = () => {
      clearScheduled();
      const ms = resolveIntervalMs();
      if (ms === null || ms <= 0) return;
      timerId = setWorkerInterval(() => {
        callbackRef.current();
      }, ms);
    };

    const onVisibilityChange = () => {
      if (!document.hidden && fireOnVisible) {
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
      release();
    };
  }, [enabled, activeIntervalMs, hiddenIntervalMs, runImmediately, fireOnVisible]);
}
