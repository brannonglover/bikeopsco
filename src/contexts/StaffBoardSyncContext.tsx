"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import {
  BOARD_JOBS_QUERY_KEY,
  fetchBoardJobsClient,
} from "@/lib/board-jobs";
import { useDeferredSyncEnabled } from "@/hooks/useDeferredSyncEnabled";
import { useJobNotifications } from "@/hooks/useJobNotifications";

const StaffBoardSyncContext = createContext({ syncEnabled: false });

export function StaffBoardSyncProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { status } = useSession();
  const queryClient = useQueryClient();
  const isJobBoardPage = pathname === "/calendar";
  const staffAuthenticated = status === "authenticated";
  const deferredSyncEnabled = useDeferredSyncEnabled(
    staffAuthenticated && !isJobBoardPage
  );
  const syncEnabled = staffAuthenticated && (isJobBoardPage || deferredSyncEnabled);

  useEffect(() => {
    if (!syncEnabled) return;
    void queryClient.prefetchQuery({
      queryKey: BOARD_JOBS_QUERY_KEY,
      queryFn: fetchBoardJobsClient,
      staleTime: 30_000,
    });
  }, [syncEnabled, queryClient]);

  useJobNotifications(queryClient, { enabled: syncEnabled });

  const value = useMemo(() => ({ syncEnabled }), [syncEnabled]);

  return (
    <StaffBoardSyncContext.Provider value={value}>
      {children}
    </StaffBoardSyncContext.Provider>
  );
}

export function useStaffBoardSyncEnabled() {
  return useContext(StaffBoardSyncContext).syncEnabled;
}
