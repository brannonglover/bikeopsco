"use client";

import { useState } from "react";
import type { Conversation } from "@/lib/types";

/**
 * The per-conversation kill switch, shown above the thread.
 *
 * Staff mostly never press it — sending a message pauses the assistant on its
 * own. It exists for the case where you want it to stop *before* you have
 * anything to say, and to put it back to work once you're done.
 */
export function AiAssistantBanner({
  conversation,
  onChange,
}: {
  conversation: Conversation;
  /** Called with the conversation as the server returned it after the change. */
  onChange: (conversation: Conversation) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = conversation.aiAssistantState ?? "OFF";
  // A thread the assistant has never touched says nothing at all — staff
  // shouldn't have to read a banner about a feature that isn't in play.
  if (state === "OFF") return null;

  const setState = async (next: "ACTIVE" | "PAUSED") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiAssistantState: next }),
      });
      if (!res.ok) {
        setError("Couldn't change that. Try again.");
        return;
      }
      onChange((await res.json()) as Conversation);
    } catch {
      setError("Couldn't change that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const active = state === "ACTIVE";
  const tone = active
    ? "border-indigo-200 bg-indigo-50 text-indigo-900"
    : "border-slate-200 bg-slate-50 text-slate-700";

  const headline = active
    ? "The AI assistant is answering this conversation."
    : state === "DONE"
      ? "The AI assistant has handed this over to you."
      : "The AI assistant is paused on this conversation.";

  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 text-xs ${tone}`}
    >
      <span className="flex items-center gap-1.5 font-semibold">
        <span
          aria-hidden
          className={`inline-block h-2 w-2 rounded-full ${
            active ? "bg-indigo-500" : "bg-slate-400"
          }`}
        />
        {headline}
      </span>

      {conversation.aiAssistantSummary && (
        <span className="min-w-0 flex-1 opacity-90">
          {conversation.aiAssistantSummary}
        </span>
      )}

      {active && (
        <span className="opacity-80">Sending a message stops it.</span>
      )}

      <button
        type="button"
        onClick={() => void setState(active ? "PAUSED" : "ACTIVE")}
        disabled={busy}
        className="ml-auto flex-shrink-0 rounded-lg border border-current px-2.5 py-1 font-semibold transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "…" : active ? "Take over" : "Let the assistant reply"}
      </button>

      {error && <span className="w-full text-red-700">{error}</span>}
    </div>
  );
}
