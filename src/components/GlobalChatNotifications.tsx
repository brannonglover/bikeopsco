"use client";

import { useState, useCallback, useEffect } from "react";
import { useChatNotifications } from "@/hooks/useChatNotifications";
import type { Conversation } from "@/lib/types";

export function GlobalChatNotifications() {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      setConversations(data);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useChatNotifications(conversations, fetchConversations, null);

  return null;
}
