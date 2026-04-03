"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage, MessageSender } from "@/lib/types";
import { formatChatTime } from "@/lib/format-chat-time";
import { LinkifiedMessageBody } from "./LinkifiedMessageBody";

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
  const isImageOnly =
    (msg.attachments?.length ?? 0) > 0 && !msg.body && !editing;

  const reactions = msg.reactions ?? [];
  const aggregated = reactions.reduce<Record<string, number>>((acc, r) => {
    acc[r.emoji] = (acc[r.emoji] ?? 0) + 1;
    return acc;
  }, {});
  const myReaction = role
    ? reactions.find((r) => r.reactorType === role)
    : undefined;

  return (
    <div className={`flex flex-col ${align === "end" ? "items-end" : "items-start"}`}>
      <div className="relative group/msg">
      <div
        className={`${editing ? "w-full" : "max-w-[85%] md:max-w-[70%]"} rounded-2xl ${
          isImageOnly ? "overflow-hidden" : `px-4 py-2 ${bubbleClassName}`
        }`}
      >
        {msg.attachments?.length ? (
          <div className={isImageOnly ? "space-y-0.5" : "space-y-2 mb-2"}>
            {msg.attachments.map((att) => (
              <div key={att.id} className="relative group/att">
                <a
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block"
                >
                  <Image
                    src={att.url}
                    alt={att.filename}
                    width={320}
                    height={192}
                    className={
                      isImageOnly
                        ? "w-full object-cover"
                        : "rounded-lg max-h-48 object-cover w-full"
                    }
                  />
                </a>
                {isOwn && onRemoveAttachment && !editing && (
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white text-sm flex items-center justify-center opacity-70 md:opacity-0 md:group-hover/att:opacity-100 transition-opacity hover:bg-red-600"
                    aria-label="Remove image"
                    disabled={busy}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : null}

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
              className="w-full rounded-lg px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none overflow-hidden"
              style={{ minHeight: "2.5rem" }}
              disabled={busy}
            />
            <div className="flex gap-2 justify-end">
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
                className="whitespace-pre-wrap break-words"
                linkClassName={linkClassName}
              />
            ) : null}
            <div
              className={`flex items-center gap-2 mt-1 min-h-[1.25rem] text-xs ${
                isImageOnly ? "text-slate-500 px-3 pb-1.5" : metaClassName
              } ${align === "end" ? "justify-end" : "justify-start"}`}
            >
              <span className="min-w-0">
                {formatChatTime(msg.createdAt)}
                {msg.editedAt ? (
                  <span className="opacity-80"> · Edited</span>
                ) : null}
                {isOwn && viewed ? (
                  <span className="opacity-80"> · Viewed</span>
                ) : null}
              </span>
              {showActions ? (
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className={`p-1 rounded-md transition-opacity opacity-90 hover:opacity-100 ${
                        isImageOnly ? "text-slate-500 hover:text-slate-700" : actionMutedClassName
                      }`}
                      disabled={busy}
                      aria-label="Edit message"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
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
                      className={`p-1 rounded-md transition-opacity opacity-90 hover:opacity-100 ${
                        isImageOnly ? "text-slate-500 hover:text-slate-700" : actionMutedClassName
                      }`}
                      disabled={busy}
                      aria-label="Delete message"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
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

      {onToggleReaction && !editing && (
        <button
          type="button"
          onClick={() => setShowEmojiPicker((p) => !p)}
          className={`absolute ${
            align === "end" ? "-left-8" : "-right-8"
          } top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-sm opacity-0 group-hover/msg:opacity-100 transition-opacity bg-white border border-slate-200 shadow-sm hover:bg-slate-50 text-slate-500`}
          aria-label="Add reaction"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.182 15.182a4.5 4.5 0 01-6.364 0M21 12a9 9 0 11-18 0 9 9 0 0118 0zM9.75 9.75c0 .414-.168.75-.375.75S9 10.164 9 9.75 9.168 9 9.375 9s.375.336.375.75zm-.375 0h.008v.015h-.008V9.75zm5.625 0c0 .414-.168.75-.375.75s-.375-.336-.375-.75.168-.75.375-.75.375.336.375.75zm-.375 0h.008v.015h-.008V9.75z" />
          </svg>
        </button>
      )}

      {showEmojiPicker && (
        <div
          ref={emojiPickerRef}
          className={`absolute ${
            align === "end" ? "right-0" : "left-0"
          } -top-12 z-20 flex items-center gap-1 px-2 py-1.5 rounded-full bg-white border border-slate-200 shadow-lg`}
        >
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => {
                onToggleReaction?.(msg.id, emoji);
                setShowEmojiPicker(false);
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-lg hover:bg-slate-100 transition-colors ${
                myReaction?.emoji === emoji ? "bg-emerald-100 ring-2 ring-emerald-400" : ""
              }`}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
      </div>

      {Object.keys(aggregated).length > 0 && (
        <div className={`flex flex-wrap gap-1 mt-1 ${align === "end" ? "justify-end" : "justify-start"}`}>
          {Object.entries(aggregated).map(([emoji, count]) => {
            const isMine = myReaction?.emoji === emoji;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => onToggleReaction?.(msg.id, emoji)}
                className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-sm border transition-colors ${
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
  );
}
