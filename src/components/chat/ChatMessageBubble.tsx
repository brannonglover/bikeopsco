"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import type { ChatMessage } from "@/lib/types";
import { formatChatTime } from "@/lib/format-chat-time";
import { LinkifiedMessageBody } from "./LinkifiedMessageBody";

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
  onPatch?: (messageId: string, body: string | null) => Promise<boolean>;
  onDelete?: (messageId: string) => Promise<boolean>;
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
  onPatch,
  onDelete,
}: ChatMessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) {
      setDraft(msg.body ?? "");
    }
  }, [msg.body, msg.id, editing]);

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

  const showActions = isOwn && (onPatch || onDelete) && !editing;
  const canEdit = Boolean(onPatch);

  return (
    <div className={`flex ${align === "end" ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] md:max-w-[70%] rounded-2xl px-4 py-2 ${bubbleClassName}`}>
        {msg.attachments?.length ? (
          <div className="space-y-2 mb-2">
            {msg.attachments.map((att) => (
              <a
                key={att.id}
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
                  className="rounded-lg max-h-48 object-cover w-full"
                />
              </a>
            ))}
          </div>
        ) : null}

        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full rounded-lg px-3 py-2 text-sm text-slate-900 bg-white border border-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              className={`flex items-center gap-2 mt-1 min-h-[1.25rem] text-xs ${metaClassName} ${
                align === "end" ? "justify-end" : "justify-start"
              }`}
            >
              <span className="min-w-0">
                {formatChatTime(msg.createdAt)}
                {msg.editedAt ? (
                  <span className="opacity-80"> · Edited</span>
                ) : null}
              </span>
              {showActions ? (
                <span className="flex items-center gap-0.5 flex-shrink-0">
                  {canEdit ? (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      className={`p-1 rounded-md transition-opacity opacity-90 hover:opacity-100 ${actionMutedClassName}`}
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
                      className={`p-1 rounded-md transition-opacity opacity-90 hover:opacity-100 ${actionMutedClassName}`}
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
    </div>
  );
}
