"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage } from "@/lib/types";
import { useCustomerChatNotifications } from "@/hooks/useCustomerChatNotifications";
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";

const POLL_INTERVAL_MS = 3000;

export default function CustomerChatPage() {
  const [status, setStatus] = useState<"loading" | "login" | "chat">("loading");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSending, setLoginSending] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [staffLastReadAt, setStaffLastReadAt] = useState<string | null>(null);
  const [inputText, setInputText] = useState("");
  const [pendingImages, setPendingImages] = useState<{ id: string; url: string; filename: string }[]>([]);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const editingCountRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const isAtBottomRef = useRef(true);
  const typingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const sendTyping = useCallback((active: boolean) => {
    fetch("/api/chat/conversation/typing", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    }).catch(() => {});
  }, []);

  const stopTypingPing = useCallback(() => {
    if (typingIntervalRef.current) {
      clearInterval(typingIntervalRef.current);
      typingIntervalRef.current = null;
    }
    sendTyping(false);
  }, [sendTyping]);

  const startTypingPing = useCallback(() => {
    if (typingIntervalRef.current) return;
    sendTyping(true);
    typingIntervalRef.current = setInterval(() => sendTyping(true), 2000);
  }, [sendTyping]);

  useEffect(() => {
    return () => stopTypingPing();
  }, [stopTypingPing]);

  const fetchMessages = useCallback(async () => {
    const res = await fetch("/api/chat/conversation/messages", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        setMessages(data);
      } else {
        setMessages(data.messages ?? []);
        setStaffLastReadAt(data.staffLastReadAt ?? null);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
      const error = params.get("error");
      if (error === "expired") {
        setLoginMessage("That sign-in link has expired. Please request a new one below.");
      } else if (error === "invalid") {
        setLoginMessage("Invalid sign-in link. Please request a new one below.");
      }

      const hash = typeof window !== "undefined" ? window.location.hash : "";
      if (hash.startsWith("#token=")) {
        const token = decodeURIComponent(hash.slice("#token=".length));
        try {
          const res = await fetch("/api/chat/verify", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          if (!cancelled) {
            window.history.replaceState(null, "", window.location.pathname + window.location.search);
          }
          if (res.ok) {
            const me = await fetch("/api/chat/me", { credentials: "include" });
            if (me.ok && !cancelled) {
              const data = await me.json();
              setCustomerName(data.lastName ? `${data.firstName} ${data.lastName}` : data.firstName);
              setStatus("chat");
              return;
            }
          }
          if (!cancelled) {
            const err = await res.json().catch(() => ({}));
            const code = typeof err.error === "string" ? err.error : "invalid";
            if (code === "expired") {
              setLoginMessage("That sign-in link has expired. Please request a new one below.");
            } else {
              setLoginMessage(
                "That sign-in link is invalid or was already used. Please request a new one below."
              );
            }
            setStatus("login");
          }
          return;
        } catch {
          if (!cancelled) {
            setLoginMessage("Something went wrong. Please try again.");
            setStatus("login");
          }
          return;
        }
      }

      try {
        const res = await fetch("/api/chat/me", { credentials: "include" });
        if (!cancelled) {
          if (res.ok) {
            const data = await res.json();
            setCustomerName(data.lastName ? `${data.firstName} ${data.lastName}` : data.firstName);
            setStatus("chat");
          } else {
            setStatus("login");
          }
        }
      } catch {
        if (!cancelled) setStatus("login");
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (status === "chat") {
      fetchMessages();
    }
  }, [status, fetchMessages]);

  useEffect(() => {
    if (status !== "chat") return;
    const id = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, fetchMessages]);

  useCustomerChatNotifications(messages, status === "chat");

  useEffect(() => {
    if (editingCountRef.current > 0) return;
    if (!isAtBottomRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    isAtBottomRef.current = atBottom;
    setShowScrollDown(!atBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail.trim()) return;
    setLoginSending(true);
    setLoginMessage(null);
    try {
      const res = await fetch("/api/chat/request-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setLoginMessage(data.message ?? "Check your inbox for a sign-in link.");
      } else {
        setLoginMessage(data.error ?? "Something went wrong. Please try again.");
      }
    } catch {
      setLoginMessage("Something went wrong. Please try again.");
    } finally {
      setLoginSending(false);
    }
  };

  const handleLogout = async () => {
    await fetch("/api/chat/logout", { method: "POST", credentials: "include" });
    setStatus("login");
    setMessages([]);
    setLoginMessage(null);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/chat/upload", { method: "POST", body: formData, credentials: "include" });
      if (res.ok) {
        const att = await res.json();
        setPendingImages((prev) => [...prev, { id: att.id, url: att.url, filename: att.filename }]);
      }
    } catch {
      // ignore
    }
  };

  const handleBubbleEditingChange = useCallback((isEditing: boolean) => {
    editingCountRef.current += isEditing ? 1 : -1;
  }, []);

  const patchCustomerMessage = useCallback(async (messageId: string, body: string | null) => {
    const res = await fetch(`/api/chat/conversation/messages/${messageId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ body }),
    });
    if (res.ok) {
      const updated = await res.json();
      setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
      return true;
    }
    const err = await res.json().catch(() => ({}));
    alert(typeof err.error === "string" ? err.error : "Failed to update message");
    return false;
  }, []);

  const deleteCustomerMessage = useCallback(async (messageId: string) => {
    const res = await fetch(`/api/chat/conversation/messages/${messageId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) {
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      return true;
    }
    const err = await res.json().catch(() => ({}));
    alert(typeof err.error === "string" ? err.error : "Failed to delete message");
    return false;
  }, []);

  const removeCustomerAttachment = useCallback(
    async (messageId: string, attachmentId: string) => {
      const res = await fetch(
        `/api/chat/conversation/messages/${messageId}/attachments/${attachmentId}`,
        { method: "DELETE", credentials: "include" }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.messageDeleted) {
          setMessages((prev) => prev.filter((m) => m.id !== messageId));
        } else {
          setMessages((prev) =>
            prev.map((m) => (m.id === messageId ? data.message : m))
          );
        }
        return true;
      }
      const err = await res.json().catch(() => ({}));
      alert(typeof err.error === "string" ? err.error : "Failed to remove image");
      return false;
    },
    []
  );

  const handleSend = async () => {
    const hasText = inputText.trim().length > 0;
    const hasImages = pendingImages.length > 0;
    if (!hasText && !hasImages) return;

    stopTypingPing();
    setSending(true);
    try {
      const res = await fetch("/api/chat/conversation/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          body: inputText.trim() || null,
          attachmentIds: pendingImages.map((p) => p.id),
        }),
      });
      if (res.ok) {
        const newMsg = await res.json();
        setMessages((prev) => [...prev, newMsg]);
        setInputText("");
        setPendingImages([]);
      }
    } finally {
      setSending(false);
    }
  };

  if (status === "loading") {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  if (status === "login") {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900 mb-2">Chat with us</h1>
            <p className="text-slate-600 text-sm mb-6">
              Enter the email address we have on file and we&apos;ll send you a sign-in link. No password needed.
            </p>
            <form onSubmit={handleLogin} className="space-y-4">
              <input
                type="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
              <button
                type="submit"
                disabled={loginSending}
                className="w-full rounded-lg bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loginSending ? "Sending…" : "Send sign-in link"}
              </button>
            </form>
            {loginMessage && (
              <p className="mt-4 text-sm text-slate-600" role="alert">
                {loginMessage}
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Chat UI
  return (
    <div className="flex-1 flex flex-col min-h-0 w-full min-w-0 flex items-center justify-center px-2 sm:px-3 overflow-x-hidden">
      <div className="w-full max-w-2xl flex flex-col flex-1 min-h-0 min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50 flex-shrink-0">
          <h2 className="font-semibold text-slate-900">
            Chat with us
            {customerName && (
              <span className="font-normal text-slate-500 ml-2">· Hi {customerName}</span>
            )}
          </h2>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Sign out
          </button>
        </header>

        <div className="relative flex-1 min-h-0">
        <div ref={messagesScrollRef} onScroll={handleMessagesScroll} className="absolute inset-0 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) => (
            <ChatMessageBubble
              key={msg.id}
              msg={msg}
              isOwn={msg.sender === "CUSTOMER"}
              align={msg.sender === "CUSTOMER" ? "end" : "start"}
              bubbleClassName={
                msg.sender === "CUSTOMER"
                  ? "bg-emerald-600 text-white rounded-br-md"
                  : "bg-slate-100 text-slate-900 rounded-bl-md"
              }
              metaClassName={msg.sender === "CUSTOMER" ? "text-emerald-200" : "text-slate-500"}
              linkClassName={msg.sender === "CUSTOMER" ? "text-emerald-100" : "text-emerald-700"}
              actionMutedClassName={
                msg.sender === "CUSTOMER"
                  ? "text-emerald-200/90 hover:text-white"
                  : "text-slate-500 hover:text-slate-700"
              }
              saveEditButtonClassName={
                msg.sender === "CUSTOMER"
                  ? "text-xs font-medium text-white hover:text-emerald-100"
                  : undefined
              }
              viewed={
                msg.sender === "CUSTOMER" && staffLastReadAt != null
                  ? new Date(msg.createdAt).getTime() <= new Date(staffLastReadAt).getTime()
                  : undefined
              }
              onPatch={msg.sender === "CUSTOMER" ? patchCustomerMessage : undefined}
              onDelete={msg.sender === "CUSTOMER" ? deleteCustomerMessage : undefined}
              onRemoveAttachment={msg.sender === "CUSTOMER" ? removeCustomerAttachment : undefined}
              onEditingChange={handleBubbleEditingChange}
            />
          ))}
        </div>
          {showScrollDown && (
            <button
              type="button"
              onClick={scrollToBottom}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white shadow-md border border-slate-200 text-slate-700 hover:bg-slate-50 transition-opacity"
              aria-label="Scroll to latest message"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          )}
        </div>

        <div className="flex-shrink-0 p-4 border-t border-slate-200 bg-slate-50">
          {pendingImages.length > 0 && (
            <div className="flex gap-2 mb-2 flex-wrap">
              {pendingImages.map((p) => (
                <div key={p.id} className="relative group">
                  <Image
                    src={p.url}
                    alt={p.filename}
                    width={80}
                    height={80}
                    className="h-20 w-20 object-cover rounded-lg border border-slate-200"
                  />
                  <button
                    type="button"
                    onClick={() => setPendingImages((prev) => prev.filter((x) => x.id !== p.id))}
                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 min-w-0">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-700 flex-shrink-0"
              aria-label="Add image"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <input
              type="text"
              value={inputText}
              onChange={(e) => {
                const v = e.target.value;
                setInputText(v);
                if (v.trim().length > 0) {
                  startTypingPing();
                } else {
                  stopTypingPing();
                }
              }}
              onBlur={() => stopTypingPing()}
              onFocus={() => {
                if (inputText.trim().length > 0) startTypingPing();
              }}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
              placeholder="Type a message…"
              className="flex-1 min-w-0 px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || (!inputText.trim() && pendingImages.length === 0)}
              className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "Sending…" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
