"use client";

import { useCallback, useRef, useState } from "react";
import { useVisibilityAwarePolling } from "@/hooks/useVisibilityAwarePolling";

const POLL_INTERVAL_MS = 60_000;

type VersionResponse = {
  version?: string;
  releaseNotesUrl?: string;
};

export type AppVersionCheck = {
  updateAvailable: boolean;
  releaseNotesUrl: string | null;
  applyUpdate: () => void;
};

/**
 * Soft-update detection: remember the deploy SHA from the first successful
 * poll, then show an update when production reports a different SHA.
 */
export function useAppVersionCheck(enabled = true): AppVersionCheck {
  const baselineRef = useRef<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [releaseNotesUrl, setReleaseNotesUrl] = useState<string | null>(null);

  const check = useCallback(() => {
    if (typeof window === "undefined") return;

    void fetch("/api/version", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: VersionResponse | null) => {
        const version = data?.version?.trim();
        if (!version) return;

        if (baselineRef.current === null) {
          baselineRef.current = version;
          return;
        }

        if (version !== baselineRef.current) {
          setUpdateAvailable(true);
          setReleaseNotesUrl(data?.releaseNotesUrl?.trim() || null);
        }
      })
      .catch(() => {
        // Ignore transient network errors; the next poll retries.
      });
  }, []);

  useVisibilityAwarePolling(check, POLL_INTERVAL_MS, {
    enabled,
    hiddenIntervalMs: null,
    runImmediately: true,
  });

  const applyUpdate = useCallback(() => {
    window.location.reload();
  }, []);

  return { updateAvailable, releaseNotesUrl, applyUpdate };
}
