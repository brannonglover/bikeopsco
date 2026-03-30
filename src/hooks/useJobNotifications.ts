"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Job } from "@/lib/types";
import { playNotificationSound } from "@/lib/notificationSound";

const JOB_POLL_MS = 5000;

function requestPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted" || Notification.permission === "denied") return;
  Notification.requestPermission();
}

export function useJobNotifications(jobs: Job[], fetchJobs: () => void): void {
  const seenJobIds = useRef<Set<string>>(new Set());
  const hasInitialized = useRef(false);

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

  useEffect(() => {
    const interval = setInterval(fetchJobs, JOB_POLL_MS);
    return () => clearInterval(interval);
  }, [fetchJobs]);

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
          icon: "/favicon.png",
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
