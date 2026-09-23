"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Job } from "@/lib/types";
import { BOARD_JOBS_QUERY_KEY } from "@/lib/board-jobs";
import { playNotificationSound } from "@/lib/notificationSound";
import { realtimeLog } from "@/lib/realtime/debug";
import { useForegroundSync } from "@/hooks/useForegroundSync";
import { useJobRealtime } from "@/hooks/useJobRealtime";

function requestPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted" || Notification.permission === "denied") return;
  Notification.requestPermission();
}

function isBoardJobsQueryKey(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === BOARD_JOBS_QUERY_KEY[0] && queryKey[1] === BOARD_JOBS_QUERY_KEY[1];
}

/**
 * Keeps the staff board fresh and raises a desktop notification for jobs that
 * appear while the board is open.
 *
 * Freshness comes from Supabase Realtime (see `useJobRealtime`) rather than
 * interval polling: the server broadcasts a minimal event on mutation, and the
 * board refetches `/api/jobs?view=board`. `useForegroundSync` remains the
 * backstop for anything missed while the connection was down — it fires when
 * the tab becomes visible, the window regains focus, or the machine wakes.
 */
export function useJobNotifications(
  queryClient: QueryClient,
  options?: { enabled?: boolean }
): void {
  const enabled = options?.enabled ?? true;
  const seenJobIds = useRef<Set<string>>(new Set());
  const hasInitialized = useRef(false);
  const [jobs, setJobs] = useState<Job[]>(
    () => queryClient.getQueryData<Job[]>(BOARD_JOBS_QUERY_KEY) ?? []
  );

  useJobRealtime(queryClient, { enabled });

  const syncOnForeground = useCallback(() => {
    // Independent of the socket on purpose: this is what makes a job created
    // while the tab was backgrounded appear the moment you come back, whether
    // or not Realtime has finished reconnecting.
    realtimeLog("foreground", "tab visible/focused — refetching board");
    void queryClient
      .invalidateQueries({ queryKey: BOARD_JOBS_QUERY_KEY })
      .then(() => {
        const jobs = queryClient.getQueryData<Job[]>(BOARD_JOBS_QUERY_KEY);
        realtimeLog(
          "foreground",
          `board refetch settled — ${jobs?.length ?? 0} jobs on the board`
        );
      });
  }, [queryClient]);

  useForegroundSync(syncOnForeground, { enabled });

  useEffect(() => {
    const syncFromCache = () => {
      setJobs(queryClient.getQueryData<Job[]>(BOARD_JOBS_QUERY_KEY) ?? []);
    };
    syncFromCache();
    return queryClient.getQueryCache().subscribe((event) => {
      if (event?.query && isBoardJobsQueryKey(event.query.queryKey)) {
        syncFromCache();
      }
    });
  }, [queryClient]);

  useEffect(() => {
    requestPermission();
  }, []);

  useEffect(() => {
    if (jobs.length > 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      jobs.forEach((j) => seenJobIds.current.add(j.id));
    }
  }, [jobs]);

  useEffect(() => {
    if (!enabled) return;
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
  }, [enabled, jobs]);
}
