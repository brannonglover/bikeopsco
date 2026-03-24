"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import type { Conversation, ChatMessage, Customer } from "@/lib/types";
import { useChatNotifications } from "@/hooks/useChatNotifications";
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";

const POLL_INTERVAL_MS = 3000;

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CustomerName({ conv }: { conv: Conversation }) {
  const name = conv.customer.lastName
    ? `${conv.customer.firstName} ${conv.customer.lastName}`
    : conv.customer.firstName;
  const jobLabel = conv.job
    ? ` · ${conv.job.bikeMake} ${conv.job.bikeModel}`
    : "";
  return (
    <span className="truncate">
      {name}
      {jobLabel}
    </span>
  );
}

function InviteButton({ customerId }: { customerId: string }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  const refetchSession = useCallback(() => {
    fetch(`/api/chat/session-status?customerId=${encodeURIComponent(customerId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.expiresAt) {
          const expires = new Date(data.expiresAt);
          const now = new Date();
          const ms = expires.getTime() - now.getTime();
          const days = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
          setDaysLeft(days);
        } else {
          setDaysLeft(null);
        }
      })
      .catch(() => setDaysLeft(null));
  }, [customerId]);

  useEffect(() => {
    refetchSession();
    const id = setInterval(refetchSession, 10000);
    return () => clearInterval(id);
  }, [refetchSession]);

  const handleClick = async () => {
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/api/chat/send-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage(data.message ?? "Invite sent!");
      } else {
        setMessage(data.error ?? "Failed to send");
      }
    } catch {
      setMessage("Failed to send");
    } finally {
      setSending(false);
    }
  };

  const buttonLabel =
    sending
      ? "Sending…"
      : daysLeft !== null && daysLeft > 0
        ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
        : "Invite to chat";

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {message && <span className="text-xs text-slate-500">{message}</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={sending}
        className="px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function LastMessagePreview({ conv }: { conv: Conversation }) {
  const last = conv.messages?.[0];
  if (!last) return <span className="text-slate-400 text-sm">No messages yet</span>;
  const text = last.body?.trim();
  const hasAttachment = last.attachments?.length ? last.attachments.length > 0 : false;
  const preview = text || (hasAttachment ? "📎 Image" : "");
  return (
    <span className="text-slate-500 text-sm truncate block">
      {preview || "—"}
    </span>
  );
}

export default function ChatPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [inputText, setInputText] = useState("");
  const [pendingImages, setPendingImages] = useState<{ id: string; url: string; filename: string }[]>([]);
  const [showNewConvModal, setShowNewConvModal] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) {
      const data = await res.json();
      setConversations(data);
    }
  }, []);

  const fetchMessages = useCallback(async (convId: string) => {
    const res = await fetch(`/api/conversations/${convId}/messages`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchConversations().finally(() => setLoading(false));
  }, [fetchConversations]);

  useEffect(() => {
    if (selectedId) {
      fetchMessages(selectedId);
    } else {
      setMessages([]);
    }
  }, [selectedId, fetchMessages]);

  useEffect(() => {
    if (!selectedId) return;
    const id = setInterval(() => fetchMessages(selectedId), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [selectedId, fetchMessages]);

  useChatNotifications(conversations, fetchConversations, selectedId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedConv = conversations.find((c) => c.id === selectedId);

  const openNewConvModal = () => {
    setShowNewConvModal(true);
    setCustomerSearch("");
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => setCustomers(Array.isArray(data) ? data : []))
      .catch(() => setCustomers([]));
  };

  const handleSelectCustomer = async (customerId: string) => {
    const existing = conversations.find((c) => c.customerId === customerId && !c.jobId);
    if (existing) {
      setSelectedId(existing.id);
      setShowNewConvModal(false);
      return;
    }
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      if (res.ok) {
        const newConv = await res.json();
        setConversations((prev) => [newConv, ...prev]);
        setSelectedId(newConv.id);
        setShowNewConvModal(false);
      } else {
        const err = await res.json();
        alert(err.error ?? "Failed to create conversation");
      }
    } catch {
      alert("Failed to create conversation");
    }
  };

  const filteredCustomers = customers.filter((c) => {
    const q = customerSearch.toLowerCase();
    const name = `${c.firstName} ${c.lastName || ""}`.toLowerCase();
    const email = (c.email || "").toLowerCase();
    const phone = (c.phone || "").toLowerCase();
    return name.includes(q) || email.includes(q) || phone.includes(q);
  });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/chat/upload", { method: "POST", body: formData });
      if (res.ok) {
        const att = await res.json();
        setPendingImages((prev) => [...prev, { id: att.id, url: att.url, filename: att.filename }]);
      } else {
        const data = await res.json();
        alert(data.error ?? "Failed to upload");
      }
    } catch {
      alert("Failed to upload image");
    }
    e.target.value = "";
  };

  const removePendingImage = (id: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== id));
  };

  const patchStaffMessage = useCallback(
    async (messageId: string, body: string | null) => {
      if (!selectedId) return false;
      const res = await fetch(`/api/conversations/${selectedId}/messages/${messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (res.ok) {
        const updated = await res.json();
        setMessages((prev) => prev.map((m) => (m.id === messageId ? updated : m)));
        fetchConversations();
        return true;
      }
      const err = await res.json().catch(() => ({}));
      alert(typeof err.error === "string" ? err.error : "Failed to update message");
      return false;
    },
    [selectedId, fetchConversations]
  );

  const deleteStaffMessage = useCallback(
    async (messageId: string) => {
      if (!selectedId) return false;
      const res = await fetch(`/api/conversations/${selectedId}/messages/${messageId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        fetchConversations();
        return true;
      }
      const err = await res.json().catch(() => ({}));
      alert(typeof err.error === "string" ? err.error : "Failed to delete message");
      return false;
    },
    [selectedId, fetchConversations]
  );

  const handleSend = async () => {
    if (!selectedId) return;
    const hasText = inputText.trim().length > 0;
    const hasImages = pendingImages.length > 0;
    if (!hasText && !hasImages) return;

    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "STAFF",
          body: inputText.trim() || null,
          attachmentIds: pendingImages.map((p) => p.id),
        }),
      });
      if (res.ok) {
        const newMsg = await res.json();
        setMessages((prev) => [...prev, newMsg]);
        setInputText("");
        setPendingImages([]);
        fetchConversations();
      } else {
        const data = await res.json();
        alert(data.error ?? "Failed to send");
      }
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-5rem)] -mx-4 -mb-6 sm:-mx-6 sm:-mb-6 md:mx-0 md:mb-0 md:rounded-xl md:border md:border-slate-200 md:shadow-soft bg-white overflow-hidden">
      <div className="flex flex-1 min-h-0">
        {/* Conversation list */}
        <aside
          className={`flex flex-col w-full md:w-72 lg:w-80 border-r border-slate-200 flex-shrink-0 bg-slate-50 ${
            selectedId ? "hidden md:flex" : "flex"
          }`}
        >
          <div className="p-3 border-b border-slate-200 flex-shrink-0">
            <h2 className="text-lg font-semibold text-slate-900">Chat</h2>
            <button
              type="button"
              onClick={openNewConvModal}
              className="mt-2 w-full px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            >
              + New conversation
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="p-4 text-slate-500 text-sm">No conversations yet. Start one above.</p>
            ) : (
              <ul className="divide-y divide-slate-200">
                {conversations.map((conv) => (
                  <li key={conv.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(conv.id)}
                      className={`w-full text-left p-3 hover:bg-slate-100 transition-colors ${
                        selectedId === conv.id ? "bg-slate-200" : ""
                      }`}
                    >
                      <CustomerName conv={conv} />
                      <LastMessagePreview conv={conv} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Message thread */}
        <section
          className={`flex flex-col flex-1 min-w-0 bg-white ${
            selectedId ? "flex" : "hidden md:flex"
          }`}
        >
          {selectedId && selectedConv ? (
            <>
              <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 flex-shrink-0 bg-white">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="md:hidden p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100"
                  aria-label="Back to conversations"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900 truncate">
                    <CustomerName conv={selectedConv} />
                  </h3>
                  {selectedConv.customer.email && (
                    <p className="text-xs text-slate-500 truncate">{selectedConv.customer.email}</p>
                  )}
                </div>
                {selectedConv.customer.email && (
                  <InviteButton customerId={selectedConv.customerId} />
                )}
              </header>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((msg) => (
                  <ChatMessageBubble
                    key={msg.id}
                    msg={msg}
                    isOwn={msg.sender === "STAFF"}
                    align={msg.sender === "STAFF" ? "end" : "start"}
                    bubbleClassName={
                      msg.sender === "STAFF"
                        ? "bg-emerald-600 text-white rounded-br-md"
                        : "bg-slate-100 text-slate-900 rounded-bl-md"
                    }
                    metaClassName={msg.sender === "STAFF" ? "text-emerald-200" : "text-slate-500"}
                    linkClassName={msg.sender === "STAFF" ? "text-emerald-100" : "text-emerald-700"}
                    actionMutedClassName={
                      msg.sender === "STAFF"
                        ? "text-emerald-200/90 hover:text-white"
                        : "text-slate-500 hover:text-slate-700"
                    }
                    saveEditButtonClassName={
                      msg.sender === "STAFF"
                        ? "text-xs font-medium text-white hover:text-emerald-100"
                        : undefined
                    }
                    formatTime={formatTime}
                    onPatch={msg.sender === "STAFF" ? patchStaffMessage : undefined}
                    onDelete={msg.sender === "STAFF" ? deleteStaffMessage : undefined}
                  />
                ))}
                <div ref={messagesEndRef} />
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
                          onClick={() => removePendingImage(p.id)}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-xs flex items-center justify-center hover:bg-red-600"
                          aria-label="Remove"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
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
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors flex-shrink-0"
                    aria-label="Add image"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>
                  <input
                    type="text"
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
                    placeholder="Type a message…"
                    className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || (!inputText.trim() && pendingImages.length === 0)}
                    className="px-4 py-2.5 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <p>Select a conversation or start a new one</p>
            </div>
          )}
        </section>
      </div>

      {/* New conversation modal */}
      {showNewConvModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50"
          onClick={() => setShowNewConvModal(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Start conversation</h3>
              <p className="text-sm text-slate-500 mt-1">Select a customer</p>
              <input
                type="text"
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search by name, email, or phone…"
                className="mt-3 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto max-h-64">
              {filteredCustomers.length === 0 ? (
                <p className="p-4 text-slate-500 text-sm">No customers found</p>
              ) : (
                <ul className="divide-y divide-slate-200">
                  {filteredCustomers.map((c) => {
                    const name = c.lastName ? `${c.firstName} ${c.lastName}` : c.firstName;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => handleSelectCustomer(c.id)}
                          className="w-full text-left p-3 hover:bg-slate-50 transition-colors"
                        >
                          <span className="font-medium text-slate-900">{name}</span>
                          {c.email && (
                            <p className="text-xs text-slate-500 truncate">{c.email}</p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="p-4 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setShowNewConvModal(false)}
                className="w-full px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
