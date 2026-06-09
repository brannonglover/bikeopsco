"use client";

import { useEffect, useRef, useCallback } from "react";
import { playNotificationSound } from "@/lib/notificationSound";

const WAITLIST_POLL_MS = 5000;

export type WaitlistNotificationEntry = {
  id: string;
  firstName: string;
  lastName: string;
  bikes: { make: string; model: string | null }[];
};

function requestPermission(): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission === "granted" || Notification.permission === "denied") return;
  Notification.requestPermission();
}

function formatBikeSummary(entry: WaitlistNotificationEntry): string {
  if (entry.bikes.length === 1) {
    const bike = entry.bikes[0];
    return `${bike.make}${bike.model ? ` ${bike.model}` : ""}`;
  }
  return `${entry.bikes.length} bikes`;
}

export function useWaitlistNotifications(
  entries: WaitlistNotificationEntry[],
  fetchEntries: () => void,
  suppressNotifications = false
): void {
  const seenEntryIds = useRef<Set<string>>(new Set());
  const hasInitialized = useRef(false);

  const requestPermissionCb = useCallback(requestPermission, []);

  useEffect(() => {
    requestPermissionCb();
  }, [requestPermissionCb]);

  useEffect(() => {
    if (entries.length > 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      entries.forEach((e) => seenEntryIds.current.add(e.id));
    }
  }, [entries]);

  useEffect(() => {
    const interval = setInterval(fetchEntries, WAITLIST_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchEntries();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchEntries]);

  useEffect(() => {
    if (suppressNotifications) return;
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    for (const entry of entries) {
      if (seenEntryIds.current.has(entry.id)) continue;
      seenEntryIds.current.add(entry.id);

      const customerName = entry.lastName
        ? `${entry.firstName} ${entry.lastName}`
        : entry.firstName;
      const bikeSummary = formatBikeSummary(entry);

      try {
        const n = new Notification("New Waitlist Request", {
          body: `${customerName} · ${bikeSummary}`,
          icon: "/favicon.ico",
          tag: `waitlist-${entry.id}`,
        });
        playNotificationSound();
        n.onclick = () => {
          window.focus();
          window.location.href = "/waitlist";
          n.close();
        };
      } catch {
        // Ignore notification errors
      }
    }
  }, [entries, suppressNotifications]);
}
