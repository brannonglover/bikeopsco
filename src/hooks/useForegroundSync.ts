"use client";

import { useEffect, useRef } from "react";

/**
 * Fires `onSync` whenever the document transitions hidden → visible **or**
 * the browser window regains focus.
 *
 * The two events are deduplicated within a short window so that the rapid
 * `visibilitychange` + `focus` sequence that browsers typically emit
 * together results in a single callback invocation.
 *
 * This provides an authoritative foreground-sync guarantee: even if
 * background timers and Web Workers were completely suspended by the
 * browser, returning to the tab always triggers an immediate sync.
 */
export function useForegroundSync(
  onSync: () => void,
  options?: { enabled?: boolean }
): void {
  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const enabled = options?.enabled ?? true;
  const lastSyncAt = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const DEDUP_MS = 300;

    const sync = () => {
      const now = Date.now();
      if (now - lastSyncAt.current < DEDUP_MS) return;
      lastSyncAt.current = now;
      onSyncRef.current();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) sync();
    };

    const onFocus = () => {
      sync();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [enabled]);
}
