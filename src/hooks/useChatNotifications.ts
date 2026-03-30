"use client";

import { useEffect, useRef, useCallback } from "react";
import type { Conversation } from "@/lib/types";
import { playNotificationSound } from "@/lib/notificationSound";

const NOTIFICATION_POLL_MS = 4000;

function getCustomerName(conv: Conversation): string {
  const c = conv.customer;
  return c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;
}

function getMessagePreview(conv: Conversation): string {
  const last = conv.messages?.[0];
  if (!last) return "New message";
  const text = last.body?.trim();
  const hasAttachment = last.attachments?.length ? last.attachments.length > 0 : false;
  return text || (hasAttachment ? "📎 Sent an image" : "New message");
}

export function useChatNotifications(
  conversations: Conversation[],
  fetchConversations: () => void,
  selectedId: string | null,
  poll = true
) {
  const seenMessageIds = useRef<Set<string>>(new Set());
  const permissionRequested = useRef(false);
  const hasInitialized = useRef(false);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    if (!permissionRequested.current) {
      permissionRequested.current = true;
      await Notification.requestPermission();
    }
    return (Notification.permission as NotificationPermission) === "granted";
  }, []);

  useEffect(() => {
    if (conversations.length > 0 && !hasInitialized.current) {
      hasInitialized.current = true;
      conversations.forEach((conv) => {
        const last = conv.messages?.[0];
        if (last) seenMessageIds.current.add(last.id);
      });
    }
  }, [conversations]);

  useEffect(() => {
    requestPermission();
  }, [requestPermission]);

  useEffect(() => {
    if (!poll) return;
    const interval = setInterval(fetchConversations, NOTIFICATION_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchConversations();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchConversations, poll]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    for (const conv of conversations) {
      const last = conv.messages?.[0];
      if (!last || last.sender !== "CUSTOMER") continue;

      if (seenMessageIds.current.has(last.id)) continue;
      seenMessageIds.current.add(last.id);

      const isViewingThisConv = selectedId === conv.id;
      const isTabFocused = !document.hidden;
      if (isViewingThisConv && isTabFocused) continue;

      const title = getCustomerName(conv);
      const body = getMessagePreview(conv);

      try {
        const n = new Notification(title, {
          body,
          icon: "/favicon.ico",
          tag: `chat-${conv.id}-${last.id}`,
        });
        playNotificationSound();
        n.onclick = () => {
          window.focus();
          n.close();
        };
      } catch {
        // Ignore notification errors (e.g. in some embedded contexts)
      }
    }
  }, [conversations, selectedId]);
}
