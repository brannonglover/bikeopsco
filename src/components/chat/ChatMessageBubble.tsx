"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import type { ChatMessage, MessageSender } from "@/lib/types";
import { formatChatTime } from "@/lib/format-chat-time";
import { LinkifiedMessageBody } from "./LinkifiedMessageBody";
import { LinkPreview } from "./LinkPreview";

const URL_REGEX = /(https?:\/\/[^\s<]+)/g;

function extractUrls(text: string): string[] {
  return Array.from(new Set(text.match(URL_REGEX) ?? []));
}

export const REACTION_EMOJIS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F64F}"];

type ChatMessageBubbleProps = {
  msg: ChatMessage;
  /** Current user may edit/delete this message */
  isOwn: boolean;
  align: "end" | "start";
  bubbleClassName: string;
  metaClassName: string;
  linkClassName: string;
  actionMutedClassName: string;
  /** Save button in edit mode (use light text on dark/green bubbles) */
  saveEditButtonClassName?: string;
  /** Whether the other party has viewed this message */
  viewed?: boolean;
  /** Which side is the current user (used for reaction ownership) */
  role?: MessageSender;
  onPatch?: (messageId: string, body: string | null) => Promise<boolean>;
  onDelete?: (messageId: string) => Promise<boolean>;
  onRemoveAttachment?: (messageId: string, attachmentId: string) => Promise<boolean>;
  onEditingChange?: (editing: boolean) => void;
  onToggleReaction?: (messageId: string, emoji: string) => void;
};

export function ChatMessageBubble({
  msg,
  isOwn,
  align,
  bubbleClassName,
  metaClassName,
  linkClassName,
  actionMutedClassName,
  saveEditButtonClassName,
  viewed,
  role,
  onPatch,
  onDelete,
  onRemoveAttachment,
  onEditingChange,
  onToggleReaction,
}: ChatMessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body ?? "");
  const [busy, setBusy] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, []);

  useEffect(() => {
    if (!editing) {
      setDraft(msg.body ?? "");
    }
  }, [msg.body, msg.id, editing]);

  useEffect(() => {
    if (editing) {
      autoResize();
      textareaRef.current?.focus();
    }
  }, [editing, autoResize]);

  useEffect(() => {
    if (!editing) return;
    onEditingChange?.(true);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);

  const handleSave = async () => {
    if (!onPatch) return;
    const trimmed = draft.trim() || null;
    const hasAttachments = (msg.attachments?.length ?? 0) > 0;
    if (!trimmed && !hasAttachments) {
      alert("Message cannot be empty.");
      return;
    }
    setBusy(true);
    try {
      const ok = await onPatch(msg.id, trimmed);
      if (ok) setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirm("Delete this message? It will be removed for everyone in the chat.")) return;
    setBusy(true);
    try {
      await onDelete(msg.id);
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveAttachment = async (attachmentId: string) => {
    if (!onRemoveAttachment) return;
    if (!confirm("Remove this image from the message?")) return;
    setBusy(true);
    try {
      await onRemoveAttachment(msg.id, attachmentId);
    } finally {
      setBusy(false);
    }
  };

  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showEmojiPicker]);

  const showActions = isOwn && (onPatch || onDelete) && !editing;
  const canEdit = Boolean(onPatch);
  const attachments = msg.attachments ?? [];
  const hasAttachments = attachments.length > 0;
  /** Image(s) above, caption or editor in the colored bubble below */
  const splitImageAndTextBubble = hasAttachments && (!!msg.body || editing);

  const attachmentImageBlocks = attachments.map((att) => (
    <div key={att.id} className="relative group/att">
      <button
        type="button"
        onClick={() => setLightboxUrl(att.url)}
        className="block w-full cursor-zoom-in"
      >
        <Image
          src={att.url}
          alt={att.filename}
          width={1600}
          height={1200}
          sizes="(max-width: 768px) 85vw, 42vw"
          style={{ width: "100%", height: "auto" }}
          className={`max-h-[min(70vh,560px)] object-contain ${align === "end" ? "object-right" : "object-left"}`}
        />
      </button>
      {isOwn && onRemoveAttachment && !editing && (
        <button
          type="button"
          onClick={() => handleRemoveAttachment(att.id)}
          className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-sm text-white opacity-70 transition-opacity hover:bg-red-600 md:opacity-0 md:group-hover/att:opacity-100"
          aria-label="Remove image"
          disabled={busy}
        >
          ×
        </button>
      )}
    </div>
  ));

  const reactions = msg.reactions ?? [];
  const aggregated = reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});
  const myReaction = role
    ? reactions.find((r) => r.reactorType === role)
    : undefined;
  const hasReactions = Object.keys(aggregated).length > 0;

  return (
    <>
    <div
      className={`flex w-full min-w-0 flex-col ${align === "end" ? "items-end" : "items-start"}`}
    >
      <div
        className={`relative group/msg flex min-w-0 flex-col ${
          editing ? "w-full" : "w-full max-w-[85%] md:max-w-[70%]"
        } ${hasReactions && !editing ? "mb-4" : ""}`}
      >
        {hasAttachments ? (
          splitImageAndTextBubble ? (
            <div className="mb-1.5 w-full overflow-hidden rounded-2xl">
              <div className="space-y-0.5">{attachmentImageBlocks}</div>
            </div>
          ) : (
            <div className="w-full overflow-hidden rounded-2xl">
              <div className="space-y-0.5">{attachmentImageBlocks}</div>
              {!editing ? (
              <div
                className={`flex min-h-[1.25rem] items-center gap-2 px-3 pb-1.5 pt-1 text-xs text-slate-500 ${
                  align === "end" ? "justify-end" : "justify-start"
                }`}
              >
                <span className="min-w-0">
                  {formatChatTime(msg.createdAt)}
                  {msg.editedAt ? <span className="opacity-80"> · Edited</span> : null}
                  {isOwn && viewed ? <span className="opacity-80"> · Viewed</span> : null}
                </span>
                {showActions ? (
                  <span className="flex flex-shrink-0 items-center gap-0.5">
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="rounded-md p-1 text-slate-500 opacity-90 transition-opacity hover:text-slate-700 hover:opacity-100"
                        disabled={busy}
                        aria-label="Edit message"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                          />
                        </svg>
                      </button>
                    ) : null}
                    {onDelete ? (
                      <button
                        type="button"
                        onClick={handleDelete}
                        className="rounded-md p-1 text-slate-500 opacity-90 transition-opacity hover:text-slate-700 hover:opacity-100"
                        disabled={busy}
                        aria-label="Delete message"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
              ) : null}
            </div>
          )
        ) : null}

        {splitImageAndTextBubble || !hasAttachments ? (
          <div className={`w-full rounded-2xl px-4 py-2 ${bubbleClassName}`}>
            {editing ? (
              <div className="space-y-2">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    autoResize();
                  }}
                  rows={1}
                  className="w-full resize-none overflow-hidden rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  style={{ minHeight: "2.5rem" }}
                  disabled={busy}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setDraft(msg.body ?? "");
                    }}
                    className={`text-xs ${actionMutedClassName}`}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={busy}
                    className={
                      saveEditButtonClassName ??
                      "text-xs font-medium text-emerald-700 hover:text-emerald-800"
                    }
                  >
                    {busy ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {msg.body ? (
                  <LinkifiedMessageBody
                    text={msg.body}
                    className="break-words whitespace-pre-wrap"
                    linkClassName={linkClassName}
                  />
                ) : null}
                {msg.body
                  ? extractUrls(msg.body).map((url) => (
                      <LinkPreview key={url} url={url} />
                    ))
                  : null}
                <div
                  className={`mt-1 flex min-h-[1.25rem] items-center gap-2 text-xs ${metaClassName} ${
                    align === "end" ? "justify-end" : "justify-start"
                  }`}
                >
                  <span className="min-w-0">
                    {formatChatTime(msg.createdAt)}
                    {msg.editedAt ? <span className="opacity-80"> · Edited</span> : null}
                    {isOwn && viewed ? <span className="opacity-80"> · Viewed</span> : null}
                  </span>
                  {showActions ? (
                    <span className="flex flex-shrink-0 items-center gap-0.5">
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => setEditing(true)}
                          className={`rounded-md p-1 opacity-90 transition-opacity hover:opacity-100 ${actionMutedClassName}`}
                          disabled={busy}
                          aria-label="Edit message"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            />
                          </svg>
                        </button>
                      ) : null}
                      {onDelete ? (
                        <button
                          type="button"
                          onClick={handleDelete}
                          className={`rounded-md p-1 opacity-90 transition-opacity hover:opacity-100 ${actionMutedClassName}`}
                          disabled={busy}
                          aria-label="Delete message"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        {onToggleReaction && !editing && (
          <button
            type="button"
            onClick={() => setShowEmojiPicker((p) => !p)}
            className={`absolute ${
              align === "end" ? "-left-8" : "-right-8"
            } top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-sm text-slate-500 opacity-0 shadow-sm transition-opacity hover:bg-slate-50 group-hover/msg:opacity-100`}
            aria-label="Add reaction"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
            </svg>
          </button>
        )}

        {showEmojiPicker && (
          <div
            ref={emojiPickerRef}
            className={`absolute ${
              align === "end" ? "right-0" : "left-0"
            } -top-12 z-20 flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1.5 shadow-lg`}
          >
            {REACTION_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => {
                  onToggleReaction?.(msg.id, emoji);
                  setShowEmojiPicker(false);
                }}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-lg transition-colors hover:bg-slate-100 ${
                  myReaction?.emoji === emoji ? "bg-emerald-100 ring-2 ring-emerald-400" : ""
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {hasReactions && !editing && (
          <div
            className={`absolute -bottom-3 z-10 flex flex-wrap gap-1 ${
              align === "end" ? "left-2" : "right-2"
            }`}
          >
            {Object.entries(aggregated).map(([emoji, count]) => {
              const isMine = myReaction?.emoji === emoji;
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => onToggleReaction?.(msg.id, emoji)}
                  className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-sm border shadow-sm transition-colors ${
                    isMine
                      ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>{emoji}</span>
                  {count > 1 && <span className="text-xs">{count}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>

    {lightboxUrl &&
      createPortal(
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxUrl(null)}
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white text-xl hover:bg-white/40 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Full size"
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}
    </>
  );
}
