"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Job } from "@/lib/types";
import { playNotificationSound } from "@/lib/notificationSound";
import { useVisibilityAwarePolling } from "@/hooks/useVisibilityAwarePolling";

const JOB_POLL_MS = 5000;
const FULL_BOARD_REFRESH_MS = 60_000;
const BOARD_SUMMARY_URL = "/api/jobs?view=board&summary=1";

type BoardSummaryRow = {
  id: string;
  stage: string;
  updatedAt: string;
};

function boardSummaryFingerprint(rows: BoardSummaryRow[]): string {
  return rows
    .map((row) => `${row.id}:${row.stage}:${row.updatedAt}`)
    .sort()
    .join("|");
}

function requestPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted" || Notification.permission === "denied") return;
  Notification.requestPermission();
}

export function useJobNotifications(jobs: Job[], fetchJobs: () => void): void {
  const seenJobIds = useRef<Set<string>>(new Set());
  const hasInitialized = useRef(false);
  const summaryBaseline = useRef<string | null>(null);
  const lastFullRefreshAt = useRef(0);

  const requestPermissionCb = useCallback(requestPermission, []);

  useEffect(() => {
    requestPermissionCb();
  }, [requestPermissionCb]);

  useEffect(() => {
    if (jobs.length > 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      jobs.forEach((j) => seenJobIds.current.add(j.id));
    }
  }, [jobs]);

  const pollBoardSummary = useCallback(async () => {
    try {
      const res = await fetch(BOARD_SUMMARY_URL, { cache: "no-store" });
      if (!res.ok) return;

      const data = await res.json();
      if (!Array.isArray(data)) return;

      const rows = data as BoardSummaryRow[];
      const fingerprint = boardSummaryFingerprint(rows);

      if (summaryBaseline.current === null) {
        summaryBaseline.current = fingerprint;
        lastFullRefreshAt.current = Date.now();
        return;
      }

      const summaryChanged = fingerprint !== summaryBaseline.current;
      const refreshDue = Date.now() - lastFullRefreshAt.current >= FULL_BOARD_REFRESH_MS;

      if (summaryChanged || refreshDue) {
        summaryBaseline.current = fingerprint;
        lastFullRefreshAt.current = Date.now();
        fetchJobs();
      }
    } catch {
      // Ignore transient poll errors; next interval retries.
    }
  }, [fetchJobs]);

  useVisibilityAwarePolling(() => {
    void pollBoardSummary();
  }, JOB_POLL_MS);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    for (const job of jobs) {
      if (seenJobIds.current.has(job.id)) continue;
      seenJobIds.current.add(job.id);

      const customerName = job.customer
        ? job.customer.lastName
          ? `${job.customer.firstName} ${job.customer.lastName}`
          : job.customer.firstName
        : "Unknown";

      try {
        const n = new Notification("New Job", {
          body: `${customerName} · ${job.bikeMake} ${job.bikeModel}`,
          icon: "/favicon.ico",
          tag: `job-${job.id}`,
        });
        playNotificationSound();
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // Ignore notification errors
      }
    }
  }, [jobs]);
}
