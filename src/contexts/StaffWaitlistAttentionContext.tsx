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

const StaffWaitlistAttentionContext = createContext(0);

export function StaffWaitlistAttentionProvider({
  children,
  syncEnabled,
}: {
  children: ReactNode;
  /** When false (staff on /waitlist), stop syncing and hide the nav badge. */
  syncEnabled: boolean;
}) {
  const [entries, setEntries] = useState<WaitlistNotificationEntry[]>([]);

  const fetchEntries = useCallback(async () => {
    if (!syncEnabled) return;
    const res = await fetch("/api/waitlist", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setEntries(Array.isArray(data) ? data : []);
    }
  }, [syncEnabled]);

  useEffect(() => {
    if (syncEnabled) {
      fetchEntries();
    } else {
      setEntries([]);
    }
  }, [syncEnabled, fetchEntries]);

  useWaitlistNotifications(entries, fetchEntries, !syncEnabled);

  const waitingCount = useMemo(
    () => (syncEnabled ? entries.length : 0),
    [entries.length, syncEnabled]
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
