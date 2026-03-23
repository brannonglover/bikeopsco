"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "@/lib/types";

const SHOP_NAME = process.env.NEXT_PUBLIC_SHOP_NAME || "Bike Shop";

function getMessagePreview(msg: ChatMessage): string {
  const text = msg.body?.trim();
  const hasAttachment = msg.attachments?.length ? msg.attachments.length > 0 : false;
  return text || (hasAttachment ? "📎 Sent an image" : "New message");
}

export function useCustomerChatNotifications(messages: ChatMessage[], isActive: boolean) {
  const seenMessageIds = useRef<Set<string>>(new Set());
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (!isActive) return;

    const requestPermission = async () => {
      if (Notification.permission === "granted") return;
      if (Notification.permission === "denied") return;
      await Notification.requestPermission();
    };

    if (!hasInitialized.current) {
      hasInitialized.current = true;
      requestPermission();
      messages.forEach((m) => seenMessageIds.current.add(m.id));
    }
  }, [isActive, messages]);

  useEffect(() => {
    if (!isActive || typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    if (!hasInitialized.current) return;

    const staffMessages = messages.filter((m) => m.sender === "STAFF");
    for (const msg of staffMessages) {
      if (seenMessageIds.current.has(msg.id)) continue;
      seenMessageIds.current.add(msg.id);

      if (document.hidden) {
        try {
          const n = new Notification(SHOP_NAME, {
            body: getMessagePreview(msg),
            icon: "/favicon.ico",
            tag: `customer-chat-${msg.id}`,
          });
          n.onclick = () => {
            window.focus();
            n.close();
          };
        } catch {
          // Ignore notification errors
        }
      }
    }
  }, [messages, isActive]);
}
