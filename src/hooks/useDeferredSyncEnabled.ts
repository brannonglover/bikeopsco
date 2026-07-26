"use client";

import { useEffect, useState } from "react";

/**
 * Delays enabling background sync (chat/waitlist badges) until after first paint
 * so the job board network request isn't competing on cold load.
 */
export function useDeferredSyncEnabled(syncEnabled: boolean, delayMs = 1200): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!syncEnabled) {
      setReady(false);
      return;
    }

    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const enable = () => {
      if (!cancelled) setReady(true);
    };

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(enable, { timeout: delayMs + 800 });
    } else {
      timeoutId = setTimeout(enable, delayMs);
    }

    return () => {
      cancelled = true;
      if (idleId != null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [syncEnabled, delayMs]);

  return syncEnabled && ready;
}
