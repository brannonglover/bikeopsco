"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVisibilityAwarePolling } from "@/hooks/useVisibilityAwarePolling";

const POLL_INTERVAL_MS = 60_000;
const SW_URL = "/bikeops-sw.js";

type VersionResponse = {
  version?: string;
  releaseNotesUrl?: string;
};

export type AppVersionCheck = {
  updateAvailable: boolean;
  releaseNotesUrl: string | null;
  applyUpdate: () => void;
};

function canUseServiceWorker(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    window.isSecureContext &&
    process.env.NODE_ENV === "production"
  );
}

/**
 * Soft-update detection + opt-in apply.
 *
 * A service worker freezes the staff UI on the version that first controlled
 * the tab. Normal refresh keeps that version. Only "Update now" activates the
 * waiting worker (or reloads if no worker is present yet).
 */
export function useAppVersionCheck(enabled = true): AppVersionCheck {
  const baselineRef = useRef<string | null>(null);
  const refreshingRef = useRef(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [releaseNotesUrl, setReleaseNotesUrl] = useState<string | null>(null);

  const markUpdateAvailable = useCallback((notesUrl?: string | null) => {
    setUpdateAvailable(true);
    if (notesUrl) setReleaseNotesUrl(notesUrl);
  }, []);

  const syncWaitingWorker = useCallback(
    (registration: ServiceWorkerRegistration) => {
      if (registration.waiting) {
        markUpdateAvailable();
      }
    },
    [markUpdateAvailable]
  );

  useEffect(() => {
    if (!enabled || !canUseServiceWorker()) return;

    let cancelled = false;
    let registration: ServiceWorkerRegistration | null = null;

    const onControllerChange = () => {
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      window.location.reload();
    };

    const onUpdateFound = () => {
      const installing = registration?.installing;
      if (!installing) return;
      installing.addEventListener("statechange", () => {
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          markUpdateAvailable();
        }
      });
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    void navigator.serviceWorker
      .register(SW_URL)
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        syncWaitingWorker(reg);
        reg.addEventListener("updatefound", onUpdateFound);
      })
      .catch(() => {
        // Registration can fail on unsupported browsers; version poll still works.
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      registration?.removeEventListener("updatefound", onUpdateFound);
    };
  }, [enabled, markUpdateAvailable, syncWaitingWorker]);

  const check = useCallback(() => {
    if (typeof window === "undefined") return;

    void fetch("/api/version", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (data: VersionResponse | null) => {
        const version = data?.version?.trim();
        if (!version) return;

        if (baselineRef.current === null) {
          baselineRef.current = version;
          return;
        }

        if (version !== baselineRef.current) {
          markUpdateAvailable(data?.releaseNotesUrl?.trim() || null);
          if (canUseServiceWorker()) {
            try {
              const reg = await navigator.serviceWorker.getRegistration(SW_URL);
              await reg?.update();
              if (reg) syncWaitingWorker(reg);
            } catch {
              // Ignore; banner still shows from the version mismatch.
            }
          }
        }
      })
      .catch(() => {
        // Ignore transient network errors; the next poll retries.
      });
  }, [markUpdateAvailable, syncWaitingWorker]);

  useVisibilityAwarePolling(check, POLL_INTERVAL_MS, {
    enabled,
    hiddenIntervalMs: null,
    runImmediately: true,
  });

  const applyUpdate = useCallback(() => {
    void (async () => {
      if (!canUseServiceWorker()) {
        window.location.reload();
        return;
      }

      try {
        const reg = await navigator.serviceWorker.getRegistration(SW_URL);
        await reg?.update();

        if (reg?.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
          // controllerchange handler reloads once the new worker activates.
          window.setTimeout(() => {
            if (!refreshingRef.current) {
              refreshingRef.current = true;
              window.location.reload();
            }
          }, 1500);
          return;
        }
      } catch {
        // Fall through to a hard reload.
      }

      refreshingRef.current = true;
      window.location.reload();
    })();
  }, []);

  return { updateAvailable, releaseNotesUrl, applyUpdate };
}
