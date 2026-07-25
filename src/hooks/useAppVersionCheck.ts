"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useVisibilityAwarePolling } from "@/hooks/useVisibilityAwarePolling";

const POLL_INTERVAL_MS = 60_000;
const SW_URL = "/bikeops-sw.js";
const STORAGE_CLIENT_VERSION = "bikeops_client_version";
const STORAGE_PENDING_UPDATE = "bikeops_pending_update";

type VersionResponse = {
  version?: string;
  releaseNotesUrl?: string;
};

type PendingUpdate = {
  version: string;
  releaseNotesUrl: string | null;
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

function readClientVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_CLIENT_VERSION)?.trim() || null;
  } catch {
    return null;
  }
}

function writeClientVersion(version: string) {
  try {
    localStorage.setItem(STORAGE_CLIENT_VERSION, version);
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function readPendingUpdate(): PendingUpdate | null {
  try {
    const raw = localStorage.getItem(STORAGE_PENDING_UPDATE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingUpdate>;
    const version = typeof parsed.version === "string" ? parsed.version.trim() : "";
    if (!version) return null;
    return {
      version,
      releaseNotesUrl:
        typeof parsed.releaseNotesUrl === "string" ? parsed.releaseNotesUrl : null,
    };
  } catch {
    return null;
  }
}

function writePendingUpdate(pending: PendingUpdate | null) {
  try {
    if (!pending) {
      localStorage.removeItem(STORAGE_PENDING_UPDATE);
      return;
    }
    localStorage.setItem(STORAGE_PENDING_UPDATE, JSON.stringify(pending));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/**
 * Soft-update detection + opt-in apply.
 *
 * The shop's adopted version is stored in localStorage until they click
 * "Update now", so the sidebar banner survives refreshes. A service worker
 * freezes UI assets the same way when available.
 */
export function useAppVersionCheck(enabled = true): AppVersionCheck {
  const refreshingRef = useRef(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [releaseNotesUrl, setReleaseNotesUrl] = useState<string | null>(null);

  const markUpdateAvailable = useCallback((version: string, notesUrl?: string | null) => {
    const pending: PendingUpdate = {
      version,
      releaseNotesUrl: notesUrl?.trim() || null,
    };
    writePendingUpdate(pending);
    setUpdateAvailable(true);
    setReleaseNotesUrl(pending.releaseNotesUrl);
  }, []);

  // Restore a previously shown update after refresh / remount.
  useEffect(() => {
    if (!enabled) return;
    const pending = readPendingUpdate();
    if (!pending) return;
    setUpdateAvailable(true);
    setReleaseNotesUrl(pending.releaseNotesUrl);
  }, [enabled]);

  const syncWaitingWorker = useCallback(
    (registration: ServiceWorkerRegistration) => {
      if (!registration.waiting) return;
      void fetch("/api/version", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data: VersionResponse | null) => {
          const version = data?.version?.trim() || `waiting-${Date.now()}`;
          markUpdateAvailable(version, data?.releaseNotesUrl?.trim() || null);
        })
        .catch(() => {
          markUpdateAvailable(`waiting-${Date.now()}`, null);
        });
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
          if (registration) syncWaitingWorker(registration);
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
  }, [enabled, syncWaitingWorker]);

  const check = useCallback(() => {
    if (typeof window === "undefined") return;

    void fetch("/api/version", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (data: VersionResponse | null) => {
        const version = data?.version?.trim();
        if (!version) return;

        const clientVersion = readClientVersion();
        if (!clientVersion) {
          // First visit (or after a successful Update now cleared state incorrectly).
          // Adopt current production unless a pending update was already stored.
          const pending = readPendingUpdate();
          if (pending && pending.version !== version) {
            // Stale pending from an older deploy — refresh notes for the live version.
            markUpdateAvailable(version, data?.releaseNotesUrl?.trim() || null);
            return;
          }
          if (pending && pending.version === version) {
            setUpdateAvailable(true);
            setReleaseNotesUrl(
              pending.releaseNotesUrl ?? data?.releaseNotesUrl?.trim() ?? null
            );
            return;
          }
          writeClientVersion(version);
          return;
        }

        if (version !== clientVersion) {
          markUpdateAvailable(version, data?.releaseNotesUrl?.trim() || null);
          if (canUseServiceWorker()) {
            try {
              const reg = await navigator.serviceWorker.getRegistration(SW_URL);
              await reg?.update();
              if (reg) syncWaitingWorker(reg);
            } catch {
              // Banner still shows from the version mismatch.
            }
          }
          return;
        }

        // Already on the latest version — clear any stale banner.
        writePendingUpdate(null);
        setUpdateAvailable(false);
        setReleaseNotesUrl(null);
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
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        const data = (response.ok ? await response.json() : null) as VersionResponse | null;
        const version = data?.version?.trim();
        if (version) writeClientVersion(version);
      } catch {
        // Still clear the banner and reload; next load re-adopts from /api/version.
      }
      writePendingUpdate(null);

      if (!canUseServiceWorker()) {
        refreshingRef.current = true;
        window.location.reload();
        return;
      }

      try {
        const reg = await navigator.serviceWorker.getRegistration(SW_URL);
        await reg?.update();

        if (reg?.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
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
