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
import type { Conversation } from "@/lib/types";
import { hasUnreadCustomerMessage } from "@/lib/chat-unread";
import { useChatNotifications } from "@/hooks/useChatNotifications";

const StaffChatAttentionContext = createContext(0);
const StaffChatUnreadCustomerIdsContext = createContext<ReadonlySet<string>>(new Set());

export function StaffChatAttentionProvider({
  children,
  syncEnabled,
}: {
  children: ReactNode;
  /** When false (staff on /chat), stop syncing and hide the nav badge. */
  syncEnabled: boolean;
}) {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const fetchConversations = useCallback(async () => {
    if (!syncEnabled) return;
    const res = await fetch("/api/conversations", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setConversations(data);
    }
  }, [syncEnabled]);

  useEffect(() => {
    if (syncEnabled) {
      fetchConversations();
    } else {
      setConversations([]);
    }
  }, [syncEnabled, fetchConversations]);

  useChatNotifications(conversations, fetchConversations, null, syncEnabled);

  const waitingCount = useMemo(
    () => (syncEnabled ? conversations.filter(hasUnreadCustomerMessage).length : 0),
    [conversations, syncEnabled]
  );

  const unreadCustomerIds = useMemo(
    () =>
      new Set(
        syncEnabled
          ? conversations.filter(hasUnreadCustomerMessage).map((c) => c.customerId)
          : []
      ),
    [conversations, syncEnabled]
  );

  return (
    <StaffChatAttentionContext.Provider value={waitingCount}>
      <StaffChatUnreadCustomerIdsContext.Provider value={unreadCustomerIds}>
        {children}
      </StaffChatUnreadCustomerIdsContext.Provider>
    </StaffChatAttentionContext.Provider>
  );
}

export function useStaffChatWaitingCount() {
  return useContext(StaffChatAttentionContext);
}

/** Returns the set of customer IDs that have unread messages waiting for staff. */
export function useUnreadChatCustomerIds() {
  return useContext(StaffChatUnreadCustomerIdsContext);
}
