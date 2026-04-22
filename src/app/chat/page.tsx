"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback, useLayoutEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { Conversation, ChatMessage, Customer } from "@/lib/types";
import { useChatNotifications } from "@/hooks/useChatNotifications";
import { ChatMessageBubble } from "@/components/chat/ChatMessageBubble";
import { ConversationListRow } from "@/components/chat/ConversationListRow";
import { isCustomerTypingRecently } from "@/lib/chat-typing";

const POLL_INTERVAL_MS = 3000;

// Vercel's serverless body limit is ~4.5 MB. Compress phone photos client-side
// so they always come in under the wire, and convert HEIC → JPEG along the way.
const UPLOAD_MAX_MB = 4;

async function compressImage(file: File): Promise<File> {
  const maxBytes = UPLOAD_MAX_MB * 1024 * 1024;
  const isHeic = /^image\/(heic|heif)$/i.test(file.type);

  // HEIC cannot be decoded by non-Safari browsers natively; use heic2any first.
  // Also detect by extension because iOS sometimes sets an empty MIME type.
  const isHeicByExt = /\.(heic|heif)$/i.test(file.name);
  let sourceFile = file;
  if (isHeic || isHeicByExt) {
    // heic2any is a UMD module — the function is the export, not under .default
    const mod = await import("heic2any");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const heic2any = (mod as any).default ?? mod;
    const converted = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    const blob = Array.isArray(converted) ? converted[0] : converted;
    const safeName = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    sourceFile = new File([blob], safeName, { type: "image/jpeg" });
  }

  if (sourceFile.size <= maxBytes) return sourceFile;

  return new Promise((resolve) => {
    const img = new window.Image();
    const objectUrl = URL.createObjectURL(sourceFile);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      const MAX_DIM = 2048;
      let { width, height } = img;
      if (width > MAX_DIM || height > MAX_DIM) {
        const ratio = Math.min(MAX_DIM / width, MAX_DIM / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(sourceFile); return; }
      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.85;
      const tryExport = () => {
        canvas.toBlob((blob) => {
          if (!blob) { resolve(sourceFile); return; }
          if (blob.size <= maxBytes || quality <= 0.3) {
            resolve(new File([blob], sourceFile.name, { type: "image/jpeg" }));
          } else {
            quality = Math.round((quality - 0.1) * 10) / 10;
            tryExport();
          }
        }, "image/jpeg", quality);
      };
      tryExport();
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Can't decode in canvas — resolve with the source file and let the
      // server validate; the upload may still succeed if it's within limits.
      console.warn("compressImage: canvas decode failed, uploading original");
      resolve(sourceFile);
    };

    img.src = objectUrl;
  });
}

const CHAT_DRAFT_STORAGE_PREFIX = "bikeops:chat-draft:";

type ChatComposerDraft = {
  text: string;
  pendingImages: { id: string; url: string; filename: string }[];
};

function chatDraftKey(convId: string) {
  return `${CHAT_DRAFT_STORAGE_PREFIX}${convId}`;
}

function loadChatDraft(convId: string): ChatComposerDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(chatDraftKey(convId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { text?: unknown }).text !== "string" ||
      !Array.isArray((parsed as { pendingImages?: unknown }).pendingImages)
    ) {
      return null;
    }
    const pendingImages = (parsed as ChatComposerDraft).pendingImages.filter(
      (p): p is ChatComposerDraft["pendingImages"][number] =>
        typeof p === "object" &&
        p !== null &&
        typeof (p as { id?: unknown }).id === "string" &&
        typeof (p as { url?: unknown }).url === "string" &&
        typeof (p as { filename?: unknown }).filename === "string"
    );
    return { text: (parsed as ChatComposerDraft).text, pendingImages };
  } catch {
    return null;
  }
}

function saveChatDraft(convId: string, draft: ChatComposerDraft) {
  if (typeof window === "undefined") return;
  const empty = !draft.text.trim() && draft.pendingImages.length === 0;
  if (empty) {
    sessionStorage.removeItem(chatDraftKey(convId));
  } else {
    sessionStorage.setItem(chatDraftKey(convId), JSON.stringify(draft));
  }
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

type InviteStatus = "idle" | "pending" | "active";

function InviteButton({ customerId }: { customerId: string }) {
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);
  const [status, setStatus] = useState<InviteStatus>("idle");

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
          setStatus("active");
        } else if (data.pendingInvite) {
          setDaysLeft(null);
          setStatus("pending");
        } else {
          setDaysLeft(null);
          setStatus("idle");
        }
      })
      .catch(() => {
        setDaysLeft(null);
        setStatus("idle");
      });
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
        refetchSession();
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
      : status === "active" && daysLeft !== null && daysLeft > 0
        ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
        : status === "pending"
          ? "Invited — awaiting reply"
          : "Invite to chat";

  const buttonStyle =
    status === "pending"
      ? "px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 disabled:opacity-50"
      : status === "active"
        ? "px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
        : "px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 rounded-lg hover:bg-emerald-100 disabled:opacity-50";

  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      {message && <span className="text-xs text-slate-500">{message}</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={sending}
        className={buttonStyle}
      >
        {buttonLabel}
      </button>
    </div>
  );
}

function ChatPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const customerIdFromUrl = searchParams.get("customer");
  const deepLinkCustomerRef = useRef<string | null>(null);

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
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const hasPendingOptimisticRef = useRef(false);
  const deliveryTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    hasPendingOptimisticRef.current = messages.some((m) => m.id.startsWith("temp-"));
  }, [messages]);

  useEffect(() => {
    return () => {
      for (const t of Object.values(deliveryTimeoutsRef.current)) clearTimeout(t);
      deliveryTimeoutsRef.current = {};
    };
  }, []);

  const clearClientDeliveryStateLater = useCallback((messageId: string, delayMs = 2000) => {
    const existing = deliveryTimeoutsRef.current[messageId];
    if (existing) clearTimeout(existing);
    deliveryTimeoutsRef.current[messageId] = setTimeout(() => {
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, clientDeliveryState: undefined } : m))
      );
      delete deliveryTimeoutsRef.current[messageId];
    }, delayMs);
  }, []);

  const mergeServerMessages = useCallback((serverMessages: ChatMessage[]) => {
    setMessages((prev) => {
      const optimistic = prev.filter((m) => m.id.startsWith("temp-"));
      const prevById = new Map(prev.map((m) => [m.id, m] as const));
      const byId = new Map<string, ChatMessage>();
      for (const msg of serverMessages) {
        const prevMsg = prevById.get(msg.id);
        if (prevMsg?.clientDeliveryState) {
          byId.set(msg.id, { ...msg, clientDeliveryState: prevMsg.clientDeliveryState });
        } else {
          byId.set(msg.id, msg);
        }
      }
      for (const msg of optimistic) byId.set(msg.id, msg);
      return [...byId.values()].sort((a, b) => {
        const ta = new Date(a.createdAt).getTime();
        const tb = new Date(b.createdAt).getTime();
        if (ta !== tb) return ta - tb;
        return a.id.localeCompare(b.id);
      });
    });
  }, []);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const editingCountRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const isAtBottomRef = useRef(true);
  const [contextMenu, setContextMenu] = useState<{
    convId: string;
    x: number;
    y: number;
  } | null>(null);
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const [customerTypingAt, setCustomerTypingAt] = useState<string | null>(null);
  const [customerLastReadAt, setCustomerLastReadAt] = useState<string | null>(null);
  const [, setTypingTick] = useState(0);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const selectedIdRef = useRef<string | null>(null);
  const [customerActiveJobId, setCustomerActiveJobId] = useState<string | null>(null);

  useLayoutEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const prevSelectedIdForDraftRef = useRef<string | null>(null);
  const composerDraftRef = useRef<ChatComposerDraft>({ text: "", pendingImages: [] });
  composerDraftRef.current = { text: inputText, pendingImages };

  useEffect(() => {
    const prev = prevSelectedIdForDraftRef.current;
    if (selectedId === prev) return;

    if (prev != null) {
      saveChatDraft(prev, { text: inputText, pendingImages });
    }
    if (selectedId) {
      const d = loadChatDraft(selectedId);
      setInputText(d?.text ?? "");
      setPendingImages(d?.pendingImages ?? []);
    } else {
      setInputText("");
      setPendingImages([]);
    }
    prevSelectedIdForDraftRef.current = selectedId;
    // Intentionally only when `selectedId` changes — text/images here are the draft for the thread being left.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    return () => {
      const id = selectedIdRef.current;
      if (id) {
        saveChatDraft(id, composerDraftRef.current);
      }
    };
  }, []);

  const fetchConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) {
      const data = await res.json();
      setConversations(data);
    }
  }, []);

  const fetchMessages = useCallback(async (convId: string, options?: { signal?: AbortSignal }) => {
    let res: Response;
    try {
      res = await fetch(`/api/conversations/${convId}/messages`, {
        signal: options?.signal,
      });
    } catch (e: unknown) {
      if (e && typeof e === "object" && "name" in e && (e as { name: string }).name === "AbortError") {
        return;
      }
      throw e;
    }
    if (!res.ok) return;
    const data = await res.json();
    if (selectedIdRef.current !== convId) return;
    if (Array.isArray(data)) {
      mergeServerMessages(data);
      setCustomerTypingAt(null);
    } else {
      mergeServerMessages(data.messages ?? []);
      setCustomerTypingAt(data.customerTypingAt ?? null);
      setCustomerLastReadAt(data.customerLastReadAt ?? null);
      if (typeof data.staffLastReadAt === "string") {
        setConversations((prev) => {
          if (prev.length === 0) return prev;
          const idx = prev.findIndex((c) => c.id === convId);
          if (idx === -1) return prev;
          const next = [...prev];
          next[idx] = { ...next[idx], staffLastReadAt: data.staffLastReadAt };
          return next;
        });
      }
    }
  }, [mergeServerMessages]);

  useEffect(() => {
    setLoading(true);
    fetchConversations().finally(() => setLoading(false));
  }, [fetchConversations]);

  useEffect(() => {
    deepLinkCustomerRef.current = null;
  }, [customerIdFromUrl]);

  useEffect(() => {
    if (loading || !customerIdFromUrl) return;

    const existing = conversations.find(
      (c) => c.customerId === customerIdFromUrl && !c.jobId
    );
    if (existing) {
      setSelectedId(existing.id);
      deepLinkCustomerRef.current = customerIdFromUrl;
      router.replace("/chat", { scroll: false });
      return;
    }

    if (deepLinkCustomerRef.current === customerIdFromUrl) return;

    deepLinkCustomerRef.current = customerIdFromUrl;
    let cancelled = false;
    fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customerIdFromUrl }),
    })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          const newConv = (await res.json()) as Conversation;
          setConversations((prev) => [newConv, ...prev]);
          setSelectedId(newConv.id);
          router.replace("/chat", { scroll: false });
        } else {
          deepLinkCustomerRef.current = null;
        }
      })
      .catch(() => {
        deepLinkCustomerRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [loading, customerIdFromUrl, conversations, router]);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      setCustomerTypingAt(null);
      setCustomerLastReadAt(null);
      setMessagesLoading(false);
      return;
    }
    const ac = new AbortController();
    setMessagesLoading(true);
    setMessages([]);
    setCustomerTypingAt(null);
    setCustomerLastReadAt(null);
    fetchMessages(selectedId, { signal: ac.signal }).finally(() => {
      setMessagesLoading(false);
    });
    return () => ac.abort();
  }, [selectedId, fetchMessages]);

  useEffect(() => {
    if (!selectedId) return;
    const id = setInterval(() => {
      if (sendingRef.current) return;
      if (hasPendingOptimisticRef.current) return;
      void fetchMessages(selectedId);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [selectedId, fetchMessages]);

  useChatNotifications(conversations, fetchConversations, selectedId);

  useEffect(() => {
    const customerId = conversations.find((c) => c.id === selectedId)?.customerId;
    if (!customerId) {
      setCustomerActiveJobId(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/jobs?customerId=${encodeURIComponent(customerId)}&summary=1`)
      .then((r) => r.json())
      .then((data: unknown) => {
        if (cancelled) return;
        const jobs = Array.isArray(data) ? (data as { id: string; stage: string }[]) : [];
        const active = jobs.find(
          (j) => j.stage !== "CANCELLED" && j.stage !== "COMPLETED"
        );
        setCustomerActiveJobId(active?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setCustomerActiveJobId(null);
      });
    return () => {
      cancelled = true;
    };
    // Only re-fetch when the selected conversation changes, not on every conversations poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (!contextMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [contextMenu]);

  const archiveConversation = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/conversations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: true }),
        });
        if (res.ok) {
          setConversations((prev) => prev.filter((c) => c.id !== id));
          setSelectedId((cur) => (cur === id ? null : cur));
          setSwipeOpenId(null);
        } else {
          const err = await res.json().catch(() => ({}));
          alert(typeof err.error === "string" ? err.error : "Failed to archive");
        }
      } catch {
        alert("Failed to archive");
      }
    },
    []
  );

  const selectedConv = conversations.find((c) => c.id === selectedId);
  const typingSignal =
    customerTypingAt ?? selectedConv?.customerTypingAt ?? null;
  const showCustomerTyping =
    Boolean(selectedId) && isCustomerTypingRecently(typingSignal);

  useEffect(() => {
    if (!typingSignal) return;
    const id = setInterval(() => setTypingTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [typingSignal]);

  useEffect(() => {
    if (editingCountRef.current > 0) return;
    if (!isAtBottomRef.current) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, showCustomerTyping]);

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

  const openNewConvModal = () => {
    setShowNewConvModal(true);
    setCustomerSearch("");
    fetch("/api/customers")
      .then((r) => r.json())
      .then((data) => setCustomers(Array.isArray(data) ? data : []))
      .catch(() => setCustomers([]));
  };

  const handleSelectCustomer = useCallback(
    async (customerId: string) => {
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
    },
    [conversations]
  );

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
    e.target.value = "";

    const isHeicFile = /^image\/(heic|heif)$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
    let uploadFile: File;
    try {
      uploadFile = await compressImage(file);
    } catch (err) {
      console.error("compressImage failed:", err);
      if (isHeicFile) {
        alert("Failed to process image. Please convert it to JPEG first and try again.");
        return;
      }
      // For non-HEIC files, fall back to uploading the original
      uploadFile = file;
    }

    const formData = new FormData();
    formData.append("file", uploadFile);
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
  };

  const removePendingImage = (id: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== id));
  };

  const handleBubbleEditingChange = useCallback((isEditing: boolean) => {
    editingCountRef.current += isEditing ? 1 : -1;
  }, []);

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

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!selectedId) return;
      const msg = messages.find((m) => m.id === messageId);
      const myReaction = (msg?.reactions ?? []).find(
        (r) => r.reactorType === "STAFF"
      );
      try {
        // Optimistically update so the UI doesn't wait on network/DB latency.
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== messageId) return m;
            const existing = (m.reactions ?? []).find((r) => r.reactorType === "STAFF") ?? null;
            const withoutMine = (m.reactions ?? []).filter((r) => r.reactorType !== "STAFF");
            if (existing?.emoji === emoji) {
              return { ...m, reactions: withoutMine };
            }
            const optimistic = {
              id: existing?.id ?? `temp-reaction-${messageId}-staff`,
              messageId,
              emoji,
              reactorType: "STAFF" as const,
              createdAt: existing?.createdAt ?? new Date().toISOString(),
            };
            return { ...m, reactions: [...withoutMine, optimistic] };
          })
        );

        if (myReaction?.emoji === emoji) {
          const res = await fetch(
            `/api/conversations/${selectedId}/messages/${messageId}/reactions`,
            { method: "DELETE" }
          );
          if (!res.ok) {
            fetchMessages(selectedId);
          }
        } else {
          const res = await fetch(
            `/api/conversations/${selectedId}/messages/${messageId}/reactions`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ emoji }),
            }
          );
          if (res.ok) {
            const reaction = await res.json().catch(() => null);
            if (reaction && typeof reaction === "object") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== messageId) return m;
                  const withoutMine = (m.reactions ?? []).filter((r) => r.reactorType !== "STAFF");
                  return { ...m, reactions: [...withoutMine, reaction] };
                })
              );
            }
          } else {
            fetchMessages(selectedId);
          }
        }
      } catch {
        fetchMessages(selectedId);
      }
    },
    [selectedId, messages, fetchMessages]
  );

  const removeStaffAttachment = useCallback(
    async (messageId: string, attachmentId: string) => {
      if (!selectedId) return false;
      const res = await fetch(
        `/api/conversations/${selectedId}/messages/${messageId}/attachments/${attachmentId}`,
        { method: "DELETE" }
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
        fetchConversations();
        return true;
      }
      const err = await res.json().catch(() => ({}));
      alert(typeof err.error === "string" ? err.error : "Failed to remove image");
      return false;
    },
    [selectedId, fetchConversations]
  );

  const handleSend = async () => {
    if (!selectedId) return;
    const textToSend = inputText.trim();
    const imagesToSend = [...pendingImages];
    const hasText = textToSend.length > 0;
    const hasImages = imagesToSend.length > 0;
    if (!hasText && !hasImages) return;

    // Optimistically append the message immediately so the UI feels instant
    const tempId = `temp-${Date.now()}`;
    const optimisticMsg: ChatMessage = {
      id: tempId,
      conversationId: selectedId,
      sender: "STAFF",
      body: textToSend || null,
      clientDeliveryState: "SENDING",
      attachments: imagesToSend.map((img) => ({
        id: img.id,
        url: img.url,
        filename: img.filename,
        mimeType: "",
        createdAt: new Date().toISOString(),
      })),
      reactions: [],
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMsg]);
    saveChatDraft(selectedId, { text: "", pendingImages: [] });
    setInputText("");
    setPendingImages([]);
    if (composerTextareaRef.current) {
      composerTextareaRef.current.style.height = "auto";
    }
    setSending(true);

    try {
      const res = await fetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "STAFF",
          body: textToSend || null,
          attachmentIds: imagesToSend.map((p) => p.id),
        }),
      });
      if (res.ok) {
        const newMsg = (await res.json()) as ChatMessage;
        const deliveredMsg: ChatMessage = { ...newMsg, clientDeliveryState: "DELIVERED" };
        // Replace the optimistic placeholder with the confirmed server message
        setMessages((prev) => {
          const replaced = prev.map((m) => (m.id === tempId ? deliveredMsg : m));
          const byId = new Map<string, ChatMessage>();
          for (const msg of replaced) byId.set(msg.id, msg);
          return [...byId.values()].sort((a, b) => {
            const ta = new Date(a.createdAt).getTime();
            const tb = new Date(b.createdAt).getTime();
            if (ta !== tb) return ta - tb;
            return a.id.localeCompare(b.id);
          });
        });
        clearClientDeliveryStateLater(deliveredMsg.id);
        fetchConversations();
      } else {
        const data = await res.json();
        // Roll back the optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
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
    <div className="flex flex-col h-[calc(100vh-8rem)] min-h-0 md:h-[calc(100vh-5rem)] -mx-4 -mb-6 sm:-mx-6 sm:-mb-6 md:mx-0 md:mb-0 md:rounded-xl md:border md:border-slate-200 md:shadow-soft bg-white overflow-hidden">
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
                  <ConversationListRow
                    key={conv.id}
                    conv={conv}
                    selected={selectedId === conv.id}
                    onSelect={() => {
                      setSwipeOpenId(null);
                      setSelectedId(conv.id);
                    }}
                    onArchive={() => archiveConversation(conv.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setSwipeOpenId(null);
                      setContextMenu({ convId: conv.id, x: e.clientX, y: e.clientY });
                    }}
                    swipeOpenId={swipeOpenId}
                    onSwipeOpenChange={setSwipeOpenId}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Message thread */}
        <section
          className={`flex flex-col flex-1 min-h-0 min-w-0 bg-white ${
            selectedId ? "flex" : "hidden md:flex"
          }`}
        >
          {selectedId ? (
            <>
              {/* Header sits outside the scroll view so iOS rubber-band overscroll doesn’t stretch it */}
              <header className="flex shrink-0 items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white">
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
                  <h3 className="font-semibold text-slate-900">
                    {selectedConv ? (
                      <Link
                        href={`/settings/customers?edit=${encodeURIComponent(selectedConv.customerId)}`}
                        className="block truncate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-inset rounded"
                        title="View customer profile"
                      >
                        <CustomerName conv={selectedConv} />
                      </Link>
                    ) : (
                      "Loading…"
                    )}
                  </h3>
                  {selectedConv?.customer.email && (
                    <p className="text-xs text-slate-500 truncate">{selectedConv.customer.email}</p>
                  )}
                </div>
                {customerActiveJobId && (
                  <a
                    href={`/?openJob=${encodeURIComponent(customerActiveJobId)}`}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                    title="Go to job card on the board"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} aria-hidden>
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                    </svg>
                    Job card
                  </a>
                )}
                {selectedConv?.customer.email && (
                  <InviteButton customerId={selectedConv.customerId} />
                )}
              </header>

              {/* Clip scroll overscroll so elastic bounce doesn’t distort the composer below */}
              <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                <div
                  ref={messagesScrollRef}
                  onScroll={handleMessagesScroll}
                  className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain touch-pan-y"
                >
                  <div className="p-4 space-y-3">
                    {messagesLoading && messages.length === 0 ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500" aria-live="polite">
                        <span
                          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-emerald-600"
                          aria-hidden
                        />
                        Loading messages…
                      </div>
                    ) : null}
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
                        viewed={
                          msg.sender === "STAFF" && customerLastReadAt != null
                            ? new Date(msg.createdAt).getTime() <= new Date(customerLastReadAt).getTime()
                            : undefined
                        }
                        role="STAFF"
                        onPatch={msg.sender === "STAFF" ? patchStaffMessage : undefined}
                        onDelete={msg.sender === "STAFF" ? deleteStaffMessage : undefined}
                        onRemoveAttachment={msg.sender === "STAFF" ? removeStaffAttachment : undefined}
                        onEditingChange={handleBubbleEditingChange}
                        onToggleReaction={toggleReaction}
                      />
                    ))}
                    {showCustomerTyping && (
                      <p className="text-sm text-slate-500 italic" aria-live="polite">
                        Customer is typing…
                      </p>
                    )}
                  </div>
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

              <footer className="shrink-0 border-t border-slate-200 bg-slate-50 p-4 isolate">
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
                    accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition-colors flex-shrink-0"
                    aria-label="Add image"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}>
                      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </button>
                  <textarea
                    ref={composerTextareaRef}
                    value={inputText}
                    rows={1}
                    onChange={(e) => setInputText(e.target.value)}
                    onInput={(e) => {
                      const el = e.currentTarget;
                      el.style.height = "auto";
                      el.style.height = `${el.scrollHeight}px`;
                    }}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), handleSend())}
                    placeholder="Type a message…"
                    className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent resize-none overflow-hidden leading-normal"
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
              </footer>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <p>Select a conversation or start a new one</p>
            </div>
          )}
        </section>
      </div>

      {contextMenu && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[60] cursor-default bg-transparent border-0 p-0"
            aria-label="Close menu"
            onClick={() => setContextMenu(null)}
          />
          <div
            role="menu"
            className="fixed z-[70] min-w-[160px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={{
              left: Math.max(
                8,
                Math.min(contextMenu.x, (typeof window !== "undefined" ? window.innerWidth : 400) - 172)
              ),
              top: Math.max(
                8,
                Math.min(contextMenu.y, (typeof window !== "undefined" ? window.innerHeight : 400) - 48)
              ),
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="w-full px-4 py-2.5 text-left text-sm text-slate-800 hover:bg-slate-100"
              onClick={() => {
                archiveConversation(contextMenu.convId);
                setContextMenu(null);
              }}
            >
              Archive
            </button>
          </div>
        </>
      )}

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

export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] flex-col items-center justify-center bg-slate-50 text-slate-500">
          Loading…
        </div>
      }
    >
      <ChatPageContent />
    </Suspense>
  );
}
