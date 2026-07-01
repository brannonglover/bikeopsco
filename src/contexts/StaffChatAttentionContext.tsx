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
import { useChatNotifications, NOTIFICATION_POLL_MS } from "@/hooks/useChatNotifications";
import { useChatEventSource } from "@/hooks/useChatEventSource";

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

  const applyConversations = useCallback((data: Conversation[]) => {
    setConversations(data);
  }, []);

  const fetchConversations = useCallback(async () => {
    if (!syncEnabled) return;
    const res = await fetch("/api/conversations", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      applyConversations(data);
    }
  }, [syncEnabled, applyConversations]);

  useEffect(() => {
    if (syncEnabled) {
      fetchConversations();
    } else {
      setConversations([]);
    }
  }, [syncEnabled, fetchConversations]);

  useChatEventSource<Conversation[]>({
    url: syncEnabled ? "/api/conversations/stream" : null,
    enabled: syncEnabled,
    onUpdate: applyConversations,
    fallbackPoll: fetchConversations,
    fallbackIntervalMs: NOTIFICATION_POLL_MS,
  });

  useChatNotifications(conversations, fetchConversations, null, false);

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
