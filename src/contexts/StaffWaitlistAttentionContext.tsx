"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  useWaitlistNotifications,
  type WaitlistNotificationEntry,
} from "@/hooks/useWaitlistNotifications";
import { useDeferredSyncEnabled } from "@/hooks/useDeferredSyncEnabled";

const StaffWaitlistAttentionContext = createContext(0);

export function StaffWaitlistAttentionProvider({
  children,
  syncEnabled,
}: {
  children: ReactNode;
  /** When false (staff on /waitlist), stop syncing and hide the nav badge. */
  syncEnabled: boolean;
}) {
  const deferredSyncEnabled = useDeferredSyncEnabled(syncEnabled);
  const [entries, setEntries] = useState<WaitlistNotificationEntry[]>([]);

  const fetchEntries = useCallback(async () => {
    if (!deferredSyncEnabled) return;
    const res = await fetch("/api/waitlist", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    }
  }, [deferredSyncEnabled]);

  useEffect(() => {
    if (deferredSyncEnabled) {
      fetchEntries();
    } else {
      setEntries([]);
    }
  }, [deferredSyncEnabled, fetchEntries]);

  useWaitlistNotifications(entries, fetchEntries, !deferredSyncEnabled);

  const waitingCount = useMemo(
    () => (deferredSyncEnabled ? entries.length : 0),
    [entries.length, deferredSyncEnabled]
  );

  return (
    <StaffWaitlistAttentionContext.Provider value={waitingCount}>
      {children}
    </StaffWaitlistAttentionContext.Provider>
  );
}

export function useStaffWaitlistWaitingCount() {
  return useContext(StaffWaitlistAttentionContext);
}
