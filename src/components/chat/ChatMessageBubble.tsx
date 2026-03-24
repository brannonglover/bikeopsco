"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import type { ChatMessage } from "@/lib/types";
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
  formatTime: (iso: string) => string;
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
  formatTime,
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
            {showActions ? (
              <div className={`flex flex-wrap gap-x-3 gap-y-1 mt-1 ${align === "end" ? "justify-end" : "justify-start"}`}>
                {canEdit ? (
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className={`text-xs ${actionMutedClassName}`}
                    disabled={busy}
                  >
                    Edit
                  </button>
                ) : null}
                {onDelete ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    className={`text-xs ${actionMutedClassName}`}
                    disabled={busy}
                  >
                    Delete
                  </button>
                ) : null}
              </div>
            ) : null}
            <p className={`text-xs mt-1 ${metaClassName}`}>
              {formatTime(msg.createdAt)}
              {msg.editedAt ? (
                <span className="opacity-80"> · Edited</span>
              ) : null}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
